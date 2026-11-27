import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {test} from "node:test";
import {gunzipSync,gzipSync} from "node:zlib";
import {createLayerObservationResolver} from "./layer-observations";
import {readLayerObservation} from "../src/domain/layer-observations";

const digest=(data:Uint8Array)=>createHash("sha256").update(data).digest("hex");
const files=(...names:string[])=>{
  const hash=createHash("sha256");
  for(const name of names)hash.update(readFileSync(new URL("../src/data/evidence/"+name,import.meta.url))).update("\0");
  return hash.digest("hex");
};
const deterministicPublication=new URL("../public/visualizations/precip/imerg-v07b-2024/",import.meta.url);
const originalTile=readFileSync(new URL("03/2/10-4.bin.gz",deterministicPublication));
const archiveManifest=JSON.parse(readFileSync(new URL("manifest.json",deterministicPublication),"utf8"));
const archiveSource=archiveManifest.sources[2];
const revision=archiveSource.sha256;
const nbytes=180*180*2;
const row=723,column=1805;
const offset=((row%180)*180+column%180)*2;
const root="/precip-data";
const manifestPath=root+"/2024/manifest.json";
const pathFor=(run:string,rev:string)=>"2024/03-"+run.toLowerCase()+"-"+rev.slice(0,12);
const tilePath=root+"/"+pathFor("Final",revision)+"/2/10-4.bin.gz";
const target={kind:"imerg-cell",datasetId:"nasa:imerg-monthly",revision,month:"2024-03",row,column,tileRevision:digest(originalTile)};

function sourceManifest({
  run="Final",version="V07B",provider,through="2024-03-31",complete=true,
}: {run?:string;version?:string;provider?:string;through?:string;complete?:boolean}={}) {
  return {id:"imerg-2024-2f325d9bc14d",product:"GPM IMERG",source:"https://gpm.nasa.gov/data/imerg",
    year:2024,step:.1,rows:1800,columns:3600,tileSize:180,factors:[10,2,1],missing:65535,unit:"mm/day",scale:.01,
    months:Array.from({length:12},(_,index)=>index===2?{
      month:3,path:pathFor(run,revision),complete,through,
      source:{run,version,provider,sha256:revision,url:run==="Late"?"https://climateserv.servirglobal.net/":archiveSource.url},
    }:null)};
}
type Asset = {data:Buffer;etag?:string;status?:number;location?:string};
const json=(v:unknown)=>Buffer.from(JSON.stringify(v));

async function withSpatial(
  assets:Map<string,Asset>,
  run:(resolver:ReturnType<typeof createLayerObservationResolver>,requests:string[],port:number)=>Promise<void>,
) {
  const requests:string[]=[];
  const server=createServer((req,res)=>{
    const path=req.url??"";
    requests.push(path);
    const asset=assets.get(path);
    if(!asset){res.writeHead(404).end();return;}
    res.writeHead(asset.status??200,{"x-oneearth-service":"spatial","content-type":path.endsWith(".json")?"application/json":"application/octet-stream",
      etag:asset.etag??'"'+digest(asset.data)+'"',...(asset.location?{location:asset.location}:{})});
    res.end(asset.data);
  });
  await new Promise<void>((ok,fail)=>server.once("error",fail).listen(0,"127.0.0.1",ok));
  try {
    const port=(server.address() as AddressInfo).port;
    await run(createLayerObservationResolver({origin:"http://127.0.0.1:"+port}),requests,port);
  } finally {
    await new Promise<void>((ok,fail)=>server.close(error=>error?fail(error):ok()));
  }
}

test("IMERG binds the actual native little-endian cell to its source revision and compressed tile bytes",async()=>{
  const encoded=gunzipSync(originalTile).readUInt16LE(offset);
  assert.notEqual(encoded,65_535);
  await withSpatial(new Map([[manifestPath,{data:json(sourceManifest())}],[tilePath,{data:originalTile}]]),async(resolve,calls)=>{
    const observed=await resolve(target);
    assert.deepEqual(observed,{...target,sourceUrl:archiveSource.url,
      point:[.55,17.65],value:encoded/100,unit:"mm/day",productVersion:"V07B",run:"Final",complete:true,through:"2024-03-31"});
    assert.deepEqual(readLayerObservation(observed),observed);
    assert.deepEqual(calls,[manifestPath,tilePath]);
  });
});

test("IMERG preserves published missing versus observed zero and labels a partial Late product",async()=>{
  const raw=Buffer.alloc(nbytes);
  raw.writeUInt16LE(65_535,offset);
  const tile=gzipSync(raw);
  const latePath=root+"/"+pathFor("Late",revision)+"/2/10-4.bin.gz";
  await withSpatial(new Map([[manifestPath,{data:json(sourceManifest({run:"Late",version:"V07",complete:false,through:"2024-03-20"}))}],
    [latePath,{data:tile}]]),async resolve=>{
    const ref={...target,tileRevision:digest(tile)};
    const missing=await resolve(ref);
    assert.ok(missing?.kind==="imerg-cell");
    assert.equal(missing.value,null);assert.equal(missing.run,"Late");
    assert.equal(missing.sourceUrl,"https://climateserv.servirglobal.net/");
    assert.equal(missing.complete,false);assert.equal(missing.through,"2024-03-20");
    const actualZero=await resolve({...ref,column:column-1});
    assert.equal(actualZero?.kind==="imerg-cell"?actualZero.value:null,0);
  });
});

