import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { layerObjects, spatialStore, type Chunk, type Layer } from "../server/spatial-store";
import { openTaskStore, taskIdPattern } from "../server/task-store";
import { paperCache } from "../server/earthnano";
import type { PaperRecord } from "../src/domain/paper-record";

interface TaskSample {
  task: Record<string,SQLInputValue>;
  events: {at:number;payload:string}[];
}
type Sample = {format:1; layers:[Layer,Chunk[]][]; runtime:TaskSample[]; discovery:TaskSample[]; papers:PaperRecord[]};

const [action,bundlePath,...taskIds] = process.argv.slice(2);
if (!["export","restore"].includes(action) || !bundlePath || taskIds.some(id=>!taskIdPattern.test(id)) ||
    (action==="export" && !taskIds.length)) {
  throw Error("用法：transfer-sample.ts export <目录> <任务编号...> 或 restore <目录>。");
}
const state=path.resolve(process.env.ONEEARTH_STATE_DIR || ".local/state");
const bundle=path.resolve(bundlePath);
mkdirSync(state,{recursive:true,mode:0o700});
const exportOrigin=action==="export" && process.env.ONEEARTH_EXPORT_ORIGIN;
const index=exportOrigin ? undefined : await spatialStore();
const objects=layerObjects();
const snapshot=path.join(bundle,"sample.json");
const objectDirectory=path.join(bundle,"objects");
const select = (kind:"runtime"|"discovery") => {
  const db=new DatabaseSync(path.join(state,kind+".sqlite"),{readOnly:true});
  try {
    return taskIds.flatMap(id=>{
      const task=db.prepare("SELECT * FROM tasks WHERE id=? AND status IN ('complete','failed','cancelled')").get(id);
      if(!task)return [];
      const events=db.prepare("SELECT at,payload FROM task_events WHERE id=? ORDER BY seq").all(id);
      return [{task,events}] as TaskSample[];
    });
  } finally {db.close();}
};
async function mergeTaskSamples(kind:"runtime"|"discovery",rows:TaskSample[]) {
  if(!rows.length)return;
  const file=path.join(state,kind+".sqlite");
  openTaskStore(file).close();
  const db=new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
  try {
    const existing=db.prepare("SELECT fingerprint FROM tasks WHERE id=?");
    const add=db.prepare("INSERT INTO tasks(id,body,fingerprint,status,created,updated) VALUES (?,?,?,?,?,?)");
    const event=db.prepare("INSERT INTO task_events(id,at,payload) VALUES (?,?,?)");
    for(const {task,events} of rows){
      if(!taskIdPattern.test(String(task.id)))throw Error("样例任务编号不合法。");
      if(existing.get(task.id))throw Error("恢复目标已有相同任务编号，请使用新数据目录。");
      add.run(task.id,task.body,task.fingerprint,task.status,task.created,task.updated);
      for(const item of events)event.run(task.id,item.at,item.payload);
    }
    db.exec("COMMIT");
  } catch(error) {
    db.exec("ROLLBACK");throw error;
  } finally {db.close();}
}

