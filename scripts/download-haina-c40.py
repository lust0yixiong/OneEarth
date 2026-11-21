#!/usr/bin/env python3
"""Download the Shanghai, Beijing and Guangzhou C40 embedding shards.

The Haina SDK is installed separately:

    python3 -m venv .local/haina-venv
    .local/haina-venv/bin/pip install haina-datahub
    .local/haina-venv/bin/python scripts/download-haina-c40.py

Three cities are downloaded (about 760 MB in total). The full C40 dataset
covers 95 cities and about 104 GB and is not held in the repo.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

DATASET_ID = 1846639
CITIES = {
    "shanghai-chn": "shanghai",
    "beijing-chn": "beijing",
    "guangzhou-chn": "guangzhou",
}
FILES = ("indices.npy", "gids.npy", "meta.npy")
META_FILES = (
    "source_contract.json",
    "polygon_triangles_normalized.manifest.json",
)

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
        from haina_datahub.dataset import download, get_dir_list
    except ImportError:
        raise SystemExit("请先安装海纳 SDK：.local/haina-venv/bin/pip install haina-datahub")

    haina_datahub.login(
        ak=os.environ["HAINA_DATAHUB_AK"],
        sk=os.environ["HAINA_DATAHUB_SK"],
    )
    registry_target = root / ".local" / "haina" / str(DATASET_ID) / "root"
    registry_target.mkdir(parents=True, exist_ok=True)
    if not (registry_target / "C40_all.dataset.json").exists():
        download(dataset_id=DATASET_ID, source_path="C40_all.dataset.json", target_path=str(registry_target))
    prefixes = get_dir_list(DATASET_ID, "shards/")[0]
    for city_id, folder in CITIES.items():
        target = root / ".local" / "haina" / str(DATASET_ID) / folder
        target.mkdir(parents=True, exist_ok=True)
        city_prefixes = sorted(prefix for prefix in prefixes if f"_{city_id}_" in prefix)
        if not city_prefixes:
            raise SystemExit(f"{city_id}: 没有找到分片")
        print(f"{city_id}: {len(city_prefixes)} 个分片")
        for prefix in city_prefixes:
            if all((target / prefix / name).exists() for name in FILES):
                continue
            print(f"  {prefix}: 下载")
            download(dataset_id=DATASET_ID, source_path=prefix, target_path=str(target))
        for name in META_FILES:
            source = f"dataset_metadata/{city_id}/{name}"
            if (target / source).exists():
                continue
            download(dataset_id=DATASET_ID, source_path=source, target_path=str(target))
    print("完成。接下来运行 node scripts/prepare-haina-c40.mjs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
