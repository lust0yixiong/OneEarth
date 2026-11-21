"""Precompute monthly IMERG tiles and publish a year catalogue.

uv run --no-project --with h5py --with numpy --with numcodecs --with pillow python scripts/prepare-imerg-rain.py CACHE OUTPUT
CACHE contains final/YYYY/MM.HDF5, power/ Zarr chunks and late/YYYY/MM/DD.zip.
OUTPUT is ONEEARTH_DATA_DIR/imerg. Use --partial-through YYYY-MM-DD for an
explicitly labelled incomplete current month; all preceding days must exist.
"""
import argparse
import calendar
import datetime
import gzip
import hashlib
import json
import os
import tempfile
import io
import zipfile
from pathlib import Path

import h5py
import numpy as np

TILE_SIZE = 180
FACTORS = [10, 2, 1]
AREA = np.cos(np.deg2rad(89.95 - np.arange(1800) * .1))[:, None]


def write_json(path, value):
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(value, separators=(",", ":"), allow_nan=False))
    os.replace(temporary, path)


def prepare_month(output, year, month, values, source):
    """Publish immutable numeric tiles before making their metadata visible."""
    assert values.shape == (1800, 3600)
    valid = np.isfinite(values) & (values >= 0)
    assert valid.any() and values[valid].max() * 100 < 65535
    native = np.where(valid, np.rint(values * 100), 65535).astype("<u2")
    values = np.where(valid, native / 100, 0)
    bands = [
        round(float((values[r:r+100] * AREA[r:r+100]).sum()
                    / np.maximum((valid[r:r+100] * AREA[r:r+100]).sum(), 1e-12)), 4)
        if valid[r:r+100].any() else None for r in range(0, 1800, 100)
    ]
    parent = output / str(year)
    parent.mkdir(parents=True, exist_ok=True)
    name = f"{month:02}-{source['run'].lower()}-{source['sha256'][:12]}"
    destination = parent / name
    if not destination.exists():
        with tempfile.TemporaryDirectory(prefix=".prepare-", dir=parent) as temporary:
            stage = Path(temporary) / name
            stage.mkdir()
            for level, factor in enumerate(FACTORS):
                if factor == 1:
                    grid = native
                else:
                    shape = (1800//factor, factor, 3600//factor, factor)
                    total = (values * AREA).reshape(shape).sum(axis=(1, 3))
                    weights = (valid * AREA).reshape(shape).sum(axis=(1, 3))
                    grid = np.where(weights > 0, np.rint(total / np.maximum(weights, 1e-12) * 100), 65535).astype("<u2")
                directory = stage / str(level)
                directory.mkdir()
                for y in range(grid.shape[0]//TILE_SIZE):
                    for x in range(grid.shape[1]//TILE_SIZE):
                        tile = grid[y*TILE_SIZE:(y+1)*TILE_SIZE, x*TILE_SIZE:(x+1)*TILE_SIZE]
                        (directory / f"{x}-{y}.bin.gz").write_bytes(gzip.compress(tile.tobytes(), compresslevel=6, mtime=0))
            os.replace(stage, destination)
    metadata = dict(month=month, path=f"{year}/{name}", bands=bands, source=source,
                    complete=source.get("complete", True),
                    through=source.get("through", f"{year}-{month:02}-{calendar.monthrange(year, month)[1]:02}"),
                    nativeSha256=hashlib.sha256(native.tobytes()).hexdigest())
    write_json(parent / f"{month:02}.json", metadata)
    return metadata


def prepare_final(path, output, year, month, url):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    previous = output / str(year) / f"{month:02}.json"
    if previous.exists() and json.loads(previous.read_text())["source"]["sha256"] == digest:
        return
    with h5py.File(path) as nc:
        np.testing.assert_allclose(nc["Grid/lat"][:], np.arange(-89.95, 90, .1), atol=1e-5)
        np.testing.assert_allclose(nc["Grid/lon"][:], np.arange(-179.95, 180, .1), atol=1e-5)
        timestamp = datetime.datetime(1980, 1, 6) + datetime.timedelta(seconds=int(nc["Grid/time"][0]))
        assert timestamp.year == year and timestamp.month == month
        source = nc["Grid/precipitation"]
        assert source.shape == (1, 3600, 1800)
        assert source.attrs["units"].decode() == "mm/hr"
        assert float(source.attrs.get("scale_factor", 1)) == 1
        assert float(source.attrs.get("add_offset", 0)) == 0
        values = source[0].T[::-1].astype(np.float64) * 24
    prepare_month(output, year, month, values, dict(
        run="Final", version="V07B", url=url, sha256=digest,
        unit="mm/hr", conversion="monthly mean rate × 24 → mm/day",
        doi="10.5067/GPM/IMERG/3B-MONTH/07"))
    print(f"{year}-{month:02} prepared", flush=True)


def prepare_late(directory, output, year, month, through=None):
    """Mean of a contiguous set of verified global daily mm accumulations."""
    from PIL import Image
    last = calendar.monthrange(year, month)[1]
    end = through or last
    assert 1 <= end <= last
    expected = [directory / f"{day:02}.zip" for day in range(1, end+1)]
    assert all(path.exists() for path in expected), f"Incomplete daily archive: {year}-{month:02}"
    total = np.zeros((1800, 3600), dtype=np.float64)
    count = np.zeros((1800, 3600), dtype=np.uint8)
    inputs = []
    for day, path in enumerate(expected, 1):
        name = f"{year}{month:02}{day:02}.tif"
        with zipfile.ZipFile(path) as archive:
            assert archive.namelist() == [name]
            # Reading every member also verifies its CRC before publication.
            payload = archive.read(name)
        with Image.open(io.BytesIO(payload)) as image:
            assert image.size == (3600, 1800) and image.mode == "F"
            np.testing.assert_allclose(image.tag_v2[33550], [.1, .1, 0], atol=1e-7)
            np.testing.assert_allclose(image.tag_v2[33922], [0, 0, 0, -180, 90, 0])
            assert 4326 in image.tag_v2[34735], "Expected WGS84 geographic grid"
            assert image.tag_v2[42113].strip().lower() == "nan"
            values = np.array(image, dtype=np.float64)
        valid = np.isfinite(values) & (values >= 0)
        assert valid.any() and values[valid].max() < 2000, "Unexpected daily units"
        total += np.where(valid, values, 0)
        count += valid
        inputs.append(dict(date=f"{year}-{month:02}-{day:02}", sha256=hashlib.sha256(payload).hexdigest()))
    signature = hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()
    source = dict(run="Late", version="V07", sha256=signature,
                  url="https://climateserv.servirglobal.net/",
                  unit="daily accumulation mm", conversion="mean of valid daily accumulations → mm/day",
                  complete=end == last, through=f"{year}-{month:02}-{end:02}",
                  days=end, inputs=inputs, datatype=226)
    prepare_month(output, year, month, np.where(count > 0, total / np.maximum(count, 1), np.nan), source)
    print(f"{year}-{month:02} Late prepared ({end} days)", flush=True)


def prepare_power(directory, output, year, month):
    """Import the published NASA POWER IMERG monthly field without resampling.

    This is a distinct derived monthly product, not GPM_3IMERGM Final. Keep its
    provider, processing level, review status and native mm/day units visible.
    """
    import numcodecs
    meta = json.loads((directory / ".zmetadata").read_text())["metadata"]
    available = json.loads((directory / "last_available.json").read_text())["imerg"]["spatial"]["monthly"]["utc"]
    assert f"{year}-{month:02}-{calendar.monthrange(year, month)[1]:02}" <= available

    def decode(variable, key):
        definition = meta[variable + "/.zarray"]
        raw = (directory / variable / key).read_bytes()
        decoded = numcodecs.get_codec(definition["compressor"]).decode(raw)
        array = np.frombuffer(decoded, dtype=definition["dtype"])
        for codec in reversed(definition.get("filters") or []):
            array = numcodecs.get_codec(codec).decode(array)
        return array

    np.testing.assert_allclose(decode("lat", "0"), np.arange(-89.95, 90, .1), atol=1e-5)
    np.testing.assert_allclose(decode("lon", "0"), np.arange(-179.95, 180, .1), atol=1e-5)
    index = (year - 1998) * 12 + month - 1
    date = np.datetime64("1998-01-31") + np.timedelta64(int(decode("time", "0")[index]), "D")
    assert str(date) == f"{year}-{month:02}-{calendar.monthrange(year, month)[1]:02}"
    array = meta["IMERG_PRECTOT/.zarray"]
    assert array["chunks"] == [1, 1800, 3600] and array["order"] == "C"
    attrs = meta["IMERG_PRECTOT/.zattrs"]
    assert attrs["units"] == "mm/day" and attrs["cell_methods"] == "time: mean"
    key = f"{index}.0.0"
    path = directory / "IMERG_PRECTOT" / key
    source = dict(run="Derived", version="POWER v10", provider="NASA POWER",
                  url="https://nasa-power.s3.us-west-2.amazonaws.com/imerg/spatial/power_imerg_monthly_spatial_utc.zarr/IMERG_PRECTOT/" + key,
                  sha256=hashlib.sha256(path.read_bytes()).hexdigest(), unit="mm/day",
                  conversion="NASA POWER IMERG_PRECTOT monthly time:mean; native 0.1° mm/day, no spatial resampling",
                  status=attrs.get("status"),
                  documentation="https://power.larc.nasa.gov/docs/services/aws/")
    values = decode("IMERG_PRECTOT", key).reshape(1800, 3600)[::-1].astype(np.float64)
    prepare_month(output, year, month, values, source)
    print(f"{year}-{month:02} NASA POWER prepared", flush=True)


def publish(output):
    years = []
    for year in range(2000, 2027):
        directory = output / str(year)
        if not directory.exists():
            continue
        months = [json.loads((directory / f"{m:02}.json").read_text())
                  if (directory / f"{m:02}.json").exists() else None for m in range(1, 13)]
        if not any(months):
            continue
        identity = hashlib.sha256(json.dumps(months, sort_keys=True).encode()).hexdigest()[:12]
        manifest = dict(id=f"imerg-{year}-{identity}", product="GPM IMERG", year=year,
                        step=.1, columns=3600, rows=1800, tileSize=TILE_SIZE, factors=FACTORS,
                        unit="mm/day", scale=.01, missing=65535, months=months,
                        bands=[m["bands"] if m else [None]*18 for m in months],
                        source="https://gpm.nasa.gov/data/imerg")
        write_json(directory / "manifest.json", manifest)
        years.append(dict(year=year, months=[m["month"] for m in months if m]))
    write_json(output / "catalog.json", dict(id="imerg-monthly", defaultYear=2024, years=years))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cache", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--partial-through", type=datetime.date.fromisoformat,
                        help="Also publish this month's complete day sequence as an explicitly partial month")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    for path in sorted((args.cache / "final").glob("*/*.HDF5")):
        year, month = int(path.parent.name), int(path.stem)
        filename = f"3B-MO.MS.MRG.3IMERG.{year}{month:02}01-S000000-E235959.{month:02}.V07B.HDF5"
        url = f"https://osdf-director.osg-htc.org/ncar/gdex/d736000/gpm_3imergm_v07/{year}/{filename}"
        prepare_final(path, args.output, year, month, url)
    power = args.cache / "power"
    if (power / "last_available.json").exists():
        for path in sorted((power / "IMERG_PRECTOT").glob("*.0.0")):
            index = int(path.name.split(".")[0])
            year, month = 1998 + index//12, index%12+1
            previous = args.output / str(year) / f"{month:02}.json"
            if 2000 <= year <= 2026 and (not previous.exists() or json.loads(previous.read_text())["source"]["run"] == "Derived"):
                prepare_power(power, args.output, year, month)
    for directory in sorted((args.cache / "late").glob("*/*")):
        if not directory.is_dir():
            continue
        year, month = int(directory.parent.name), int(directory.name)
        last = calendar.monthrange(year, month)[1]
        end = args.partial_through.day if args.partial_through and (year, month) == (args.partial_through.year, args.partial_through.month) else last
        if not all((directory / f"{d:02}.zip").exists() for d in range(1, end+1)):
            continue
        prepare_late(directory, args.output, year, month, end)
    publish(args.output)


if __name__ == "__main__":
    main()