try {
  if(action==="export"){
    const runtime=select("runtime"), discovery=select("discovery");
    if(runtime.length!==taskIds.length)throw Error("指定任务不存在或尚未结束。");
    const papers=new Map<string,PaperRecord>();
    for(const item of runtime){
      const last=JSON.parse(item.events.at(-1)?.payload || "{}");
      for(const record of last.result?.paperRecords ?? [])papers.set(record.id,record);
    }
    // Include the complete set of forest slices so the restored UI can play its timeline.
    const forest="/visualizations/haina/1846764/";
    const layers:[Layer,Chunk[]][]=[];
    await mkdir(objectDirectory,{recursive:true,mode:0o700});
    if(exportOrigin){
      const origin=new URL(exportOrigin);
      if(origin.port==="5174" || !["127.0.0.1","localhost","[::1]"].includes(origin.hostname))
        throw Error("在线导出只允许独立的本机新入口。");
      const get=async(route:string)=>{
        const res=await fetch(new URL(route,origin),{signal:AbortSignal.timeout(15000)});
        if(!res.ok)throw Error("样例读取失败 "+res.status);
        return res;
      };
      const candidates:Layer[]=await get("/api/spatial/layers").then(res=>res.json());
      const layer=candidates.find(row=>row.id==="1846764");
      if(!layer)throw Error("源环境没有海纳森林图层。");
      const boundsQuery="/api/spatial/layers/1846764/chunks?bbox=117,44,130,55&start=2023-01-01&end=2023-12-31&level=0";
      const results:{chunks:Pick<Chunk,"route"|"hash"|"size">[]}=await get(boundsQuery).then(res=>res.json());
      const manifestRes=await get(forest+"manifest.json");
      const manifestBody=Buffer.from(await manifestRes.arrayBuffer());
      const manifest=JSON.parse(manifestBody.toString());
      function hash(bytes:Buffer){return createHash("sha256").update(bytes).digest("hex");}
      async function save(route:string,media:string,bytes:Buffer,expected:string,date:string|null) {
        if(hash(bytes)!==expected)throw Error("源对象校验失败。");
        await writeFile(path.join(objectDirectory,expected),bytes,{mode:0o600});
        return {route,media,hash:expected,size:bytes.length,layer_id:layer!.id,starts:date,ends:date,
          level:date?0:null,bounds:date?manifest.grid.bounds:null};
      }
      const chunks=[await save(forest+"manifest.json","application/json",manifestBody,manifestRes.headers.get("etag")?.replaceAll('"',"")||"",null)];
      for(const frame of manifest.frames){
        const row=results.chunks.find(chunk=>chunk.route===frame.image);
        if(!row)throw Error("海纳样例缺少匹配的图层索引。");
        const bytes=Buffer.from(await get(row.route).then(res=>res.arrayBuffer()));
        if(bytes.length!==row.size)throw Error("源对象大小校验失败。");
        chunks.push(await save(row.route,"image/webp",bytes,row.hash,frame.date));
      }
      layers.push([layer,chunks]);
    }else{
      for(const layer of (await index!.layers()).filter(layer=>layer.id==="1846764"))
        layers.push([layer,await index!.exportChunks(layer.id)]);
      if(!layers.length || !layers[0][1].length)throw Error("源环境没有海纳森林图层。");
      for(const [,chunks] of layers)for(const chunk of chunks){
        const bytes=await objects.read(chunk.hash);
        if(createHash("sha256").update(bytes).digest("hex")!==chunk.hash)throw Error("源对象校验失败。");
        await writeFile(path.join(objectDirectory,chunk.hash),bytes,{mode:0o600});
      }
    }
    const sample:Sample={format:1,layers,runtime,discovery,papers:[...papers.values()]};
    await writeFile(snapshot,JSON.stringify(sample),{mode:0o600});
    console.log(JSON.stringify({action,runtime:runtime.length,discovery:discovery.length,papers:papers.size,layers:layers.length}));
  }else{
    const sample:Sample=JSON.parse(await readFile(snapshot,"utf8"));
    if(sample.format!==1)throw Error("无法读取此样例版本。");
    for(const [layer,chunks] of sample.layers){
      for(const chunk of chunks){
        if(!/^[a-f0-9]{64}$/.test(chunk.hash))throw Error("无效的对象编号。");
        const bytes=await readFile(path.join(objectDirectory,chunk.hash));
        if(createHash("sha256").update(bytes).digest("hex")!==chunk.hash || bytes.byteLength!==chunk.size)
          throw Error("样例对象校验失败。");
        await objects.put(bytes);
      }
      await index!.writeLayer(layer);
      await index!.writeChunks(chunks);
    }
    const papers=paperCache(path.join(state,"paper-evidence.sqlite"));
    try{for(const record of sample.papers)papers.save(record);}finally{papers.close();}
    await mergeTaskSamples("runtime",sample.runtime);
    await mergeTaskSamples("discovery",sample.discovery);
    console.log(JSON.stringify({action,runtime:sample.runtime.length,discovery:sample.discovery.length,papers:sample.papers.length,layers:sample.layers.length}));
  }
} finally {await index?.close();}
