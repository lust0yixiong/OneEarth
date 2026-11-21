"""Build 2024 native-grid assets from NOAA PSL cpc_global_precip/precip.2024.nc.

Run with uv run --with numpy --with h5py python scripts/prepare-cpc-rain.py precip.2024.nc
"""
import calendar
import datetime
import gzip
import json
import sys
from pathlib import Path

import h5py
import numpy as np

root = Path(__file__).resolve().parents[1] / "public/visualizations"
outline = json.loads((root / "regional/rain.json").read_text())["outline"]
with h5py.File(sys.argv[1]) as nc:
    np.testing.assert_array_equal(nc["lon"][:], np.arange(.25, 360, .5))
    np.testing.assert_array_equal(nc["lat"][:], np.arange(89.75, -90, -.5))
    source = nc["precip"]
    assert source.shape == (366, 360, 720)
    assert float(source.attrs.get("scale_factor", 1)) == 1
    assert float(source.attrs.get("add_offset", 0)) == 0
    minimum, maximum = source.attrs["valid_range"]
    # Read daily data once per monthly block. CPC encodes missing with negative fill.
    monthly = []
    china = []
    day = 0
    for month in range(1, 13):
        days = calendar.monthrange(2024, month)[1]
        values = source[day:day+days]
        valid = np.isfinite(values) & (values >= minimum) & (values <= maximum)
        values[~valid] = 0
        count = valid.sum(axis=0)
        mean = values.sum(axis=0,dtype=np.float64) / np.maximum(count,1)
        packed = np.rint(mean*100)
        assert packed.max() < 65535
        monthly.append(np.where(count >= .8*days,packed,65535).astype("<u2"))
        china.append(np.where(valid[:,72:144,146:270], values[:,72:144,146:270],np.nan))
        day += days
    lats = nc["lat"][72:144]
    lons = nc["lon"][146:270]

def inside(x,y,ring):
    result = False
    a,b = ring[-1]
    for c,d in ring:
        if (b>y)!=(d>y) and x<(a-c)*(y-d)/(b-d)+c:
            result = not result
        a,b = c,d
    return result

cells = [(r,c) for r,y in enumerate(lats.tolist()) for c,x in enumerate(lons.tolist())
         if any(inside(x,y,ring) for ring in outline)]
rr,cc = np.array(cells).T
daily = np.concatenate(china)[:,rr,cc]
frames,dates = [],[]
for last in range(13,366,3):
    window = daily[last-13:last+1]
    mean = window.mean(axis=0,dtype=np.float64)
    frames.append([round(v,1) if np.isfinite(v) else None for v in mean.tolist()])
    dates.append((datetime.date(2024,1,1)+datetime.timedelta(days=last)).isoformat())
regional = dict(outline=outline, points=[dict(xy=[float(lons[c]),float(lats[r])]) for r,c in cells],
                dates=dates,frames=frames)
(root/"regional/rain-native.json").write_text(json.dumps(regional,separators=(",",":"),allow_nan=False))
(root/"precip/cpc-2024-native.bin.gz").write_bytes(gzip.compress(np.stack(monthly).tobytes(),compresslevel=6,mtime=0))
print("Monthly valid cells:", [np.count_nonzero(m!=65535) for m in monthly], "China points:",len(cells))
