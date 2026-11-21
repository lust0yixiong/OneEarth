"""Cache public ClimateSERV IMERG V07 Late daily GeoTIFFs (no account).

python scripts/download-imerg-late.py CACHE --start 2025-10-01 --end 2025-12-31
Jobs and verified ZIPs are retained so an interrupted import can be resumed.
"""
import argparse
import datetime as dt
import json
import os
import time
import threading
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

API = "https://climateserv.servirglobal.net/api/"
WORLD = {"type": "Polygon", "coordinates": [[[-180, -90], [180, -90],
          [180, 90], [-180, 90], [-180, -90]]]}
API_LOCK = threading.Lock()
LAST_REQUEST = 0


def request(operation, **parameters):
    global LAST_REQUEST
    url = API + operation + "/?" + urllib.parse.urlencode(parameters)
    for attempt in range(6):
        with API_LOCK:
            time.sleep(max(0, 2 - (time.monotonic() - LAST_REQUEST)))
            LAST_REQUEST = time.monotonic()
        try:
            with urllib.request.urlopen(url, timeout=90) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code not in (429, 502, 503, 504) or attempt == 5:
                raise
            time.sleep(min(60, 5 * 2**attempt))


def validate(path, day):
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None, "Corrupt download"
        assert archive.namelist() == [day.strftime("%Y%m%d") + ".tif"], archive.namelist()


def download(root, day):
    folder = root / "late" / str(day.year) / f"{day.month:02}"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{day.day:02}.zip"
    if path.exists():
        validate(path, day)
        return
    job_file = path.with_suffix(".job.json")
    if job_file.exists():
        job = json.loads(job_file.read_text())["id"]
    else:
        result = request("submitDataRequest", datatype=226,
                         begintime=day.strftime("%m/%d/%Y"), endtime=day.strftime("%m/%d/%Y"),
                         intervaltype=0, operationtype=6, geometry=json.dumps(WORLD))
        assert isinstance(result, list) and len(result) == 1, result
        job = result[0]
        job_file.write_text(json.dumps({"id": job, "date": day.isoformat(), "datatype": 226}))
    for _ in range(120):
        progress = request("getDataRequestProgress", id=job)
        number = progress[0] if isinstance(progress, list) else progress
        if float(number) >= 100:
            break
        assert float(number) >= 0, f"ClimateSERV job failed: {job}"
        time.sleep(3)
    else:
        raise RuntimeError(f"ClimateSERV job timed out: {job}")
    temporary = path.with_suffix(".zip.part")
    url = API + "getFileForJobID/?" + urllib.parse.urlencode({"id": job})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=120) as response, temporary.open("wb") as output:
                while block := response.read(65536):
                    output.write(block)
            validate(temporary, day)
            os.replace(temporary, path)
            print(f"{day} downloaded ({path.stat().st_size} bytes)", flush=True)
            return
        except Exception:
            if attempt == 2:
                raise
            time.sleep(5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cache", type=Path)
    parser.add_argument("--start", required=True, type=dt.date.fromisoformat)
    parser.add_argument("--end", required=True, type=dt.date.fromisoformat)
    parser.add_argument("--workers", type=int, default=4, choices=range(1, 9))
    args = parser.parse_args()
    assert args.start <= args.end
    dates = [args.start + dt.timedelta(days=i) for i in range((args.end - args.start).days + 1)]
    with ThreadPoolExecutor(args.workers) as pool:
        list(pool.map(lambda day: download(args.cache, day), dates))


if __name__ == "__main__":
    main()
