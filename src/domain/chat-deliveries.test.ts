import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import express from "express";
import {chatDeliveries} from "../../server/chat-deliveries";
import {readChatResponse} from "./chat-response";
import type {RunTrace} from "./types";

test("a disconnected chat continues once and replays its progress and final answer", async () => {
  const deliveries = chatDeliveries(":memory:");
  const app = express();
  const id = randomUUID();
  let starts = 0;
  let publish: ReturnType<typeof deliveries.attach>;
  const trace:RunTrace={started:123,stages:["检索中"],calls:[{id:"paper",kind:"tool",name:"断言库",status:"done",input:"水位"}]};
  app.post("/", express.json(), (req, res) => {
    const send = deliveries.attach(id, req.body, res,()=>({stage:"检索中",runTrace:trace}));
    if (send) {
      starts++;
      publish = send;
      send({stage:"检索中"});
    }
  });
  const server = app.listen(0,"127.0.0.1");
  try {
    await new Promise(resolve => server.once("listening",resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const post = (query: string, signal?: AbortSignal) => fetch("http://127.0.0.1:"+address.port, {
      method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({query}), signal,
    });
    const controller = new AbortController();
    const first = await post("城陵矶水位",controller.signal);
    assert.ok((await first.body!.getReader().read()).value);
    controller.abort();
    // The latest incremental event alone cannot restore the earlier calls.
    const call={id:"haina",kind:"tool" as const,name:"海纳",status:"done" as const,input:"水位"};
    trace.calls.push(call);
    publish!({call,traceStarted:123});
    const second = await post("城陵矶水位");
    const stages: string[] = [];
    let restored:RunTrace|undefined;
    const answer = readChatResponse(second, (text,_searches,snapshot) => {stages.push(text);restored=snapshot;});
    publish!({result:{message:"已找到水位记录"}},true);
    assert.equal((await answer).message,"已找到水位记录");
    assert.deepEqual(stages,["检索中"]);
    assert.deepEqual(restored?.calls.map(c=>c.id),["paper","haina"]);
    const replay = await readChatResponse(await post("城陵矶水位"),()=>{});
    assert.equal(replay.message,"已找到水位记录");
    assert.equal((await post("另一问题")).status,409);
    assert.equal(starts,1);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
