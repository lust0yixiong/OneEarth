#!/usr/bin/env python3
"""Download the daily parquet slices used by the forest embedding layer.

The Haina SDK is installed separately (it is not part of package.json):

    python3 -m venv .local/haina-venv
    .local/haina-venv/bin/pip install haina-datahub
    # AK/SK come from the local .env.haina file, never from source control
    .local/haina-venv/bin/python scripts/download-haina-forest.py

Only the twelve 2023 monthly slices below are downloaded (about 9 MB each); the
full dataset is 145,737,429 rows and is not held in this repository.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

DATASET_ID = 1846764
DATES = ("20230115", "20230215", "20230315", "20230415", "20230515", "20230615", "20230715", "20230815", "20230915", "20231015", "20231115", "20231215")

root = Path(__file__).resolve().parent.parent

def load_credentials() -> None:
    env_file = root / ".env.haina"
    if not env_file.exists():
        raise SystemExit("缺少 .env.haina（HAINA_DATAHUB_AK / HAINA_DATAHUB_SK）。")
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, _, value = line.partition("=")
        if key in {"HAINA_DATAHUB_AK", "HAINA_DATAHUB_SK"}:
            os.environ[key] = value.strip()
    if not os.environ.get("HAINA_DATAHUB_AK") or not os.environ.get("HAINA_DATAHUB_SK"):
        raise SystemExit(".env.haina 缺少 HAINA_DATAHUB_AK 或 HAINA_DATAHUB_SK。")


def main() -> int:
    load_credentials()
    try:
        import haina_datahub
        from haina_datahub.dataset import download
    except ImportError:
        raise SystemExit("请先安装海纳 SDK：.local/haina-venv/bin/pip install haina-datahub")

    haina_datahub.login(
        ak=os.environ["HAINA_DATAHUB_AK"],
        sk=os.environ["HAINA_DATAHUB_SK"],
    )
    for date in DATES:
        target = root / ".local" / "haina" / str(DATASET_ID) / date
        parquet = target / f"date={date}" / "data.parquet"
        if parquet.exists():
            print(f"{date}: 已存在，跳过")
            continue
        target.mkdir(parents=True, exist_ok=True)
        print(f"{date}: 下载 date={date}/data.parquet")
        download(
            dataset_id=DATASET_ID,
            source_path=f"date={date}/data.parquet",
            target_path=str(target),
        )
        if not parquet.exists():
            raise SystemExit(f"{date}: 下载完成后未找到 {parquet}")
    print("完成。接下来运行 node scripts/prepare-haina-forest.mjs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
