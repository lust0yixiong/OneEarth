import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {test} from "node:test";
import {flightCatalogueFollowUp} from "../src/domain/flight-catalogue";
import type {WorkspaceReceipt} from "../src/domain/turn-context";
import {scopedQuestionContext} from "../src/domain/question-scope";
import {cellAt,gridSpec} from "../src/domain/spatial";
import {validateTurnStructure} from "./runtime-input";
import {openTaskStore} from "./task-store";

test("flight catalogue admission requires the original completed same-thread ground receipt",async t=>{
  const store=openTaskStore(":memory:");t.after(()=>store.close());
  const parentId=randomUUID(),conversationId=randomUUID(),parentTurnId=randomUUID();
  const point:[number,number]=[99.869,38.362],grid=gridSpec("h3",6),id=cellAt(point,grid);
  store.submit(parentId,{conversationId,turnId:parentTurnId});
  store.claim();
  store.finish(parentId,"complete",{result:{message:"将飞到祁连山。",flightCatalogue:true}});
  const receipt:WorkspaceReceipt={taskId:parentId,effectId:"workspace:"+parentId,turnId:parentTurnId,
    conversationId,state:"applied",reportedAt:Date.now(),
    flight:{state:"arrived",observedAt:Date.now(),ground:{id,level:grid.n,point}}};
  let observed:WorkspaceReceipt|undefined=receipt;
  const authority={...store,workspaceReceipt:async(id:string)=>id===parentId?observed:undefined};
  const context={...scopedQuestionContext([{kind:"grid",place:"祁连山",selection:{id,grid,point},
    coverageScope:{id:randomUUID(),revision:"a".repeat(64)}}],null),flightParentRunId:parentId};
  const body={query:flightCatalogueFollowUp,previousTaskId:parentId,conversationId,turnId:randomUUID(),
    config:{executor:"codex",model:""},context,history:[]};
  assert.equal(await validateTurnStructure(authority,body),undefined);
  assert.match((await validateTurnStructure(authority,{...body,conversationId:randomUUID()}))!,/无法核对/);
  observed={...receipt,flight:{state:"superseded",observedAt:Date.now()},state:"stale"};
  assert.match((await validateTurnStructure(authority,body))!,/无法核对/);
  observed=undefined;
  assert.match((await validateTurnStructure(authority,body))!,/无法核对/);
});
