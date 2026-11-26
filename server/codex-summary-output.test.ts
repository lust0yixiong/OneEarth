import assert from "node:assert/strict";
import test from "node:test";
import type {ProviderReasoningSnapshot} from "../src/domain/types";
import {CodexSummaryOutput} from "./codex-summary-output";

const item = (type: string, id: string, text: string) => ({type: "item.completed", item: {type,id,text}});
const lines = (...events: unknown[]) => Buffer.from(events.map(event => JSON.stringify(event)).join("\n"));

test("completed Codex summaries stay separate from the final agent message", () => {
  const snapshots: ProviderReasoningSnapshot[] = [];
  const output = new CodexSummaryOutput({taskId:"run",onSnapshot:snapshot => snapshots.push(snapshot)});
  const chunk = lines({type:"item.updated",item:{type:"reasoning",id:"partial",text:"incomplete"}},
    {type:"item.completed",item:{type:"reasoning",id:"no-summary",content:["raw"],encrypted_content:"opaque"}},
    item("reasoning","summary-1","核对三次乘除"),
    item("reasoning","summary-1","duplicate"),
    item("agent_message","first","working"),
    item("command_execution","command","diagnostics"),
    item("agent_message","final","第三次时不再是整数。"),
    {type:"turn.completed"});
  for (let offset = 0; offset < chunk.length; offset += 2) assert(output.feed(chunk.subarray(offset,offset+2)));
  assert.equal(output.finish(),"第三次时不再是整数。");
  assert.equal(snapshots.length,1);
  assert.match(snapshots[0].id,/^run:/);
  assert.deepEqual({...snapshots[0],id:"run"}, {id:"run",kind:"summary",text:"核对三次乘除",revision:1,complete:true});
});

test("incomplete Codex output cannot complete the answer", () => {
  const output = new CodexSummaryOutput({taskId:"run",onSnapshot: () => assert.fail()});
  assert(output.feed(lines(item("agent_message","final","provisional"),{type:"turn.failed"},{type:"turn.completed"})));
  assert.equal(output.finish(),"");
});
