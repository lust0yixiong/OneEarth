"""Cache one authorized Haina V5 archive with version-pinned, restartable range reads."""
from argparse import ArgumentParser
from datetime import datetime, timezone
from hashlib import file_digest, sha256
import fcntl
import json
import os
from pathlib import Path
import re
import sys
import time

import requests

DATASET = 1846104
OBJECT = "embeddings/v5_mixed_scale.tar.gz"
SIZE = 4118352525
STEP = 32 << 20
HERE = Path(__file__).resolve().parent

def credentials():
    from haina_datahub import DatasetClient
    ak = os.environ.get("HAINA_DATAHUB_AK") or os.environ.get("HAINA_ACCESS_KEY_ID")
    sk = os.environ.get("HAINA_DATAHUB_SK") or os.environ.get("HAINA_SECRET_ACCESS_KEY")
    if not ak or not sk:
        raise ValueError("missing authorized Haina SDK credential environment")
    return DatasetClient(ak, sk)

def persist(path, obj):
    temp = path.with_suffix(path.suffix + ".tmp")
    with temp.open("w") as stream:
        json.dump(obj, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    temp.replace(path)

def request(client, session, start, end, etag=None):
    headers = {"Range": f"bytes={start}-{end}", "Accept-Encoding": "identity"}
    if etag:
        headers["If-Range"] = etag
    for attempt in range(4):
        try:
            url = client.get_download_url(DATASET, OBJECT)
            if not isinstance(url, str) or not url.startswith("https://"):
                raise ValueError("SDK did not give HTTPS authorized read")
            with session.get(url,headers=headers,timeout=(10,60),stream=True) as response:
                if response.status_code in (429,500,502,503,504):
                    raise requests.HTTPError(response=response)
                if response.status_code!=206:
                    raise ValueError(f"source did not return bounded read HTTP {response.status_code}")
                if response.headers.get("Content-Range")!=f"bytes {start}-{end}/{SIZE}":
                    raise ValueError("source range resolved to a different sized object")
                version=response.headers.get("ETag","")
                if not re.fullmatch(r'"[^"]{8,100}"',version) or (etag and version!=etag):
                    raise ValueError("source ETag missing or changed during retrieval")
                body=response.raw.read(end-start+2)
                if len(body)!=end-start+1:
                    raise requests.ConnectionError("incomplete response body")
                return body,version,response.headers.get("Last-Modified")
        except requests.RequestException as exc:
            if attempt==3:
                status=getattr(getattr(exc,"response",None),"status_code",None)
                raise ValueError(f"source range retry exhausted ({type(exc).__name__}, HTTP {status})") from None
            time.sleep(2**attempt)

def verify_partial(stream, state):
    digest=sha256()
    position=0
    stream.seek(0)
    for item in state["segments"]:
        if item["start"]!=position or item["end"]<position:
            raise ValueError("archive receipt has a gap or stale range")
        data=stream.read(item["end"]-position+1)
        if len(data)!=item["bytes"] or sha256(data).hexdigest()!=item["sha256"]:
            raise ValueError("archive cache failed a recorded segment checksum")
        digest.update(data)
        position=item["end"]+1
    return digest,position

def fetch(target):
    target.mkdir(parents=True,exist_ok=True)
    archive=target/"v5_mixed_scale.tar.gz"
    partial=archive.with_suffix(".gz.partial")
    receipt=target/"v5-receipt.json"
    with (target/".v5.lock").open("a") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        default={"datasetId":DATASET,"object":OBJECT,"size":SIZE,"state":"downloading","segments":[]}
        state=json.loads(receipt.read_text()) if receipt.is_file() else default
        if any(state[k]!=default[k] for k in ("datasetId","object","size")):
            raise ValueError("archive cache receipt points to another source")
        if archive.is_file():
            if not state.get("sha256") or archive.stat().st_size!=SIZE:
                raise ValueError("archive exists without a complete source receipt")
            with archive.open("rb") as stream:
                if file_digest(stream,"sha256").hexdigest()!=state["sha256"]:
                    raise ValueError("verified archive cache SHA-256 does not match")
            print(json.dumps({"state":"reused","bytes":SIZE,"archive":str(archive),"sha256":state["sha256"]}),flush=True)
            return
        if state["segments"] and not partial.is_file():
            raise ValueError("partial archive is missing")
        with requests.Session() as session, partial.open("r+b" if partial.exists() else "w+b") as stream:
            digest,position=verify_partial(stream,state)
            stream.truncate(position)
            stream.seek(position)
            client=credentials() if position<SIZE else None
            while position < SIZE:
                end=min(position+STEP,SIZE)-1
                body,etag,modified=request(client,session,position,end,state.get("etag"))
                state.update(etag=etag,lastModified=modified)
                stream.write(body)
                stream.flush()
                os.fsync(stream.fileno())
                digest.update(body)
                state["segments"].append({"start":position,"end":end,"bytes":len(body),"sha256":sha256(body).hexdigest(),"status":206})
                position=end+1
                state["downloadedBytes"]=position
                persist(receipt,state)
                print(json.dumps({"state":"downloading","bytes":position,"total":SIZE,"etag":etag}),flush=True)
            state.update(state="complete",sha256=digest.hexdigest(),completedAt=datetime.now(timezone.utc).isoformat())
            persist(receipt,state)
        partial.replace(archive)
        print(json.dumps({"state":"complete","bytes":SIZE,"archive":str(archive),"sha256":state["sha256"]}),flush=True)

def main():
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir",type=Path,required=True)
    args=parser.parse_args()
    os.umask(0o077)
    fetch(args.input_dir)

if __name__=="__main__":
    try:
        main()
    except Exception as exc:
        # SDK exceptions can contain signed URLs. Emit diagnostic types for unexpected failures.
        message=str(exc) if type(exc) is ValueError and "://" not in str(exc) else type(exc).__name__
        print(f"V5 archive acquisition stopped: {message}",file=sys.stderr)
        sys.exit(1)
