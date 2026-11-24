"""Generate restartable WGS84 Xuannv V5 frames from the verified Haina archive."""
from argparse import ArgumentParser
from collections import Counter, defaultdict
from hashlib import file_digest, sha256
import fcntl
import gzip
import io
import json
import os
from pathlib import Path
import re
import sys
import tarfile
import tempfile

import numpy as np
from PIL import Image
from pyproj import Transformer

INDEX_SHA = "f833e45f7bcea1a98b1a30bcb8df05829cfc7a811fadea99a5aa7c4443f734be"
DATASET = 1846104
ARCHIVE = "embeddings/v5_mixed_scale.tar.gz"
ARCHIVE_SIZE = 4118352525
ARCHIVE_ETAG = '"1919F6C0D6539BC7A3583FA1F4DCE316-400"'
MODEL = "Xuannv V5 mixed scale"
ALGORITHM = "shared-pca-stratified-8x8-v1"
SAMPLE_GRID = np.arange(4,64,8)
DISPLAY_PIXELS = 80
MEMBER = re.compile(r"embeddings/v5_mixed_scale/monthly_embeddings_\d{4}/(patch_\d{6})_(\d{4}-(?:0[1-9]|1[0-2]))\.npy")
META_MEMBER = "embeddings/v5_mixed_scale/monthly_embeddings_2025/meta.json"

def require(flag, message):
    if not flag:
        raise ValueError(message)

def digest_file(path):
    with path.open("rb") as f:
        return file_digest(f,"sha256").hexdigest()

def encode(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":"),allow_nan=False).encode()+b"\n"

