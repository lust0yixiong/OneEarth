"""Verify the Haina WorldCover georeference of each indexed Xuannv patch."""
from argparse import ArgumentParser
from concurrent.futures import ThreadPoolExecutor, as_completed
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import sys
import time

import numpy as np
from rasterio.io import MemoryFile
import requests

DATASET = 1846104
INDEX_SHA = "f833e45f7bcea1a98b1a30bcb8df05829cfc7a811fadea99a5aa7c4443f734be"
VERIFIED_WORLD_COVER = "5b0a516f38248bfd51fe82e8700f45cf0ccf23ba7e6cd62f667c18fd6b5cfa51"

def safe_configuration():
    from haina_datahub import DatasetClient
    from haina_datahub.dataset.domain.dataset import Dataset
    ak = os.environ.get("HAINA_DATAHUB_AK") or os.environ.get("HAINA_ACCESS_KEY_ID")
    sk = os.environ.get("HAINA_DATAHUB_SK") or os.environ.get("HAINA_SECRET_ACCESS_KEY")
    if not ak or not sk:
        raise ValueError("missing authorized Haina SDK credential environment")
    client = DatasetClient(ak,sk)
    dataset = Dataset(DATASET,ak_sk_config=client.ak_sk_config)
    return client,dataset

def patches(address):
    raw=address.read_bytes()
    if sha256(raw).hexdigest()!=INDEX_SHA:
        raise ValueError("unexpected 424-entry index digest")
    data=json.loads(raw)
    geometry_keys={(row["crs"],*row["bounds"]) for row in data}
    result={x["patch_id"]:x for x in data}
    if len(data)!=len(geometry_keys) or len(data)!=len(result):
        raise ValueError("patch index has duplicate identities or native bounds")
    return result

def catalogue(target,dataset):
    path=target/"catalog-worldcover.json"
    if not path.is_file():
        dirs,rows,next_token=dataset.get_dir_list("raw_data/worldcover/",max_items=1200,delimiter="")
        if next_token:
            raise ValueError("incomplete WorldCover reference listing")
        path.write_text(json.dumps({"prefix":"raw_data/worldcover/","dirs":dirs,"files":rows,"pagingTruncated":False},
                                   indent=2,ensure_ascii=False)+"\n")
    stored=json.loads(path.read_text())
    if stored["pagingTruncated"]:
        raise ValueError("incomplete WorldCover reference listing")
    objects={}
    for row in stored["files"]:
        m=re.fullmatch(r"raw_data/worldcover/(patch_\d{6})/static\.tif",row["path"])
        if not m:
            continue
        patch=m.group(1)
        if patch in objects:
            raise ValueError("duplicate WorldCover object for a patch")
        objects[patch]=row
    return objects

def read_reference(client,object_path,expected):
    for attempt in range(3):
        try:
            url=client.get_download_url(DATASET,object_path)
            if not isinstance(url,str) or not url.startswith("https://"):
                raise ValueError("SDK did not return an HTTPS reference")
            with requests.get(url,timeout=(8,18),stream=True) as r:
                if r.status_code!=200:
                    raise requests.HTTPError(response=r)
                body=r.raw.read(expected+1)
                if len(body)!=expected:
                    raise ValueError("WorldCover reference byte length changed")
                return body,r.headers.get("ETag")
        except requests.RequestException as exc:
            if attempt==2:
                status=getattr(getattr(exc,"response",None),"status_code",None)
                raise ValueError(f"WorldCover read failed ({type(exc).__name__}, HTTP {status})") from None
            time.sleep(2**attempt)

