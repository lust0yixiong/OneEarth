import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { archivedDiscovery } from "./discovery-evidence.mjs";

const [report, firstId, followId] = process.argv.slice(2);
const base=new URL(process.env.ONEEARTH_URL || "http://127.0.0.1:5274");
if(base.port==="5174")throw Error("只能验收新版入口。");
const data=JSON.parse(await readFile(report,"utf8"));
async function events(origin,route,id) {
  const res=await fetch(new URL(route+"/"+id+"/events",origin),{signal:AbortSignal.timeout(10000)});
  assert.ok(res.ok);
  return (await res.text()).split("\n").filter(line=>line.trim()).map(JSON.parse);
}
const first=await events(base,"/api/tasks",firstId);
const next=await events(base,"/api/tasks",followId);
const {id:providerTaskId,events:independent}=await archivedDiscovery(
  process.env.ONEEARTH_DISCOVERY_URL || "http://127.0.0.1:5275",firstId,first);
const source = rows => rows.at(-1).result.answerNotes.references.filter(r=>r.sourceChannel==="assertion").map(r=>r.id);
const selected=next.find(event=>event.call?.id==="citation-ordinal");
const target=JSON.parse(selected.call.output).sourceId;
assert.equal(target,source(first)[1]);
assert.deepEqual(source(next),[target]);
assert.ok(independent.some(event=>event.finding?.items.length));
assert.equal(independent.filter(event=>event.started).length,1);
assert.equal(first.filter(event=>event.started).length,1);
assert.ok(next.every(event=>event.call?.name!=="独立数据发现服务"));
assert.equal(data.refresh.taskId,firstId);
assert.equal(data.refresh.statusBefore,"running");
assert.equal(data.refresh.uniqueTaskIds,1);
function summary(rows) {
  const request=rows[0], start=rows.find(e=>e.started), finding=rows.find(e=>e.finding?.items.length);
  const output=rows.at(-1);
  return {id:request.taskId,queuedAt:request.at,workerStartedAt:start.at,firstFindingAt:finding?.at,finishedAt:output.at,
    referenceCount:output.result.answerNotes.references.length,paperIds:source(rows),
    providerCalls:rows.filter(e=>e.call && e.call.status!=="running").map(e=>({name:e.call.name,status:e.call.status,id:e.call.id})),
    executorTimings:output.result.runTrace?.timings?.map(t=>({executor:t.executor,model:t.model,elapsedMs:t.elapsedMs,firstStdoutMs:t.firstStdoutMs}))};
}
data.turns=[summary(first),summary(next)];
data.independentDiscovery={id:providerTaskId,readOnce:true,channels:independent.at(-1).result.sourceStatus.map(c=>({source:c.source,status:c.status,count:c.count}))};
data.followUp={previousTaskId:firstId,taskId:followId,pinnedId:target,newDiscoveryTasks:0};
await writeFile(report,JSON.stringify(data,null,2)+"\n");
console.log(JSON.stringify({firstId,followId,replayedTaskId:data.refresh.taskId,matchedPaper:target,newDiscoveryTasks:0}));