def atomic(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as tmp:
        tmp.write(data)
        name=Path(tmp.name)
    name.replace(path)

def save(path,data):
    atomic(path,encode(data))

def load(path):
    return json.loads(path.read_bytes())

def progress(stage, **data):
    print(json.dumps({"stage":stage,**data},ensure_ascii=False,allow_nan=False),flush=True)

def verify_inputs(args):
    receipt=load(args.archive_receipt)
    require((receipt["datasetId"],receipt["object"],receipt["size"],receipt["etag"],receipt["state"])==
            (DATASET,ARCHIVE,ARCHIVE_SIZE,ARCHIVE_ETAG,"complete"),"archive source receipt is not the authorized V5 object")
    require(args.archive.stat().st_size==ARCHIVE_SIZE and digest_file(args.archive)==receipt["sha256"],
            "archive failed authenticated full-file SHA-256")
    require(digest_file(args.patch_index)==INDEX_SHA,"patch-index digest changed")
    rows=load(args.patch_index)
    index={row["patch_id"]:row for row in rows}
    distinct={(row["crs"],*row["bounds"]) for row in rows}
    require(len(index)==len(rows)==len(distinct),"patch index has duplicate ID or geometry")
    geographic=load(args.georeferences)
    require(geographic["indexSha256"]==INDEX_SHA and geographic["datasetId"]==DATASET,"wrong WorldCover proof")
    sources={row["patchId"]:row for row in geographic["rows"]}
    verified={}
    problems={}
    for name,row in index.items():
        it=sources.get(name)
        if not it or not it["matchesIndex"]:
            problems[name]={"reason":"missing or mismatched WorldCover source"}
            continue
        path=Path(it["cachePath"])
        require(path.is_file() and digest_file(path)==it["sha256"],f"reference cache digest mismatch: {name}")
        try:
            west,south,east,north=row["bounds"]
            require(row["crs"]==it["sourceCrs"]=="EPSG:32652","reference CRS differs from EPSG:32652")
            require(np.allclose(row["bounds"],it["sourceBounds"],rtol=0,atol=1e-7),"native bounds disagree")
            require(np.allclose(it["transform"],[10,0,west,0,-10,north],rtol=0,atol=1e-7)
                    and np.allclose([east-west,north-south],[1280,1280],rtol=0,atol=1e-7),"reference grid transform disagrees")
            require((it["width"],it["height"])==(128,128),"reference grid is not 128×128")
        except ValueError as exc:
            problems[name]={"reason":str(exc)}
            continue
        verified[name]={"nativeBounds":row["bounds"],"referenceObject":it["object"],"referenceSHA256":it["sha256"]}
    identity=sha256(encode({"archive":receipt["sha256"],"algorithm":ALGORITHM,"index":INDEX_SHA,"georef":verified})).hexdigest()
    return receipt,index,verified,problems,identity

def iter_archive(path):
    with gzip.open(path,"rb") as stream, tarfile.open(fileobj=stream,mode="r|") as tar:
        for member in tar:
            match=MEMBER.fullmatch(member.name)
            if member.isfile():
                yield tar,member,(match.groups() if match else None)
        # Consume the gzip trailer and verify CRC even after the TAR EOF marker.
        while stream.read(1 << 20):
            pass

def decode(blob):
    array=np.load(io.BytesIO(blob),allow_pickle=False)
    require(isinstance(array,np.ndarray) and array.shape==(128,64,64) and array.dtype==np.dtype("float32"),
            "V5 data must be one float32 128×64×64 array")
    vectors=array.transpose(1,2,0)
    finite=np.isfinite(vectors).all(axis=2)
    norms=np.linalg.norm(np.where(np.isfinite(vectors),vectors,0),axis=2)
    valid=finite & np.isfinite(norms) & (norms>0)
    require(valid.any(),"malformed or empty vector frame")
    return vectors,valid,norms

def color_model(histories):
    choices=[]
    for row,sample in histories:
        if row["status"]=="valid" and sample.size:
            choices.append(sample)
    require(choices,"no valid shared-PCA vectors")
    selected=np.concatenate(choices).astype(np.float64)
    mean=selected.mean(axis=0)
    centered=selected-mean
    eigenvalues,basis=np.linalg.eigh(centered.T@centered)
    axes=basis[:,-3:][:,::-1]
    axes*=np.sign(axes[np.argmax(np.abs(axes),axis=0),np.arange(3)])
    low,high=np.quantile(centered@axes,[.02,.98],axis=0)
    require(np.all(high>low),"PCA display channels lack a range")
    return {"kind":"shared-pca","labels":["R · PC1","G · PC2","B · PC3"],"algorithm":ALGORITHM,"model":MODEL,
            "sampling":"Rows and columns 4,12,20,28,36,44,52,60 in every usable frame. Invalid vectors excluded.",
            "samples":len(selected),"validFramesSampled":len(choices),"mean":mean.tolist(),"axes":axes.tolist(),
            "stretchPercentiles":[2,98],"low":low.tolist(),"high":high.tolist(),
            "explainedVariance":(eigenvalues[-3:][::-1]/eigenvalues.sum()).tolist()}

def scan(path, verified, identity, output):
    checkpoint=output/"scan.json"
    if checkpoint.is_file():
        cached=load(checkpoint)
        require(cached["inputIdentity"]==identity,"scan belongs to another archive or reference revision")
        if "declaredCatalogue" in cached:
            return cached
    zipped={}
    declared_data=None
    unsupported=[]
    bad=[]
    identical_duplicates=[]
    conflicts=[]
    number=0
    months=set()
    for tar,member,key in iter_archive(path):
        if not key:
            if member.name==META_MEMBER:
                require(declared_data is None and 0<member.size<=1<<20,"missing or duplicate V5 metadata member")
                blob=tar.extractfile(member).read()
                require(len(blob)==member.size,"incomplete V5 archive metadata")
                declared_data=(json.loads(blob),sha256(blob).hexdigest(),member.size)
            else:
                unsupported.append({"name":member.name,"bytes":member.size})
            continue
        patch,month=key
        months.add(month)
        number+=1
        entry={"patch":patch,"month":month,"member":member.name,"sourceBytes":member.size}
        if not 0<member.size<=4<<20:
            entry.update(status="bad",reason="unsupported NPY byte length")
            bad.append(entry)
            continue
        blob=tar.extractfile(member).read()
        require(len(blob)==member.size,"archive has an incomplete NPY payload")
        entry["sourceSHA256"]=sha256(blob).hexdigest()
        if key in zipped:
            prior,_=zipped[key]
            if prior["sourceSHA256"]==entry["sourceSHA256"]:
                identical_duplicates.append(entry)
            else:
                conflicts.append({"patch":patch,"month":month,"sha256":[prior["sourceSHA256"],entry["sourceSHA256"]]})
                prior["status"]="conflict"
            continue
        sample=np.empty((0,128),np.float32)
        if patch not in verified:
            entry.update(status="unlocated",reason="no verified WorldCover georeference for patch")
        else:
            try:
                vectors,valid,norms=decode(blob)
                strata=vectors[np.ix_(SAMPLE_GRID,SAMPLE_GRID)]
                sample=strata[valid[np.ix_(SAMPLE_GRID,SAMPLE_GRID)]]
                entry.update(status="valid",valid=int(valid.sum()),nodata=int(valid.size-valid.sum()),
                             normMin=float(norms[valid].min()),normMax=float(norms[valid].max()))
            except (ValueError,OSError,TypeError,EOFError) as error:
                entry.update(status="bad",reason=str(error))
                bad.append(entry)
        zipped[key]=(entry,sample)
        if number%100==0:
            progress("inventory",members=number,unique=len(zipped))
    require(declared_data is not None,"V5 archive lacks its declared member catalogue")
    declaration,source_sha,source_bytes=declared_data
    declared={}
    for row in declaration:
        key=(row["patch_id"],row["month"])
        require(key not in declared,"duplicate V5 declaration identity")
        declared[key]=row["shape"]
    for key,(entry,_sample) in zipped.items():
        shape=declared.get(key)
        if shape!=[128,64,64] and entry["status"]=="valid":
            entry.update(status="conflict",reason="V5 member has no matching declared shape")
            conflicts.append({"patch":key[0],"month":key[1],"sourceSHA256":entry["sourceSHA256"],"declaredShape":shape})
    declaredCatalogue={"member":META_MEMBER,"byteLength":source_bytes,"sha256":source_sha,"combinations":len(declared),
        "declaredWithoutNpy":[list(key) for key in sorted(set(declared)-set(zipped))],
        "npyWithoutDeclaration":[list(key) for key in sorted(set(zipped)-set(declared))]}
    checked=[zipped[key] for key in sorted(zipped)]
    result={"inputIdentity":identity,"archiveNpyMembers":number,"uniqueCombinations":len(zipped),"months":sorted(months),
            "members":[r for r,_ in checked],"unsupportedFiles":unsupported,
            "bad":bad,"duplicates":identical_duplicates,"conflicts":conflicts,"colors":color_model(checked),
            "declaredCatalogue":declaredCatalogue}
    save(checkpoint,result)
    progress("inventory-complete",members=number,months=result["months"],valid=sum(r["status"]=="valid" for r,_ in checked))
    return result

def projection(index, verified):
    to_wgs84=Transformer.from_crs(32652,4326,always_xy=True)
    to_utm=Transformer.from_crs(4326,32652,always_xy=True)
    setups={}
    for id,rec in verified.items():
        west,south,east,north=rec["nativeBounds"]
        ring=[list(to_wgs84.transform(x,y)) for x,y in [(west,north),(west,south),(east,south),(east,north),(west,north)]]
        lons,lats=zip(*ring)
        bbox=[min(lons),min(lats),max(lons),max(lats)]
        x=np.linspace(bbox[0],bbox[2],DISPLAY_PIXELS,endpoint=False)+(bbox[2]-bbox[0])/(DISPLAY_PIXELS*2)
        y=np.linspace(bbox[3],bbox[1],DISPLAY_PIXELS,endpoint=False)-(bbox[3]-bbox[1])/(DISPLAY_PIXELS*2)
        latlon=np.meshgrid(x,y)
        u,v=to_utm.transform(*latlon)
        col=np.floor((u-west)/20).astype(np.int16)
        row=np.floor((north-v)/20).astype(np.int16)
        inside=(col>=0)&(col<64)&(row>=0)&(row<64)
        require(inside.any(),f"empty EPSG:4326 render footprint for {id}")
        # Keep the PNG's established envelope. The selection footprint follows
        # the projected native rectangle, densifying each side before conversion.
        native_ring=[(west,north),(east,north),(east,south),(west,south),(west,north)]
        footprint=[]
        for (start_x,start_y),(end_x,end_y) in zip(native_ring,native_ring[1:]):
            for fraction in (0,.25,.5,.75):
                footprint.append(list(to_wgs84.transform(start_x+(end_x-start_x)*fraction,
                                                         start_y+(end_y-start_y)*fraction)))
        footprint.append(footprint[0])
        setups[id]={"bounds":bbox,"center":list(to_wgs84.transform((west+east)/2,(south+north)/2)),
                    "ring":ring,"footprint":footprint,"nativeBounds":rec["nativeBounds"],"row":row,"col":col,"inside":inside}
    return setups

def render(array, valid, geo, color):
    values=np.zeros((64,64,3),np.uint8)
    mean,axes,low,high=color
    scores=(array[valid].astype(np.float64)-mean)@axes
    values[valid]=np.rint(np.clip((scores-low)/(high-low),0,1)*255).astype(np.uint8)
    image=np.zeros((DISPLAY_PIXELS,DISPLAY_PIXELS,4),np.uint8)
    mask=geo["inside"]
    row,col=geo["row"][mask],geo["col"][mask]
    image[mask,:3]=values[row,col]
    image[mask,3]=valid[row,col]*255
    image[image[...,3]==0,:3]=0
    return image

def rgba_png(image):
    out=io.BytesIO()
    Image.fromarray(image).save(out,format="PNG",compress_level=6)
    return out.getvalue()

def representative(row, array, valid, geo, png):
    corners=geo["ring"]
    x,y=geo["nativeBounds"][0],geo["nativeBounds"][3]
    ix=np.argwhere((png[...,3]>0)&geo["inside"])
    mid=ix[len(ix)//2]
    i,j=map(int,mid)
    src_r,src_c=int(geo["row"][i,j]),int(geo["col"][i,j])
    vector=array[src_r,src_c]
    return {"patch":row["patch"],"month":row["month"],"sourceSHA256":row["sourceSHA256"],"sourceMember":row["member"],
            "sourceRowCol":[src_r,src_c],"sourceVectorNorm":float(np.linalg.norm(vector)),"sourceFirstComponents":vector[:6].tolist(),
            "sourceOriginalPixelRowsColumns":[[2*src_r,2*src_r+1],[2*src_c,2*src_c+1]],
            "sourceCentreUTM":[x+20*(src_c+.5),y-20*(src_r+.5)],"displayRowCol":[i,j],
            "displayRGBA":png[i,j].tolist(),"footprint":corners,"validSourceCells":int(valid.sum())}

def saved_receipt(output,row,color_id,georef):
    file=output/"receipts"/row["month"]/(row["patch"]+".json")
    if not file.is_file():
        return None
    receipt=load(file)
    image=output/receipt["file"]
    if (receipt.get("colorSHA256")!=color_id or receipt["sourceSHA256"]!=row["sourceSHA256"]
        or receipt["bounds"]!=georef["bounds"] or not image.is_file()
        or image.stat().st_size!=receipt["bytes"] or digest_file(image)!=receipt["sha256"]):
        return None
    return receipt

def build_frames(path,inventory,georefs,output):
    coordinates={ (x["patch"],x["month"]):x for x in inventory["members"] if x["status"]=="valid"}
    color=inventory["colors"]
    color_id=sha256(encode(color)).hexdigest()
    color_array=tuple(np.asarray(color[name]) for name in ("mean","axes","low","high"))
    saved={key:seen for key,row in coordinates.items() if (seen:=saved_receipt(output,row,color_id,georefs[row["patch"]]))}
    if len(saved)==len(coordinates):
        progress("frames-reused",frames=len(saved),new=0)
        return [saved[key] for key in sorted(saved)]
    for tar,member,key in iter_archive(path):
        if key not in coordinates or key in saved:
            continue
        row=coordinates[key]
        payload=tar.extractfile(member).read()
        require(sha256(payload).hexdigest()==row["sourceSHA256"],"TAR member changed since full inventory")
        vectors,valid,_=decode(payload)
        require(row["valid"]==int(valid.sum()),"finite vector status changed since inventory")
        geo=georefs[row["patch"]]
        png=render(vectors,valid,geo,color_array)
        require((png[...,3]>0).any(),"aligned output is transparent for a valid source frame")
        body=rgba_png(png)
        with Image.open(io.BytesIO(body)) as restored:
            require(np.array_equal(np.asarray(restored),png),"PNG serialization changed RGBA")
        relative=Path("frames")/row["month"]/(row["patch"]+".png")
        atomic(output/relative,body)
        result={"patch":row["patch"],"month":row["month"],"sourceSHA256":row["sourceSHA256"],"file":relative.as_posix(),
                "sha256":sha256(body).hexdigest(),"bytes":len(body),"bounds":geo["bounds"],"valid":row["valid"],
                "nodata":row["nodata"],"alphaValid":int((png[...,3]>0).sum()),"colorSHA256":color_id,
                "testPoint":representative(row,vectors,valid,geo,png)}
        save(output/"receipts"/row["month"]/(row["patch"]+".json"),result)
        saved[key]=result
        if len(saved)%100==0:
            progress("render",complete=len(saved),total=len(coordinates))
    require(len(saved)==len(coordinates),"render skipped qualifying combinations")
    return [saved[key] for key in sorted(saved)]

def spatial_layout(index,georefs):
    remaining={(row["ix"],row["iy"]):id for id,row in index.items() if id in georefs}
    require(len(remaining)==len(georefs),"duplicate source patch grid indices")
    components=[]
    windows=list(georefs)
    overlaps=[]
    for i,id in enumerate(windows):
        a=georefs[id]["nativeBounds"]
        for other in windows[i+1:]:
            b=georefs[other]["nativeBounds"]
            d1=min(a[2],b[2])-max(a[0],b[0])
            d2=min(a[3],b[3])-max(a[1],b[1])
            if d1>1e-7 and d2>1e-7:
                overlaps.append({"patches":[id,other],"areaMetresSquared":d1*d2})
    while remaining:
        point=min(remaining)
        queue=[point]
        found=[remaining.pop(point)]
        while queue:
            x,y=queue.pop()
            for p in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
                if p in remaining:
                    found.append(remaining.pop(p))
                    queue.append(p)
        components.append(sorted(found))
    components.sort(key=lambda it:(-len(it),it[0]))
    return {"overlaps":overlaps,"connectedComponents":components,
            "bounds":[min(p["bounds"][0] for p in georefs.values()),min(p["bounds"][1] for p in georefs.values()),
                      max(p["bounds"][2] for p in georefs.values()),max(p["bounds"][3] for p in georefs.values())]}

def finish(output,receipt,index,verified,geom_problems,inventory,georefs,frames):
    matrix=defaultdict(dict)
    for member in inventory["members"]:
        matrix[member["patch"]][member["month"]]=member
    months=sorted({x["month"] for x in frames})
    patches=[]
    ledger=[]
    counts=Counter(x["month"] for x in frames)
    for id in sorted(index):
        recs=matrix.get(id,{})
        available=[month for month in months if recs.get(month,{}).get("status")=="valid"]
        missing=[month for month in inventory["months"] if month not in recs]
        if available:
            geo=georefs[id]
            patches.append({"id":id,"bounds":geo["bounds"],"center":geo["center"],
                            "footprint":geo["footprint"],"months":available})
        ledger.append({"patch":id,"index":index[id],"georeference":verified.get(id),"geometryIssue":geom_problems.get(id),
                       "availableMonths":available,"missingWithinArchiveMonths":missing,"members":recs})
    default_patch="patch_000186" if any(x["id"]=="patch_000186" for x in patches) else patches[0]["id"]
    default_month=next(x["months"][0] for x in patches if x["id"]==default_patch)
    manifest={"version":1,"datasetId":DATASET,"title":"玄女哈尔滨嵌入","period":"、".join(months),
              "description":"按海纳 V5 原件逐月发布可用 patch。使用全部可用帧的分层样本拟合同一 PCA 与颜色范围；颜色表示嵌入特征，缺片或缺月保留空白。",
              "source":"https://cn.zero2x.org/data-hub/portal/dataset?id=1846104","defaultPatch":default_patch,"defaultMonth":default_month,
              "months":months,"patches":patches,"colors":{k:inventory["colors"][k] for k in ("kind","labels")}}
    layout=spatial_layout(index,georefs)
    frame_rows=[{k:v for k,v in row.items() if k!="testPoint"} for row in frames]
    atomic(output/"frames.ndjson",b"".join(encode(row) for row in frame_rows))
    save(output/"coverage.json",manifest)
    save(output/"ledger.json",{"sourceArchive":{k:receipt[k] for k in ("object","size","sha256","etag")},
         "indexSHA256":INDEX_SHA,"indexRecords":len(index),"uniqueNativeFootprints":len({tuple(x["bounds"]) for x in index.values()}),
         "verifiedGeoreferences":len(verified),"availableUniqueFootprints":len(patches),"months":months,
         "monthsWithoutVerifiedV5InCatalogueWindow":[f"{year}-{month:02d}" for year in (2023,2024,2025) for month in range(1,13)
                                                     if (year<2025 or month<=10) and f"{year}-{month:02d}" not in months],
         "framesPerMonth":dict(sorted(counts.items())),"archiveNpyMembers":inventory["archiveNpyMembers"],
         "renderedCombinations":len(frames),"renderedBytes":sum(x["bytes"] for x in frames),
         "georeferenceIssues":geom_problems,"unsupportedFiles":inventory["unsupportedFiles"],"bad":inventory["bad"],
         "duplicateSameContent":inventory["duplicates"],"conflicts":inventory["conflicts"],"patches":ledger,"spatial":layout,
         "declaredCatalogue":inventory["declaredCatalogue"],
         "unlocatedCombinations":[x for x in inventory["members"] if x["status"]=="unlocated"]})
    save(output/"colors.json",inventory["colors"])
    sample_rows=[]
    for month in months:
        candidates=[r for r in frames if r["month"]==month]
        sample_rows.append(candidates[0]["testPoint"])
        sample_rows.append(candidates[-1]["testPoint"])
    save(output/"representative-frames.json",sample_rows)
    final_files=("coverage.json","frames.ndjson","ledger.json","colors.json","representative-frames.json")
    save(output/"complete.json",{"inputIdentity":inventory["inputIdentity"],"frames":len(frames),
                                  "sha256":{name:digest_file(output/name) for name in final_files}})
    progress("finished",georeferences=len(verified),months=months,patches=len(patches),frames=len(frames),
             bytes=sum(x["bytes"] for x in frames),nativeOverlaps=len(layout["overlaps"]),components=len(layout["connectedComponents"]))

def main():
    parser=ArgumentParser(description=__doc__)
    for opt in ("archive","archive-receipt","patch-index","georeferences","output"):
        parser.add_argument("--"+opt,type=Path,required=True)
    args=parser.parse_args()
    os.umask(0o077)
    args.output.mkdir(exist_ok=True,parents=True)
    with (args.output/".generate.lock").open("a") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        receipt,index,verified,issues,identity=verify_inputs(args)
        progress("inputs-verified",archiveSHA256=receipt["sha256"],verifiedGeoreferences=len(verified),index=len(index))
        inventory=scan(args.archive,verified,identity,args.output)
        georefs=projection(index,verified)
        rows=build_frames(args.archive,inventory,georefs,args.output)
        finish(args.output,receipt,index,verified,issues,inventory,georefs,rows)

if __name__=="__main__":
    try:
        main()
    except Exception as error:
        print(f"Xuannv coverage stopped: {type(error).__name__}: {error}",file=sys.stderr)
        sys.exit(1)
