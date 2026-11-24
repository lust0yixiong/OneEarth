"""Resume a single local copy of the pinned Haina August 2025 VIIRS COG."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import contextlib
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import time
from threading import Lock, local
from urllib.parse import urlparse

import requests

from haina_viirs_source import ETAG, OBJECT, SIZE


def atomic_json(path, value):
    tempfile = path.with_suffix(path.suffix + ".new")
    with tempfile.open("w") as output:
        json.dump(value, output, indent=2, sort_keys=True)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    tempfile.replace(path)


def secure_signer(credentials_file):
    from haina_datahub import DatasetClient

    keys = json.loads(credentials_file.read_text()) if credentials_file else os.environ
    ak = keys.get("HAINA_DATAHUB_AK") or keys.get("HAINA_ACCESS_KEY_ID")
    sk = keys.get("HAINA_DATAHUB_SK") or keys.get("HAINA_SECRET_ACCESS_KEY")
    if not ak or not sk:
        raise ValueError("configure existing Haina SDK credentials")
    # An SDK response can contain a signed URL. Keep output and errors private.
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        try:
            client = DatasetClient(ak, sk)
            signed = client.get_download_url(1835833, OBJECT)
        except Exception as error:
            raise ValueError(f"Haina could not sign the pinned object ({type(error).__name__})") from None
    if not isinstance(signed, str) or urlparse(signed).scheme != "https":
        raise ValueError("Haina did not sign an HTTPS object")
    return signed


def copy_cog(root, credentials_file, workers):
    source = {"datasetId": 1835833, "object": OBJECT, "bytes": SIZE, "etag": ETAG}
    target = root / OBJECT
    partial = root / (OBJECT + ".part")
    receipt = root / "source.json"
    journal = root / "download.json"
    block_size = 8 * 1024 * 1024
    ranges = [(start, min(SIZE, start + block_size)) for start in range(0, SIZE, block_size)]

    if target.is_file():
        with target.open("rb") as file:
            digest = hashlib.file_digest(file, "sha256").hexdigest()
        found = json.loads(receipt.read_text()) if receipt.is_file() else None
        if found != {**source, "sha256": digest} or target.stat().st_size != SIZE:
            raise ValueError("full VIIRS COG failed its cached identity check")
        return {**found, "bytesDownloaded": 0, "reused": True}

    state = json.loads(journal.read_text()) if journal.is_file() else {
        **source, "blockSize": block_size, "chunks": {},
    }
    if any(state.get(name) != value for name, value in {**source, "blockSize": block_size}.items()):
        raise ValueError("existing journal does not belong to this COG")
    chunks = state["chunks"]
    signatures = Lock()
    current_url = None
    signed_at = 0
    sessions = local()

    def signed_url(refresh=False):
        nonlocal current_url, signed_at
        with signatures:
            if refresh or current_url is None or time.monotonic() - signed_at > 15 * 60:
                current_url = secure_signer(credentials_file)
                signed_at = time.monotonic()
            return current_url

    def request_window(job):
        start, stop = job
        expected = f"bytes {start}-{stop - 1}/{SIZE}"
        headers = {"Range": f"bytes={start}-{stop - 1}", "If-Range": ETAG, "Accept-Encoding": "identity"}
        if not hasattr(sessions, "session"):
            sessions.session = requests.Session()
        last_error = "unknown"
        for retry in range(4):
            try:
                with sessions.session.get(signed_url(), headers=headers, timeout=(15, 90), stream=True) as response:
                    status = response.status_code
                    if status in (401, 403):
                        signed_url(refresh=True)
                        last_error = str(status)
                        continue
                    if (status,response.headers.get("Content-Range"),response.headers.get("ETag")) == (206,expected,ETAG):
                        body = response.raw.read(stop - start + 1)
                        if len(body) == stop - start:
                            return (start, body)
                        last_error = "incomplete response"
                    elif status in (429, 500, 502, 503, 504):
                        last_error = str(status)
                    else:
                        raise ValueError(f"pinned VIIRS range rejected ({status})")
            except (requests.exceptions.RequestException, OSError) as error:
                last_error = type(error).__name__
            time.sleep(1 + 2 ** retry)
        raise OSError(f"VIIRS source range {start}-{stop - 1} failed ({last_error})")

    flags = os.O_RDWR | os.O_CREAT
    fd = os.open(partial, flags, 0o600)
    transferred = 0
    try:
        if os.fstat(fd).st_size != SIZE:
            os.ftruncate(fd, SIZE)
        pending = []
        for start, stop in ranges:
            if chunks.get(str(start)) is None or hashlib.sha256(os.pread(fd, stop-start, start)).hexdigest() != chunks[str(start)]:
                pending.append((start, stop))
        done = len(ranges) - len(pending)
        print(json.dumps({"state": "resume", "ready": done, "ranges": len(ranges)}), flush=True)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            jobs = iter(pending)
            active = {pool.submit(request_window, job) for job in (next(jobs, None) for _ in range(workers)) if job}
            while active:
                future = next(as_completed(active))
                active.remove(future)
                start, body = future.result()
                if os.pwrite(fd, body, start) != len(body):
                    raise OSError("short write to VIIRS cache")
                os.fsync(fd)
                chunks[str(start)] = hashlib.sha256(body).hexdigest()
                transferred += len(body)
                done += 1
                atomic_json(journal, state)
                if done % 8 == 0 or done == len(ranges):
                    print(json.dumps({"state": "fetching", "ready": done, "ranges": len(ranges), "bytesDownloaded": transferred}), flush=True)
                next_job = next(jobs, None)
                if next_job:
                    active.add(pool.submit(request_window, next_job))
    finally:
        os.close(fd)

    with partial.open("rb") as file:
        digest = hashlib.file_digest(file, "sha256").hexdigest()
    manifest = {**source, "sha256": digest}
    atomic_json(receipt, manifest)
    partial.replace(target)
    return {**manifest, "bytesDownloaded": transferred, "reused": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--credentials-file", type=Path)
    parser.add_argument("--workers", type=int, choices=range(1, 9), default=4)
    args = parser.parse_args()
    os.umask(0o077)
    if args.credentials_file and (args.credentials_file.stat().st_mode & 0o077 or args.credentials_file.stat().st_uid != os.getuid()):
        raise SystemExit("Haina credential file must be private and belong to the current user")
    args.cache.mkdir(parents=True, exist_ok=True)
    with (args.cache / "source.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(copy_cog(args.cache, args.credentials_file, args.workers)), flush=True)


if __name__ == "__main__":
    main()