test("IMERG rejects browser-minted origin/value, stale source or tile revisions, altered bytes and weak ETags",async()=>{
  const assets=new Map<string,Asset>([[manifestPath,{data:json(sourceManifest())}],[tilePath,{data:originalTile}]]);
  await withSpatial(assets,async(resolve,calls)=>{
    for(const invalid of [{...target,value:2},{...target,origin:"https://browser.example"},
      {...target,datasetId:"elsewhere:rain"},{...target,row:1800},{...target,column:-1},{...target,month:"2024-13"}])
      assert.equal(await resolve(invalid),undefined);
    assert.equal(calls.length,0);
    assert.equal(await resolve({...target,revision:"a".repeat(64)}),undefined);
    assert.deepEqual(calls,[manifestPath]);
    assert.equal(await resolve({...target,tileRevision:"b".repeat(64)}),undefined);
    assert.deepEqual(calls,[manifestPath,manifestPath,tilePath]);
    assets.set(tilePath,{data:Buffer.concat([originalTile,Buffer.from([0])]),etag:'"'+digest(originalTile)+'"'});
    assert.equal(await resolve(target),undefined);
    assets.set(tilePath,{data:originalTile,etag:'W/"'+digest(originalTile)+'"'});
    assert.equal(await resolve(target),undefined);
  });
});

test("authority reads stay on configured spatial paths and bound compressed and decompressed volume",async()=>{
  const assets=new Map<string,Asset>();
  await withSpatial(assets,async(resolve,calls,port)=>{
    const external=new URL("http://127.0.0.1:"+port+"/other");
    const rogue=sourceManifest();
    rogue.months[2]!.path=external.href;
    assets.set(manifestPath,{data:json(rogue)});
    assert.equal(await resolve(target),undefined);
    assert.deepEqual(calls,[manifestPath]);

    const forgedSource=sourceManifest();
    forgedSource.months[2]!.source.url=external.href;
    assets.set(manifestPath,{data:json(forgedSource)});
    assert.equal(await resolve(target),undefined);
    assert.deepEqual(calls,[manifestPath,manifestPath]);

    assets.set(manifestPath,{data:json(sourceManifest()),status:302,location:external.href});
    assert.equal(await resolve(target),undefined);
    assert.deepEqual(calls,[manifestPath,manifestPath,manifestPath]);
    assets.set(manifestPath,{data:json(sourceManifest())});
    const oversized=Buffer.alloc(97*1024);
    assets.set(tilePath,{data:oversized});
    assert.equal(await resolve({...target,tileRevision:digest(oversized)}),undefined);
    const oversizedOutput=gzipSync(Buffer.alloc(nbytes+2));
    assets.set(tilePath,{data:oversizedOutput});
    assert.equal(await resolve({...target,tileRevision:digest(oversizedOutput)}),undefined);
    const short=gzipSync(Buffer.alloc(nbytes-2));
    assets.set(tilePath,{data:short});
    assert.equal(await resolve({...target,tileRevision:digest(short)}),undefined);
    const before=calls.length;
    assert.equal(await resolve(target,AbortSignal.abort()),undefined);
    assert.equal(calls.length,before);
    assert.ok(!calls.includes("/other"));
  });
});

test("CTD resolves one archived native row and variable, with no nearest-depth substitution",async()=>{
  const resolve=createLayerObservationResolver({fetchImpl:async()=>{throw Error("Packaged CTD cannot access the network");}});
  const ref={kind:"ctd",datasetId:"pangaea:891386",revision:files("research-polar.mjs","research-tables.json"),
    stationId:"NE-Greenland-1997-1998_Sea01-1",sampledAt:"1997-07-22T17:45",depthM:2,variable:"temperature"};
  assert.deepEqual(await resolve(ref),{...ref,sourceUrl:"https://doi.org/10.1594/PANGAEA.891386",
    point:[-19.3347,79.4114],value:-.0972,unit:"°C"});
  const actualSalinity={...ref,variable:"salinity"};
  assert.deepEqual(await resolve(actualSalinity),{...actualSalinity,sourceUrl:"https://doi.org/10.1594/PANGAEA.891386",
    point:[-19.3347,79.4114],value:2.1393,unit:"无量纲"});
  const missing={...actualSalinity,stationId:"NE-Greenland-1997-1998_Sea02-1",sampledAt:"1997-07-23T12:09",depthM:476.4};
  const originalNull=await resolve(missing);
  assert.ok(originalNull?.kind==="ctd");
  assert.equal(originalNull.value,null);
  assert.deepEqual(readLayerObservation(originalNull),originalNull);
  for(const invalid of [{...ref,depthM:2.02},{...ref,sampledAt:"1997-07-22T17:46"},{...ref,revision:"c".repeat(64)},
    {...ref,stationId:"NE-Greenland-1997-1998_Sea02-1"},{...ref,sourceUrl:"https://user.example"}])
    assert.equal(await resolve(invalid),undefined);
});

test("glacier front resolves one original geometry identity/date and archives no inferred displacement",async()=>{
  const resolve=createLayerObservationResolver({fetchImpl:async()=>{throw Error("Packaged fronts cannot access the network");}});
  const ref={kind:"glacier-front",datasetId:"zenodo:15241675:fronts",revision:files("research-shapes.json"),
    objectId:"front-0",observedOn:"1984-04-11"};
  assert.deepEqual(await resolve(ref),{...ref,sourceUrl:"https://doi.org/10.5281/zenodo.15241675",
    point:[-134.5425814,58.4240927],label:"Mendenhall Glacier · 1984-04-11"});
  assert.equal(await resolve({...ref,objectId:"front-1"}),undefined);
  assert.equal(await resolve({...ref,observedOn:"1984-04-12"}),undefined);
  assert.equal(await resolve({...ref,distance:10}),undefined);
});
