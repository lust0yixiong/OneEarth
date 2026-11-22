import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {openTaskStore} from "./task-store";
import {discoveryConfirmation,previousDiscovery} from "./discovery-bindings";
import {validateTurn} from "./runtime-input";
import {emptyFilters} from "../src/domain/spatial";

function parent(){
  const tasks=openTaskStore(":memory:"),id=randomUUID(),conversationId=randomUUID();
  tasks.submit(id,{query:"original research question",conversationId});tasks.claim();
  return{tasks,id,conversationId};
}
function binding(id:string,state="TASK_STATE_INPUT_REQUIRED",lastSeq:number|undefined=85){
  return{transport:"a2a",kind:"initial",messageId:id,discoveryId:"server-issued-discovery",contextId:"server-issued-context",state,lastSeq};
}

test("confirmation uses the persisted external ID and consumed checkpoint without changing the archived decision",async()=>{
  const {tasks,id,conversationId}=parent();
  try{
    tasks.append(id,{discoveryBinding:binding(id,"TASK_STATE_WORKING",undefined)});
    tasks.append(id,{discoveryBinding:binding(id)});
    const result={questionCheck:{originalQuestion:"original research question",proposedQuestion:"proposed research question"},answerNotes:{references:[{id:"unchanged-reference"}]}};
    tasks.finish(id,"complete",{result});
    const before=JSON.stringify(tasks.terminal(id));
    const found=await discoveryConfirmation(tasks,conversationId,id);
    assert.equal(found.continuedFrom,"server-issued-discovery");
    assert.deepEqual(found.options,{target:{discoveryId:"server-issued-discovery",contextId:"server-issued-context"},afterSeq:85});
    assert.equal(JSON.stringify(tasks.terminal(id)),before);
  }finally{tasks.close();}
});

test("bindings survive event pagination and supplemental task IDs do not replace the initial binding",async()=>{
  const {tasks,id,conversationId}=parent();
  try{
    tasks.append(id,{discoveryBinding:binding(id,"TASK_STATE_WORKING",undefined)});
    for(let i=0;i<140;i++)tasks.append(id,{stage:"persisted progress "+i});
    tasks.append(id,{discoveryBinding:binding(id)});
    tasks.append(id,{discoveryBinding:{...binding(randomUUID()),kind:"continuation",discoveryId:"additional-discovery"}});
    assert.equal((await previousDiscovery(tasks,conversationId,id)).discoveryId,"server-issued-discovery");
    assert.equal((await discoveryConfirmation(tasks,conversationId,id)).options.afterSeq,85);
  }finally{tasks.close();}
});

test("legacy v1 records without bindings resolve by their archived ID only within the same conversation",async()=>{
  const {tasks,id,conversationId}=parent();
  try{
    tasks.finish(id,"complete",{result:{questionCheck:{originalQuestion:"original research question"}}});
    assert.deepEqual(await discoveryConfirmation(tasks,conversationId,id),{continuedFrom:id,options:{}});
    await assert.rejects(previousDiscovery(tasks,"another-conversation",id),/同一研究会话/);
  }finally{tasks.close();}
});

test("a completed A2A task is referenced without being resurrected as a same-task continuation",async()=>{
  const {tasks,id,conversationId}=parent();
  try{
    tasks.append(id,{discoveryBinding:binding(id,"TASK_STATE_COMPLETED")});
    assert.deepEqual(await discoveryConfirmation(tasks,conversationId,id),{continuedFrom:"server-issued-discovery",options:{}});
  }finally{tasks.close();}
});

for(const invalid of ["missing-checkpoint","conflicting-id","malformed-binding"]){
  test(invalid+" fails closed instead of guessing the runtime UUID",async()=>{
    const {tasks,id,conversationId}=parent();
    try{
      if(invalid==="missing-checkpoint")tasks.append(id,{discoveryBinding:{...binding(id),lastSeq:undefined}});
      if(invalid==="conflicting-id"){
        tasks.append(id,{discoveryBinding:binding(id)});
        tasks.append(id,{discoveryBinding:{...binding(id),discoveryId:"other-task"}});
      }
      if(invalid==="malformed-binding")tasks.append(id,{discoveryBinding:{transport:"a2a",discoveryId:"unknown"}});
      await assert.rejects(discoveryConfirmation(tasks,conversationId,id));
    }finally{tasks.close();}
  });
}

test("a plain clarification is not forged into QuestionDecision authorization",async()=>{
  const {tasks,id,conversationId}=parent();
  try{
    tasks.append(id,{discoveryBinding:binding(id)});
    tasks.finish(id,"complete",{result:{message:"Which observation period?",clarification:true}});
    const original="original research question";
    const issue=await validateTurn(tasks,{query:original,conversationId,turnId:randomUUID(),history:[],config:{executor:"codex",model:""},
      context:{filters:emptyFilters(),caseId:null,citation:null,selection:null,gridSystem:"h3",layer:"all",camera:{center:[0,0],zoom:1,reason:"fixture"}},
      questionDecision:{checkMessageId:id,originalQuestion:original,dataQuestion:original,choice:"original"}});
    assert.match(issue||"",/原任务没有可供这次确认的问题/);
  }finally{tasks.close();}
});
