"""Inspect, render or sample the pinned Haina VIIRS COG on a WGS84 tile grid."""
import argparse
from hashlib import file_digest
import json
import math
from pathlib import Path
import sys

import numpy as np
from PIL import Image
import tifffile

from haina_viirs_source import ETAG, OBJECT, SIZE

TILE_SIZE = 256
MAX_ZOOM = 8
PALETTE = np.array([[0, 34, 77], [67, 78, 107], [124, 123, 120], [187, 173, 108], [253, 231, 55]])
GRID = (33600, 86400)
SOURCE = "https://cn.zero2x.org/data-hub/portal/dataset?id=1835833"


class Raster:
    def __init__(self, tiff):
        self.levels = [level.pages[0] for level in tiff.series[0].levels]
        base = self.levels[0]
        geo = base.geotiff_tags
        if (base.shape != GRID or base.dtype != np.dtype("float32")
                or int(geo.get("GeographicTypeGeoKey", geo.get("GeodeticCRSGeoKey"))) != 4326
                or any(not level.is_tiled for level in self.levels)):
            raise ValueError("unexpected native VIIRS source grid")
        dx, dy, _ = base.tags["ModelPixelScaleTag"].value
        i, j, _, x, y, _ = base.tags["ModelTiepointTag"].value
        self.west, self.north = x - dx*i, y + dy*j
        self.width = base.imagewidth*dx
        self.height = base.imagelength*dy
        self.east, self.south = self.west+self.width, self.north-self.height
        self.nodata = float(base.tags[42113].value) if 42113 in base.tags else None

    def spacing(self, level):
        page = self.levels[level]
        return self.width/page.imagewidth, self.height/page.imagelength

    def overview(self, target):
        return max((level for level in range(len(self.levels)) if max(self.spacing(level)) <= target), default=0)

    def columns(self, longitude, level):
        # The outer pixel straddles the dateline. Normalize to the native grid's
        # west origin (which differs from -180 by half a pixel).
        dx, _ = self.spacing(level)
        x = np.mod(np.asarray(longitude) - self.west, 360.0)
        return np.floor(x/dx).astype(int)

    def rows(self, latitude, level):
        _, dy = self.spacing(level)
        return np.floor((self.north-np.asarray(latitude))/dy).astype(int)

    def read_indexed(self, level, rows, cols):
        page = self.levels[level]
        h, w = page.tilelength, page.tilewidth
        across = math.ceil(page.imagewidth/w)
        output = np.full((len(rows),len(cols)), np.nan, dtype=np.float32)
        rowgroups, colgroups = rows//h, cols//w
        for ty in sorted(set(rowgroups)):
            yi = np.flatnonzero((rowgroups == ty) & (rows>=0) & (rows<page.imagelength))
            if not yi.size:
                continue
            for tx in sorted(set(colgroups)):
                xi = np.flatnonzero((colgroups == tx) & (cols>=0) & (cols<page.imagewidth))
                if not xi.size:
                    continue
                tile = ty*across+tx
                offset, length = page.dataoffsets[tile], page.databytecounts[tile]
                if not length:
                    continue
                handle = page.parent.filehandle
                handle.seek(offset)
                data = np.squeeze(page.decode(handle.read(length), tile)[0])
                if data.shape != (h,w):
                    raise ValueError("VIIRS decoded tile shape changed")
                output[np.ix_(yi,xi)] = data[np.ix_(rows[yi]%h,cols[xi]%w)]
        if self.nodata is not None:
            output[output==self.nodata] = np.nan
        output[~np.isfinite(output)] = np.nan
        return output

    def sample(self, lon, lat):
        row, col = int(self.rows(lat,0)), int(self.columns(lon,0))
        if not (0 <= row < GRID[0] and 0 <= col < GRID[1]):
            return {"status":"out-of-coverage", "value":None}
        value = float(self.read_indexed(0,np.array([row]),np.array([col]))[0,0])
        dx, dy = self.spacing(0)
        center = [(self.west+(col+.5)*dx+180)%360-180, self.north-(row+.5)*dy]
        return {"status":"value" if math.isfinite(value) else "no-data",
                "value":value if math.isfinite(value) else None, "center":center, "row":row, "column":col}

    def tile(self, z, x, y):
        step = 180 / (2**z*TILE_SIZE)
        level = self.overview(step)
        centers = (np.arange(TILE_SIZE)+.5)*step
        cols = self.columns(-180+x*TILE_SIZE*step+centers, level)
        rows = self.rows(90-y*TILE_SIZE*step-centers, level)
        values = self.read_indexed(level, rows, cols)
        valid = np.isfinite(values)
        display = np.clip(np.log1p(np.maximum(np.where(valid,values,0),0))/np.log1p(450),0,1)
        rgba = np.zeros((TILE_SIZE,TILE_SIZE,4),dtype=np.uint8)
        stops = np.linspace(0,1,len(PALETTE))
        for ch in range(3):
            rgba[:,:,ch] = np.interp(display,stops,PALETTE[:,ch])
        rgba[:,:,3] = np.where(valid,255,0)
        return Image.fromarray(rgba)

    def manifest(self, digest):
        return {"version":1,"datasetId":1835833,"revision":digest,
                "title":"VIIRS 月度夜间灯光","period":"2025 年 8 月",
                "description":"由海纳 COG 按视野和分辨率绘制。取样读取 15″ 原像元；高纬超出源覆盖，缺测以透明显示。显示色为统一对数拉伸，原值单位和晴空观测计数待核。",
                "source":SOURCE,"sourceBounds":[self.west,self.south,self.east,self.north],
                "tileSize":TILE_SIZE,"maxZoom":MAX_ZOOM,"defaultView":{"center":[15,18],"zoom":1},
                "nativeSize":[GRID[1],GRID[0]],"nativePixelSize":list(self.spacing(0)),
                "overviewSizes":[[v.imagewidth,v.imagelength] for v in self.levels]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    modes = parser.add_subparsers(dest="mode", required=True)
    inspect = modes.add_parser("inspect")
    inspect.add_argument("--receipt", type=Path, required=True)
    render = modes.add_parser("tile")
    for name in ("z","x","y"):
        render.add_argument(name,type=int)
    sample = modes.add_parser("sample")
    sample.add_argument("lon",type=float)
    sample.add_argument("lat",type=float)
    args = parser.parse_args()
    if args.source.name != OBJECT or args.source.stat().st_size != SIZE:
        raise ValueError("VIIRS local source length or name changed")
    with tifffile.TiffFile(args.source) as tiff:
        raster = Raster(tiff)
        if args.mode == "inspect":
            receipt = json.loads(args.receipt.read_text())
            with args.source.open("rb") as file:
                digest = file_digest(file,"sha256").hexdigest()
            if receipt != {"datasetId":1835833,"object":OBJECT,"bytes":SIZE,"etag":ETAG,"sha256":digest}:
                raise ValueError("VIIRS source and pinned receipts differ")
            print(json.dumps(raster.manifest(digest),ensure_ascii=False,indent=2))
        elif args.mode == "tile":
            z, x, y = args.z, args.x, args.y
            if not 0<=z<=MAX_ZOOM or not (0<=x<2**(z+1) and 0<=y<2**z):
                raise ValueError("geographic tile outside available grid")
            raster.tile(z,x,y).save(sys.stdout.buffer,format="PNG")
        elif args.mode == "sample":
            if not -180<=args.lon<=180 or not -90<=args.lat<=90:
                raise ValueError("native sample outside WGS84")
            print(json.dumps(raster.sample(args.lon,args.lat),allow_nan=False))


if __name__ == "__main__":
    main()
