import assert from "node:assert/strict";

export async function archivedDiscovery(origin, runtimeId, runtimeEvents, {after=0,timeout=10000}={}) {
  const binding=runtimeEvents.map(event=>event.discoveryBinding).findLast(item=>item?.kind==="initial");
  if (binding) {
    const res=await fetch(new URL("/tasks/"+encodeURIComponent(binding.discoveryId),origin),{
      headers:{"A2A-Version":"1.0"},signal:AbortSignal.timeout(timeout),
    });
    assert.ok(res.ok,"A2A discovery archive returned "+res.status);
    const task=await res.json();
    assert.equal(task.id,binding.discoveryId);
    assert.equal(task.contextId,binding.contextId);
    const events=(task.artifacts ?? []).flatMap(artifact=>artifact.parts
      .filter(part=>part.data?.kind==="oneearth.discovery.event.v1").map(part=>part.data.event))
      .filter(event=>event.seq>after && event.seq<=(binding.lastSeq ?? Infinity))
      .sort((left,right)=>left.seq-right.seq);
    return {id:task.id,state:task.status.state,lastSeq:binding.lastSeq,events};
  }
  const res=await fetch(new URL("/v1/discoveries/"+encodeURIComponent(runtimeId)+"/events",origin),{
    signal:AbortSignal.timeout(timeout),
  });
  assert.ok(res.ok,"Legacy discovery archive returned "+res.status);
  return {id:runtimeId,events:(await res.text()).split("\n").filter(line=>line.trim()).map(JSON.parse)};
}
