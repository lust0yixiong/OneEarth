"""Read bounded native windows from the verified August 2025 Haina VIIRS COG."""
from hashlib import sha256
import io
import json
import math
import tempfile
from pathlib import Path

from affine import Affine
import numpy as np
import requests
import tifffile

OBJECT = "SVDNB_npp_20250801_20250831_Global_cog.tif"
SIZE = 4753924147
ETAG = '"C761F3ABC311B94BC65841F31019B3AE"'

class COGReader(io.RawIOBase):
    name = OBJECT
    block_size = 128 << 10
    transfer_limit = 32 << 20

    def __init__(self, signed_url, cache):
        self.signed_url = signed_url
        self.cache = cache
        self.position = 0
        self.session = requests.Session()
        self.trace = []
        self.network_bytes = 0

    def close(self):
        self.session.close()
        super().close()

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=io.SEEK_SET):
        base = {io.SEEK_SET: 0, io.SEEK_CUR: self.position, io.SEEK_END: SIZE}[whence]
        self.position = base + offset
        if self.position < 0:
            raise ValueError("negative byte offset")
        return self.position

    def range(self, start, size):
        end = start + size - 1
        if not 0 <= start <= end < SIZE or size > self.transfer_limit:
            raise ValueError("VIIRS range exceeds inspected object or request cap")
        cached = self.cache / f"{start}-{end}"
        if (cached / "receipt.json").is_file():
            receipt = json.loads((cached / "receipt.json").read_text())
            body = (cached / "body").read_bytes()
            if (receipt.get("sha256"), receipt.get("etag"), receipt.get("range"), len(body)) != (
                sha256(body).hexdigest(), ETAG, f"bytes {start}-{end}/{SIZE}", size
            ):
                raise ValueError("VIIRS range cache failed provenance validation")
            mode = "cache"
        else:
            if not self.signed_url:
                raise ValueError(f"VIIRS cache lacks required range {start}-{end}")
            if self.network_bytes + size > self.transfer_limit:
                raise ValueError("VIIRS transfer exceeds 32 MiB; reduce windows per invocation")
            headers = {"Range": f"bytes={start}-{end}", "Accept-Encoding": "identity", "If-Range": ETAG}
            try:
                with self.session.get(self.signed_url(), headers=headers, timeout=(10, 30), stream=True) as response:
                    if (response.status_code, response.headers.get("Content-Range"), response.headers.get("ETag")) != (
                        206, f"bytes {start}-{end}/{SIZE}", ETAG
                    ):
                        raise ValueError(f"Haina did not return the pinned VIIRS range (HTTP {response.status_code})")
                    body = response.raw.read(size + 1)
            except requests.RequestException as exc:
                raise ValueError(f"Haina VIIRS range unavailable ({type(exc).__name__})") from None
            if len(body) != size:
                raise ValueError("VIIRS range length differs from the requested bytes")
            self.network_bytes += size
            receipt = {"range": f"bytes {start}-{end}/{SIZE}", "etag": ETAG, "sha256": sha256(body).hexdigest()}
            cached.mkdir(parents=True, exist_ok=True)
            for filename, payload in (("body",body), ("receipt.json",(json.dumps(receipt, sort_keys=True) + "\n").encode())):
                with tempfile.NamedTemporaryFile(dir=cached, delete=False) as output:
                    output.write(payload)
                    temporary = Path(output.name)
                temporary.replace(cached / filename)
            mode = "haina-range-206"
        self.trace.append({**receipt, "bytes": size, "readFrom": mode})
        return body

    def read(self, size=-1):
        stop = SIZE if size < 0 else min(SIZE, self.position + size)
        if stop - self.position > self.transfer_limit:
            raise ValueError("full VIIRS COG download is disabled")
        output = bytearray()
        while self.position < stop:
            start = self.position // self.block_size * self.block_size
            chunk = self.range(start, min(self.block_size, SIZE - start))
            end = min(start + len(chunk), stop)
            output.extend(chunk[self.position-start:end-start])
            self.position = end
        return bytes(output)

    def readinto(self, buffer):
        data = self.read(len(buffer))
        buffer[:len(data)] = data
        return len(data)