def inspect(client,target,index,row,prior_ref):
    name=index["patch_id"]
    expected=int(row["size"])
    if not 0<expected<1<<20:
        raise ValueError("unexpected WorldCover size")
    asset=target/f"{name}.tif"
    previous=asset.with_suffix(".json")
    if previous.exists() and asset.exists():
        receipt=json.loads(previous.read_text())
        body=asset.read_bytes()
        if len(body)!=expected or sha256(body).hexdigest()!=receipt["sha256"]:
            raise ValueError("downloaded reference failed cached digest")
        etag,mode=receipt.get("etag"),"verified-cache"
    elif name=="patch_000186" and prior_ref and prior_ref.is_file():
        body=prior_ref.read_bytes()
        if sha256(body).hexdigest()!=VERIFIED_WORLD_COVER or len(body)!=expected:
            raise ValueError("previously verified reference failed digest")
        asset=prior_ref.resolve()
        etag,mode=None,"prior-verified-cache"
    else:
        body,etag=read_reference(client,row["path"],expected)
        mode="haina-200"
    with MemoryFile(body) as raster, raster.open() as tif:
        meta={"sourceCrs":str(tif.crs),"sourceBounds":list(tif.bounds),
              "width":tif.width,"height":tif.height,"resolution":list(tif.res),
              "transform":list(tif.transform)[:6]}
    matches=(meta["sourceCrs"]==index["crs"] and (meta["width"],meta["height"],meta["resolution"])==(128,128,[10,10])
             and np.allclose(meta["sourceBounds"],index["bounds"],rtol=0,atol=1e-7))
    result={"patchId":name,"object":row["path"],"bytes":len(body),"sha256":sha256(body).hexdigest(),"etag":etag,
            "sourceChanged":row["last_modified"],"cachePath":str(asset),"readFrom":mode,"matchesIndex":bool(matches),**meta}
    if mode=="haina-200":
        asset.write_bytes(body)
        previous.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    return result

def main():
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("--index",type=Path,required=True)
    parser.add_argument("--prior-ref",type=Path)
    parser.add_argument("--input-dir",type=Path,required=True)
    parser.add_argument("--result",type=Path,required=True)
    parser.add_argument("--workers",type=int,default=6)
    args=parser.parse_args()
    os.umask(0o077)
    if not 1<=args.workers<=8:
        raise ValueError("limit concurrent WorldCover requests to eight")
    target=args.input_dir.resolve()
    refs=target/"worldcover"
    refs.mkdir(parents=True,exist_ok=True)
    index=patches(args.index)
    # Fully verified caches require neither SDK credentials nor network access on repeat runs.
    needs_network=not (target/"catalog-worldcover.json").is_file() or any(
        not (refs/f"{id}.json").is_file() and not (id=="patch_000186" and args.prior_ref and args.prior_ref.is_file())
        for id in index
    )
    client,dataset=safe_configuration() if needs_network else (None,None)
    listing=catalogue(target,dataset)
    results=[]
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        tasks={pool.submit(inspect,client,refs,index[name],listing[name],args.prior_ref):name
               for name in sorted(set(index)&set(listing))}
        for future in as_completed(tasks):
            try:
                results.append(future.result())
            except Exception as error:
                results.append({"patchId":tasks[future],"matchesIndex":False,
                                "error":str(error) if type(error) is ValueError and "://" not in str(error) else type(error).__name__})
            if len(results)%25==0:
                print(json.dumps({"processed":len(results),"total":len(tasks),"matching":sum(x["matchesIndex"] for x in results)}),flush=True)
    missing=sorted(set(index)-set(listing))
    extra=sorted(set(listing)-set(index))
    okay=sum(row["matchesIndex"] for row in results)
    proof={"datasetId":DATASET,"indexSha256":INDEX_SHA,"indexCount":len(index),"catalogueObjects":len(listing),
           "matchingGeoreferences":okay,"missing":missing,"extra":extra,"rows":sorted(results,key=lambda r:r["patchId"])}
    temp=args.result.with_suffix(".json.tmp")
    temp.write_text(json.dumps(proof,ensure_ascii=False,indent=2)+"\n")
    temp.replace(args.result)
    print(json.dumps({k:v for k,v in proof.items() if k!="rows"}),flush=True)
    return 0 if okay==len(index) else 1

if __name__=="__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"WorldCover verification stopped ({type(exc).__name__})",file=sys.stderr)
        sys.exit(1)
