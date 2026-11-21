"""Fill missing months from the public NASA POWER IMERG 0.1° monthly store.

python scripts/download-imerg-public.py CACHE OUTPUT --start-year 2000 --end-year 2026
OUTPUT is ONEEARTH_DATA_DIR/imerg. Existing Final/Late months are preserved.
These POWER monthly fields are a separately labelled derived preview product.
"""
import argparse
import calendar
import json
import os
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

BASE = "https://nasa-power.s3.us-west-2.amazonaws.com/imerg/spatial/power_imerg_monthly_spatial_utc.zarr/"
AVAILABILITY = "https://nasa-power.s3.us-west-2.amazonaws.com/last_available.json"
PART_SIZE = 524288


def download(cache, output, start_year, end_year, workers=8):
    root = cache / "power"
    root.mkdir(parents=True, exist_ok=True)
    for key, url in [("last_available.json", AVAILABILITY)] + [(key, BASE+key) for key in [".zmetadata", "time/0", "lat/0", "lon/0"]]:
        path = root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=60) as response:
            path.write_bytes(response.read())
    available = json.loads((root / "last_available.json").read_text())["imerg"]["spatial"]["monthly"]["utc"]
    objects = []
    for year in range(start_year, end_year+1):
        for month in range(1, 13):
            date = f"{year}-{month:02}-{calendar.monthrange(year, month)[1]:02}"
            if date > available:
                continue
            previous = output / str(year) / f"{month:02}.json"
            if previous.exists() and json.loads(previous.read_text())["source"]["run"] != "Derived":
                continue
            key = f"IMERG_PRECTOT/{(year-1998)*12+month-1}.0.0"
            path = root / key
            with urllib.request.urlopen(urllib.request.Request(BASE+key, method="HEAD"), timeout=60) as response:
                size, etag = int(response.headers["Content-Length"]), response.headers["ETag"]
            receipt = path.with_name(path.name+".source.json")
            identity = dict(size=size, etag=etag)
            if path.exists() and path.stat().st_size == size and receipt.exists() and json.loads(receipt.read_text()) == identity:
                continue
            objects.append((key, path, size, etag))
    tasks = []
    for key, path, size, etag in objects:
        # ETag in the part directory prevents mixing revisions across restarts.
        parts = path.with_name(path.name+".parts-"+etag.strip('"'))
        parts.mkdir(parents=True, exist_ok=True)
        for start in range(0, size, PART_SIZE):
            end = min(start+PART_SIZE-1, size-1)
            target = parts / str(start)
            if not target.exists() or target.stat().st_size != end-start+1:
                tasks.append((key, start, end, target, size, etag))

    def fetch_part(item):
        key, start, end, target, size, etag = item
        for attempt in range(4):
            try:
                headers = {"Range": f"bytes={start}-{end}", "If-Match": etag}
                with urllib.request.urlopen(urllib.request.Request(BASE+key, headers=headers), timeout=120) as response:
                    assert response.status == 206
                    assert response.headers["Content-Range"] == f"bytes {start}-{end}/{size}"
                    payload = response.read()
                    assert len(payload) == end-start+1
                temporary = target.with_suffix(".tmp")
                temporary.write_bytes(payload)
                os.replace(temporary, target)
                return
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(3 * (attempt+1))

    with ThreadPoolExecutor(workers) as pool:
        for i, future in enumerate(as_completed([pool.submit(fetch_part, item) for item in tasks]), 1):
            future.result()
            if i % 20 == 0 or i == len(tasks):
                print(f"Downloaded {i}/{len(tasks)} parts", flush=True)
    for key, path, size, etag in objects:
        parts = path.with_name(path.name+".parts-"+etag.strip('"'))
        temporary = path.with_name(path.name+".tmp")
        with temporary.open("wb") as file:
            for start in range(0, size, PART_SIZE):
                file.write((parts / str(start)).read_bytes())
        assert temporary.stat().st_size == size
        os.replace(temporary, path)
        path.with_name(path.name+".source.json").write_text(json.dumps(dict(size=size, etag=etag)))
        print(f"Cached {key}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cache", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--start-year", type=int, default=2000)
    parser.add_argument("--end-year", type=int, default=2026)
    parser.add_argument("--workers", type=int, choices=range(1, 13), default=8)
    args = parser.parse_args()
    assert 2000 <= args.start_year <= args.end_year <= 2026
    download(args.cache, args.output, args.start_year, args.end_year, args.workers)


if __name__ == "__main__":
    main()
