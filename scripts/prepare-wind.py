"""Decode pinned NOAA GRIB subsets into the browser fixture.
Run with a Python environment containing eccodes and numpy:
python scripts/prepare-wind.py f000.grib2 f006.grib2 f012.grib2
Downloads are intentionally separate; NOAA requires pauses between requests.
"""
import sys, json, hashlib, shutil
from pathlib import Path
from datetime import datetime, timezone
import numpy as np
import eccodes as ec

root = Path(__file__).resolve().parent.parent
out = root / 'public/visualizations/gfs'
out.mkdir(parents=True, exist_ok=True)
frames, chunks, originals = [], [], []
reference = None
for filename in sys.argv[1:]:
    source = Path(filename)
    records = {}
    with source.open('rb') as stream:
        while (gid := ec.codes_grib_new_from_file(stream)) is not None:
            meta = {key: ec.codes_get(gid, key) for key in [
                'shortName', 'typeOfLevel', 'level', 'units', 'Ni', 'Nj',
                'dataDate', 'dataTime', 'validityDate', 'validityTime', 'forecastTime',
                'latitudeOfFirstGridPointInDegrees', 'longitudeOfFirstGridPointInDegrees',
                'iDirectionIncrementInDegrees', 'jDirectionIncrementInDegrees', 'jScansPositively']}
            assert meta['Ni'] == 360 and meta['Nj'] == 181
            assert meta['latitudeOfFirstGridPointInDegrees'] == 90
            assert meta['longitudeOfFirstGridPointInDegrees'] == 0 and meta['jScansPositively'] == 0
            assert meta['units'] == 'm s**-1'
            assert ec.codes_get(gid, 'uvRelativeToGrid') == 0
            level = '10m' if meta['typeOfLevel'] == 'heightAboveGround' and meta['level'] == 10 else '250hPa'
            component = 'u' if meta['shortName'] in ['u', '10u'] else 'v'
            values = ec.codes_get_values(gid)
            assert np.isfinite(values).all() and np.max(np.abs(values)) < 327
            records[(level, component)] = (meta, values)
            ec.codes_release(gid)
    assert set(records) == {(l, c) for l in ['10m', '250hPa'] for c in ['u', 'v']}
    for level in ['10m', '250hPa']:
        meta, u = records[(level, 'u')]
        _, v = records[(level, 'v')]
        stamp = lambda date, time: datetime.strptime(str(date) + f'{time:04d}', '%Y%m%d%H%M').replace(tzinfo=timezone.utc).isoformat().replace('+00:00', 'Z')
        ref = stamp(meta['dataDate'], meta['dataTime'])
        reference = reference or ref
        assert reference == ref
        packed = np.column_stack([np.rint(u * 100), np.rint(v * 100)]).astype('<i2')
        samples = []
        for lon, lat in [(0, 0), (105, 30), (180, 45), (300, -30)]:
            pos = (90-lat)*360 + lon
            pu, pv = (packed[pos].astype(float) * .01).tolist()
            samples.append([lon if lon <= 180 else lon-360, lat, round(pu, 2), round(pv, 2), round(float(np.hypot(pu, pv)), 2)])
        frames.append({'id': f'{level}-f{meta["forecastTime"]:03d}', 'level': level,
            'forecastHour': meta['forecastTime'], 'validTime': stamp(meta['validityDate'], meta['validityTime']),
            'byteOffset': sum(len(c) for c in chunks), 'valueCount': packed.size,
            'minSpeed': round(float(np.hypot(u, v).min()), 2), 'maxSpeed': round(float(np.hypot(u, v).max()), 2),
            'samples': samples})
        chunks.append(packed.tobytes())
    hour = meta['forecastTime']
    archive = f'f{hour:03d}.grib2'
    shutil.copyfile(source, out / archive)
    day, cycle = str(meta['dataDate']), f'{meta["dataTime"]//100:02d}'
    url = f'https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl?file=gfs.t{cycle}z.pgrb2.1p00.f{hour:03d}&lev_10_m_above_ground=on&lev_250_mb=on&var_UGRD=on&var_VGRD=on&dir=%2Fgfs.{day}%2F{cycle}%2Fatmos'
    originals.append({'file': '/visualizations/gfs/' + archive, 'url': url, 'sha256': hashlib.sha256(source.read_bytes()).hexdigest()})
binary = b''.join(chunks)
(out / 'wind.bin').write_bytes(binary)
manifest = {'id': 'gfs-wind', 'model': 'NCEP GFS', 'source': 'NOAA / NCEP NOMADS',
    'sourceUrl': 'https://nomads.ncep.noaa.gov/gribfilter.php?ds=gfs_1p00', 'referenceTime': reference,
    'width': 360, 'height': 181, 'lonStart': 0, 'latStart': 90, 'dx': 1, 'dy': 1,
    'scale': .01, 'units': 'm/s', 'encoding': 'interleaved-int16-le',
    'binaryUrl': '/visualizations/gfs/wind.bin', 'binaryBytes': len(binary),
    'sha256': hashlib.sha256(binary).hexdigest(), 'levels': [{'id': '10m', 'label': '近地面 10 m'}, {'id': '250hPa', 'label': '250 hPa'}],
    'originals': originals, 'frames': frames}
(root / 'src/data/evidence/wind-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
(out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'referenceTime': reference, 'frames': len(frames), 'bytes': len(binary), 'maxSpeeds': [f['maxSpeed'] for f in frames]}))