def read_windows(signed_url, cache: Path, regions, radius):
    with COGReader(signed_url, cache) as source, tifffile.TiffFile(source) as tiff:
        page = tiff.pages[0]
        geo = page.geotiff_tags
        geographic = geo.get("GeographicTypeGeoKey", geo.get("GeodeticCRSGeoKey"))
        if int(geographic) != 4326 or page.shape != (33600, 86400) or not page.is_tiled or page.dtype != np.dtype("float32"):
            raise ValueError("VIIRS base IFD differs from the inspected WGS 84 float grid")
        dx, dy, _ = page.tags["ModelPixelScaleTag"].value
        i, j, _, x, y, _ = page.tags["ModelTiepointTag"].value
        grid = Affine(dx, 0, x-i*dx, 0, -dy, y+j*dy)
        nodata = float(page.tags[42113].value) if 42113 in page.tags else None
        h, w = page.tilelength, page.tilewidth
        tiles_across = math.ceil(page.imagewidth / w)
        tiles = {}
        result = {}
        for name, longitude, latitude, bbox in regions:
            col, row = map(math.floor, (~grid) * (longitude, latitude))
            if not 0 <= row < page.imagelength or not 0 <= col < page.imagewidth:
                raise ValueError(f"VIIRS viewport outside the source grid: {name}")
            if bbox:
                west, south, east, north = bbox
                left, top = (~grid) * (west, north)
                right, bottom = (~grid) * (east, south)
                x0, y0, x1, y1 = math.floor(left), math.floor(top), math.ceil(right), math.ceil(bottom)
                if not (0 <= x0 < x1 <= page.imagewidth and 0 <= y0 < y1 <= page.imagelength):
                    raise ValueError(f"VIIRS bbox exceeds the source grid: {name}")
                if max(x1-x0,y1-y0)>256:
                    raise ValueError("VIIRS native bbox is limited to 256 pixels per side")
            else:
                y0, y1 = max(row-radius,0), min(row+radius+1,page.imagelength)
                x0, x1 = max(col-radius,0), min(col+radius+1,page.imagewidth)
            data = np.full((y1-y0, x1-x0), np.nan, dtype="float32")
            for tile_y in range(y0//h, (y1-1)//h+1):
                for tile_x in range(x0//w, (x1-1)//w+1):
                    index = tile_y * tiles_across + tile_x
                    if index not in tiles:
                        offset, size = page.dataoffsets[index], page.databytecounts[index]
                        if size == 0:
                            tiles[index] = np.full((h,w), np.nan, dtype="float32")
                        else:
                            decoded = np.squeeze(page.decode(source.range(offset,size), index)[0])
                            if decoded.shape != (h,w):
                                raise ValueError("VIIRS decoded tile shape changed")
                            tiles[index] = decoded
                    top, bottom = max(y0,tile_y*h), min(y1,(tile_y+1)*h)
                    left, right = max(x0,tile_x*w), min(x1,(tile_x+1)*w)
                    data[top-y0:bottom-y0,left-x0:right-x0] = tiles[index][top-tile_y*h:bottom-tile_y*h,left-tile_x*w:right-tile_x*w]
            if nodata is not None:
                data[data == nodata] = np.nan
            data[~np.isfinite(data)] = np.nan
            if not np.isfinite(data).any():
                raise ValueError(f"VIIRS window has no finite values: {name}")
            transform=grid * Affine.translation(x0,y0)
            result[name]=(data,transform,(row-y0,col-x0),{"sourceRowCol":[row,col],"tileIndices":[yy*tiles_across+xx for yy in range(y0//h,(y1-1)//h+1) for xx in range(x0//w,(x1-1)//w+1)]})
        return result, {"object":OBJECT,"length":SIZE,"etag":ETAG,"rangeReads":source.trace,"networkBytes":source.network_bytes}
