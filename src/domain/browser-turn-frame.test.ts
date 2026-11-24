import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {browserTurnRelations,resultBatchCandidates} from "./browser-turn-frame";
import {assets} from "./datasets";
import type {State} from "./store";
import type {CandidateSet,Message} from "./types";
import type {ResultBatch} from "./turn-context";

test("visible data cards are a subset of the original execution batch", () => {
  const [first, second, unrelated] = assets.slice(0,3).map(asset=>asset.id);
  const page = "web:https://example.invalid/report";
  const batch: ResultBatch = {batchId:randomUUID(),taskId:randomUUID(),turnId:randomUUID(),conversationId:randomUUID(),
    kind:"research",status:"complete",query:"Find recent data",channels:[],itemIds:[first,second,page]};
  assert.deepEqual(resultBatchCandidates(batch,[unrelated,second,page]),[second]);
  assert.deepEqual(resultBatchCandidates(batch),[first,second]);
  assert.deepEqual(resultBatchCandidates({...batch,itemIds:[page]}),[]);
  assert.deepEqual(batch.itemIds,[first,second,page]);
});


test("a failed new lookup and the older visible batch keep separate task references",()=>{
  const sessionId=randomUUID(),oldTurn=randomUUID(),oldTask=randomUUID(),newTurn=randomUUID(),newTask=randomUUID();
  const batch={resultBatch:{batchId:randomUUID(),taskId:oldTask,turnId:oldTurn,conversationId:sessionId}} as CandidateSet;
  const messages:Message[]=[
    {id:oldTurn,role:"user",text:"first lookup",time:1},
    {id:oldTask,role:"assistant",text:"old candidates",time:2,replyTo:oldTurn,chatMessage:true},
    {id:newTurn,role:"user",text:"second lookup",time:3},
    {id:newTask,role:"assistant",text:"request failed",time:4,replyTo:newTurn,chatMessage:true,failed:true},
  ];
  const state={sessionId,messages} as State;
  const related=browserTurnRelations(state,batch,oldTask,[]);
  assert.deepEqual(related,[
    {taskId:oldTask,turnId:oldTurn,relation:"reply"},
    {taskId:newTask,turnId:newTurn,relation:"recent-outcome"},
    {taskId:oldTask,turnId:oldTurn,relation:"visible-batch"},
  ]);
});
