import assert from "node:assert/strict";
import {setTimeout as delay} from "node:timers/promises";
import {RunAgentInputSchema} from "@ag-ui/core/schemas";

export function isNativeChatSubmission(request) {
  return request.method()==="POST" && new URL(request.url()).pathname==="/api/ag-ui";
}

export function nativeChatSubmission(request) {
  assert(isNativeChatSubmission(request),"Expected the workbench's native run submission");
  const input = RunAgentInputSchema.parse(request.postDataJSON());
  assert.equal(input.protocolVersion,"1.0");
  assert.equal(input.messages.at(-1)?.role,"user");
  assert.equal(input.forwardedProps?.oneearth?.version,1);
  return input;
}

export async function readNativeChatRecord(origin,input,{timeout=300_000}={}) {
  const {runId,threadId,messages} = input;
  const turnId = messages.at(-1).id;
  const signal = AbortSignal.timeout(timeout);
  const location = new URL("/api/tasks/"+encodeURIComponent(runId),origin);
  for(;;){
    const response = await fetch(location,{signal,cache:"no-store",redirect:"error"});
    if(response.status===404){await delay(150,undefined,{signal});continue;}
    assert.equal(response.status,200);
    const state = await response.json();
    assert.equal(state.id,runId);
    assert.equal(state.conversationId,threadId);
    assert.equal(state.turnId,turnId);
    assert(["queued","running","complete","failed","cancelled"].includes(state.status));
    if(state.status==="queued"||state.status==="running"){await delay(150,undefined,{signal});continue;}
    if(state.status!=="complete")return {state};

    const recordResponse = await fetch(location.href+"/record",{signal,cache:"no-store",redirect:"error"});
    assert.equal(recordResponse.status,200);
    const record = await recordResponse.json();
    assert.equal(record.id,runId);
    assert.equal(record.conversationId,threadId);
    assert.equal(record.turnId,turnId);
    assert.equal(record.question,messages.at(-1).content);
    assert.equal(typeof record.result?.message,"string");
    return {state,record};
  }
}
