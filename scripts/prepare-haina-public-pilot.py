"""Generate the first three Haina publication bundles and scientific QA receipts."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile

import numpy as np
from PIL import Image
from pyproj import CRS, Transformer
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import Affine, array_bounds, from_bounds
from rasterio.warp import reproject
import shapefile

from haina_viirs_window import OBJECT, read_windows

VOLCANO_HASHES = {
    ".shp": "82489b96b14f2e84cc99050207baf092079887fe06a4a753c7849f3eed137df1",
    ".shx": "b12b2c6733d5532c37a08fabf7da91eb3c047b0c6cf39395e87615b6cf9a5fa7",
    ".prj": "a02a27b1d1982c8516d83398e85a3c8b1aef1713c13ef4d84d7bde17430c07c4",
    ".dbf": "c453e9bd3e24b3bdbfedcbe3b29b513067b337ca21cd077f767e4a0eef2ddf0d",
    ".cpg": "3ad3031f5503a4404af825262ee8232cc04d4ea6683d42c5dd0a2f2a27ac9824",
}
PATCH_FILES = {
    "s2/patch_000186/20250409.tif": "9463ef7734a110179eb1b49a23dff14fd4abbe89e78b4588cbad26083ac9a2a1",
    "s2/patch_000186/20250427.tif": "31259a8470ee1c83d433d1a73969cc21fff92bb32635d6d041f8c824240d70da",
    "worldcover/patch_000186/static.tif": "5b0a516f38248bfd51fe82e8700f45cf0ccf23ba7e6cd62f667c18fd6b5cfa51",
}
AGE = {
    "volcano": (None, None),
    "viirs": ("2025-08-01", "2025-08-31"),
    "xuannv": ("2025-04-01", "2025-04-30"),
}
DEFAULT_WINDOWS = {
    "nyc": ("纽约", -73.9855, 40.7484, None),
    "tokyo": ("东京", 139.7671, 35.6812, None),
}

def need(condition, message):
    if not condition:
        raise ValueError(message)

def checksum(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()

def pin(path, expected):
    need(checksum(path) == expected, f"source digest mismatch for {path.name}")
    return {"name": path.name, "sha256": expected, "bytes": path.stat().st_size}

def encode(value):
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode()

class Bundle:
    def __init__(self, root):
        self.root = root
        self.layers = []

    def layer(self, dataset, title, period, description, default, views, assets):
        source = f"https://cn.zero2x.org/data-hub/portal/dataset?id={dataset}"
        manifest = {"version":1,"datasetId":dataset,"title":title,"period":period,"description":description,
                    "source":source,"defaultView":default,"views":views}
        self.add(dataset,"manifest","json",encode(manifest),"application/json",assets)
        self.layers.append({"id":str(dataset),"entity_id":f"haina:{dataset}","version":"public-v1",
                            "title":title,"source":source,"assets":assets})
        return manifest

    def add(self, dataset, stem, suffix, data, media, assets, bounds=None, dates=(None,None)):
        digest = hashlib.sha256(data).hexdigest()
        name = "manifest.json" if stem == "manifest" else f"{stem}-{digest}.{suffix}"
        local = Path(str(dataset)) / name
        target = self.root / local
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        route = f"/visualizations/haina/{dataset}/public-v1/{name}"
        start,end = dates
        assets.append({"route":route,"file":str(local),"media":media,"sha256":digest,"size":len(data),
                       "bounds":bounds,"starts":start,"ends":end,"level":0 if bounds is not None else None})
        return route

    def png(self, dataset, name, rgb, assets, bounds, dates):
        import io
        buffer=io.BytesIO()
        Image.fromarray(rgb).save(buffer,format="PNG",compress_level=6)
        with Image.open(io.BytesIO(buffer.getvalue())) as check:
            need(np.array_equal(np.asarray(check),rgb),"PNG round-trip changed pixels")
        return self.add(dataset,name,"png",buffer.getvalue(),"image/png",assets,bounds,dates)

def view(id, label, bounds, zoom, kind, **files):
    west,south,east,north=bounds
    return {"id":id,"label":label,"bounds":bounds,"center":[(west+east)/2,(south+north)/2],
            "zoom":zoom,"kind":kind,**files}

def volcano(prior, bundle):
    shp = prior/"integration/source/1835839/Volcano_Holocene_clip.shp"
    proof = [pin(shp.with_suffix(suffix), expected) for suffix, expected in VOLCANO_HASHES.items()]
    need(CRS.from_wkt(shp.with_suffix(".prj").read_text()).to_epsg()==4326,"volcano CRS changed")
    properties = {
        "name":"Volcano_Na", "country_as_reported":"Country","landform":"Volcano_La","volcanic_arc":"Volcanic_1",
        "primary_type":"Primary_Vo","activity_evidence":"Activity_E","last_known_eruption_as_reported":"Last_Known",
        "elevation_m":"Elevation","tectonic_setting":"Tectonic_S","dominant_rock":"Dominant_R",
    }
    features=[]
    with shapefile.Reader(str(shp), encoding="utf-8") as reader:
        need(reader.shapeTypeName=="POINT","volcano source is no longer point geometry")
        for row in reader.iterShapeRecords():
            attributes=row.record.as_dict()
            need(len(row.shape.points)==1,"volcano record has an invalid point")
            pt=list(map(float,row.shape.points[0]))
            need(all(math.isfinite(v) for v in pt) and -180<=pt[0]<=180 and -90<=pt[1]<=90,"invalid volcano coordinate")
            need(np.allclose(pt,[attributes["Longitude"],attributes["Latitude"]],rtol=0,atol=1e-7),"volcano DBF coordinates disagree")
            ident=int(attributes["Volcano_Nu"])
            features.append({"type":"Feature","id":ident,"geometry":{"type":"Point","coordinates":pt},
                             "properties":{"volcano_number":ident,**{key:attributes[col] for key,col in properties.items()}}})
    need(len(features)==len({item["id"] for item in features})==85,"volcano point count or identities changed")
    x,y=zip(*(row["geometry"]["coordinates"] for row in features))
    bounds = [min(x),min(y),max(x),max(y)]
    assets=[]
    route=bundle.add(1835839,"andes","geojson",encode({"type":"FeatureCollection","bbox":bounds,"features":features}),
                     "application/geo+json",assets,bounds,AGE["volcano"])
    manifest=bundle.layer(1835839,"安第斯全新世火山","全新世（资料编录）",
        "海纳这一归档有 85 个南美安第斯火山点。点位对应火山，末次已知喷发及活动证据沿源表记录，不能表示逐次喷发事件或全球清单。",
        "andes",[view("andes","安第斯 85 个火山点",bounds,3.5,"points",data=route,count=85)],assets)
    return {"datasetId":1835839,"inputs":proof,"points":85,"geometryAttributeMatches":85,"example":features[0],"manifest":manifest}

def haina_url():
    from haina_datahub import DatasetClient
    ak=os.environ.get("HAINA_DATAHUB_AK") or os.environ.get("HAINA_ACCESS_KEY_ID")
    sk=os.environ.get("HAINA_DATAHUB_SK") or os.environ.get("HAINA_SECRET_ACCESS_KEY")
    need(ak and sk,"Haina SDK credentials must be injected for --live-viirs")
    client=DatasetClient(ak,sk)
    def signed():
        try:
            url=client.get_download_url(1835833,OBJECT)
        except Exception as exc:
            raise ValueError(f"Haina SDK could not sign the verified object ({type(exc).__name__})") from None
        need(isinstance(url,str) and url.startswith("https://"),"Haina SDK did not return an HTTPS object URL")
        return url
    return signed

def viirs(bundle, cache, live, windows, radius):
    regions=[(name,lon,lat,bbox) for name,(_label,lon,lat,bbox) in windows.items()]
    windows_data, receipt = read_windows(haina_url() if live else None,cache,regions,radius)
    assets,views,reports=[],[],[]
    # One scale across viewports. Negative finite source data remain intact in the numerical grid.
    palette=np.array([[0,34,77],[67,78,107],[124,123,120],[187,173,108],[253,231,55]],dtype=float)
    x=np.linspace(0,1,len(palette))
    for name,(data,transform,probe,source) in windows_data.items():
        height,width=data.shape
        bounds=list(array_bounds(height,width,transform))
        valid=np.isfinite(data)
        if name=="nyc" and radius==20 and windows[name][3] is None:
            need(int(valid.sum())==1681 and abs(float(data[probe])-275.8699951171875)<1e-6,
                 "NYC COG window disagrees with independent first-sample proof")
        display=np.clip(np.log1p(np.maximum(np.where(valid,data,0),0))/np.log1p(450),0,1)
        rgba=np.zeros((height,width,4),dtype=np.uint8)
        for channel in range(3):
            rgba[...,channel]=np.interp(display,x,palette[:,channel]).astype(np.uint8)
        rgba[...,3]=np.where(valid,255,0)
        image=bundle.png(1835833,name,rgba,assets,bounds,AGE["viirs"])
        flat=[float(v) if math.isfinite(v) else None for v in data.ravel()]
        grid_data={"version":1,"width":width,"height":height,"bounds":bounds,"values":flat}
        decoded=np.array([np.nan if v is None else v for v in json.loads(encode(grid_data))["values"]], dtype=np.float32).reshape(height,width)
        need(np.array_equal(data,decoded,equal_nan=True),"VIIRS serialized grid changed source values")
        grid=bundle.add(1835833,name+"-grid","json",encode(grid_data),"application/json",assets,bounds,AGE["viirs"])
        views.append(view(name,windows[name][0],bounds,200,"raster",image=image,grid=grid))
        row,col=probe
        reports.append({"id":name,"bounds":bounds,"shape":list(data.shape),"source":source,"valid":int(valid.sum()),
                        "positive":int((data[valid]>0).sum()),"min":float(data[valid].min()),"max":float(data[valid].max()),
                        "probe":{"lonLat":list(transform*(col+.5,row+.5)),"rowCol":[row,col],"value":flat[row*width+col]}})
    label="、".join(v["label"] for v in views)
    manifest=bundle.layer(1835833,"VIIRS 月度夜间灯光","2025 年 8 月",
        f"海纳月度 COG 的 15″ 原网格，本次发布 {label}有限视窗。点选读取源数值，单位及晴空观测计数待核；窗口外暂无发布块，零值不用于推断无灯光。颜色采用统一对数拉伸。",
        views[0]["id"],views,assets)
    return {"datasetId":1835833,"rangeRead":receipt,"windows":reports,"manifest":manifest}

def xuannv(prior,bundle):
    root=prior/"spatial/raw/1846104"
    vectors=root/"mini_test/embeddings/v5_mixed_scale/monthly_embeddings_2025/patch_000186_2025-04.npy"
    index=root/"patches-meta-extracted.json"
    index_receipt=pin(index,"f833e45f7bcea1a98b1a30bcb8df05829cfc7a811fadea99a5aa7c4443f734be")
    inputs=[index_receipt,pin(vectors,"f75f7b680bfc4ac26c02abc9d06dc83433fd2eb4c7ba72194be83867170cfb2f")]
    patches=json.loads(index.read_text())
    need(len(patches)==len({p["patch_id"] for p in patches})==424,"unexpected patch index")
    patch=next(p for p in patches if p["patch_id"]=="patch_000186")
    native_transform,native_crs=None,None
    for name,digest in PATCH_FILES.items():
        file=root/"mini_test/raw_data"/name
        inputs.append(pin(file,digest))
        with rasterio.open(file) as src:
            need((src.width,src.height,src.res)==(128,128,(10,10)) and str(src.crs)==patch["crs"]
                 and list(src.bounds)==patch["bounds"],"reference raster disagrees with Haina patch index")
            if native_transform is not None:
                need(src.transform==native_transform,"reference rasters disagree on grid transform")
            native_transform,native_crs=src.transform,src.crs
    embedding=np.load(vectors,allow_pickle=False)
    norms=np.linalg.norm(embedding,axis=0)
    need(embedding.shape==(128,64,64) and np.isfinite(embedding).all() and np.allclose(norms,1,rtol=0,atol=1e-6),
         "April patch vector shape or finite unit norms failed")
    samples=embedding.reshape(128,-1).T.astype(np.float64)
    mean=samples.mean(axis=0)
    centered=samples-mean
    eigenvalues,basis=np.linalg.eigh(centered.T@centered)
    axes=basis[:,-3:][:,::-1]
    axes*=np.sign(axes[np.argmax(np.abs(axes),axis=0),np.arange(3)])
    scores=(centered@axes).T.reshape(3,64,64)
    low,high=np.quantile(scores,[.02,.98],axis=(1,2))
    rgb=(255*np.clip((scores-low[:,None,None])/(high-low)[:,None,None],0,1)).round().astype(np.uint8)
    transform=native_transform*Affine.scale(2)
    project=Transformer.from_crs(native_crs,4326,always_xy=True)
    x,y=zip(*(project.transform(*(transform*pt)) for pt in [(0,0),(0,64),(64,64),(64,0)]))
    bounds=[min(x),min(y),max(x),max(y)]
    grid=from_bounds(*bounds,64,64)
    # A separate display reprojection keeps the native grid and the equirectangular globe placement explicit.
    rgba=np.zeros((64,64,4),dtype=np.uint8)
    for channel in range(4):
        source=rgb[channel] if channel<3 else np.full((64,64),255,dtype=np.uint8)
        out=np.zeros((64,64),dtype=np.uint8)
        reproject(source,out,src_transform=transform,src_crs=native_crs,dst_transform=grid,dst_crs="EPSG:4326",
                  resampling=Resampling.nearest)
        rgba[...,channel]=out
    col=row=32
    xy=transform*(col+.5,row+.5)
    need(xy==native_transform*(2*col+1,2*row+1),"embedding pixel centre lost native image alignment")
    probe=project.transform(*xy)
    dst_col,dst_row=map(math.floor,(~grid)*probe)
    sampled_xy=Transformer.from_crs(4326,native_crs,always_xy=True).transform(*(grid*(dst_col+.5,dst_row+.5)))
    col2,row2=map(math.floor,(~transform)*sampled_xy)
    need(np.array_equal(rgba[dst_row,dst_col],np.r_[rgb[:,row2,col2],255]),"WGS 84 display pixel does not match native PCA grid")
    assets=[]
    image=bundle.png(1846104,"patch-000186",rgba,assets,bounds,AGE["xuannv"])
    manifest=bundle.layer(1846104,"玄女哈尔滨嵌入","2025 年 4 月",
        "仅发布 V5 patch_000186 的 64×64 个向量格；按海纳索引与同编号原栅格定位。颜色由这个 patch 的 128 维向量经 PCA 生成，表示特征差异。",
        "patch-000186",[view("patch-000186","哈尔滨 patch_000186",bounds,700,"raster",image=image,count=4096)],assets)
    return {"datasetId":1846104,"inputs":inputs,"patch":patch,"nativeShape":[64,64],"nativeResolutionMetres":[20,20],
            "validVectors":int(np.count_nonzero(norms>0)),"normRange":[float(norms.min()),float(norms.max())],
            "probe":{"lonLat":list(probe),"embeddingRowCol":[row,col],"originalS2RowsColumns":[[64,65],[64,65]],
                     "pca":list(scores[:,row,col]),"displayPixel":rgba[dst_row,dst_col].tolist(),
                     "displayCorrespondsToEmbeddingRowCol":[row2,col2]},
            "explainedVariance":list(eigenvalues[-3:][::-1]/eigenvalues.sum()),"manifest":manifest}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prior-root",required=True,type=Path)
    parser.add_argument("--output",required=True,type=Path)
    parser.add_argument("--range-cache",required=True,type=Path)
    parser.add_argument("--live-viirs",action="store_true")
    parser.add_argument("--viirs-radius",type=int,default=20)
    parser.add_argument("--viirs-bbox",action="append",nargs=6,default=[],metavar=("ID","LABEL","WEST","SOUTH","EAST","NORTH"))
    args=parser.parse_args()
    os.umask(0o077)
    need(0<=args.viirs_radius<=127,"VIIRS radius must be 0–127 native pixels")
    need(not args.output.exists(),"choose a fresh output directory")
    windows=DEFAULT_WINDOWS.copy()
    for name,label,*coordinates in args.viirs_bbox:
        need(re.fullmatch(r"[a-z0-9][a-z0-9-]{0,35}",name) and name not in windows and bool(label.strip()),"invalid or duplicate VIIRS view ID/label")
        west,south,east,north=map(float,coordinates)
        need(-180<=west<east<=180 and -90<=south<north<=90,"VIIRS view must have an ordered WGS 84 bbox")
        windows[name]=(label,(west+east)/2,(south+north)/2,(west,south,east,north))
    need(len(windows)<=8,"publication limited to eight VIIRS views")
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=args.output.parent) as staging:
        staged=Path(staging)/"publication"
        staged.mkdir()
        bundle=Bundle(staged)
        proof=[volcano(args.prior_root,bundle), viirs(bundle,args.range_cache,args.live_viirs,windows,args.viirs_radius),
               xuannv(args.prior_root,bundle)]
        (staged/"publication.json").write_bytes(encode({"version":1,"layers":bundle.layers}))
        (staged/"verification.json").write_text(json.dumps(proof,ensure_ascii=False,indent=2,allow_nan=False)+"\n")
        staged.rename(args.output)
    print(json.dumps({"output":str(args.output),"layers":[l["id"] for l in bundle.layers],
                      "objects":sum(len(l["assets"]) for l in bundle.layers)},ensure_ascii=False))

if __name__=="__main__":
    try:
        main()
    except Exception as error:
        print(f"Pilot preparation failed: {error}",file=sys.stderr)
        sys.exit(1)
