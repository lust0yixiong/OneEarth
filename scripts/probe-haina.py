#!/usr/bin/env python3
"""Verify one already authorized forest partition against the published layer manifest."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import sys

root = Path(__file__).resolve().parent.parent
date = "20230715"
dataset = 1846764
state = Path(os.environ["ONEEARTH_STATE_DIR"])
target = state / "haina-inputs" / str(dataset) / date
parquet = target / f"date={date}" / "data.parquet"
ak = os.environ.get("HAINA_DATAHUB_AK") or os.environ.get("HAINA_ACCESS_KEY_ID")
sk = os.environ.get("HAINA_DATAHUB_SK") or os.environ.get("HAINA_SECRET_ACCESS_KEY")
if not ak or not sk:
    sys.exit("海纳 SDK 缺少授权凭据。")
target.mkdir(parents=True, exist_ok=True, mode=0o700)
try:
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        import haina_datahub
        from haina_datahub.dataset import download
        haina_datahub.login(ak=ak, sk=sk)
        if not parquet.exists():
            download(dataset_id=dataset, source_path=f"date={date}/data.parquet", target_path=str(target))
except Exception as exc:
    status = getattr(getattr(exc, "response", None), "status_code", None)
    print(json.dumps({"dataset":dataset,"date":date,"stage":"sdk-download","status":status,"errorType":type(exc).__name__}))
    sys.exit(1)
if not parquet.is_file():
    sys.exit("SDK 下载未产生预期的分区文件。")
with parquet.open("rb") as f:
    checksum = hashlib.file_digest(f, "sha256").hexdigest()
manifest = json.loads((root / "public/visualizations/haina/1846764/manifest.json").read_text())
expected = next(frame["sourceSha256"] for frame in manifest["frames"] if frame["date"]=="2023-07-15")
print(json.dumps({"dataset":dataset,"date":date,"bytes":parquet.stat().st_size,
                  "sha256":checksum,"matchesManifest":checksum==expected}))
sys.exit(0 if checksum==expected else 2)
