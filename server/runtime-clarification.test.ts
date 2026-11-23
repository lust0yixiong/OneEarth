import assert from "node:assert/strict";
import test,{type TestContext} from "node:test";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import express from "express";
import {openTaskStore} from "./task-store";
import {executeTurn,type RuntimeServices} from "./runtime-turn";
import {validateTurn} from "./runtime-input";
import {clarificationOptions,createClarificationPrompt} from "../src/domain/clarification";
import {clarificationParent} from "./clarification-guard";
import {discoveryConfirmation,previousDiscovery} from "./discovery-bindings";
import {emptyFilters} from "../src/domain/spatial";
import type {DiscoveryContext} from "../src/domain/types";
import type {PaperRecord} from "../src/domain/paper-record";

const originalQuery="查找原定研究对象的观测资料。",normalizedGoal="原委托的模型归一研究目的";
const dataResult=(clarification:string)=>({plan:{questionMode:"preserve",dataQuestion:originalQuery,paper:{name:"",facets:[],region:[]},web:[],hainaQueries:[],dataNeed:null},
  clarification,papers:[],haina:[],searches:[],sourceStatus:[],issues:[]});
const context=():DiscoveryContext=>({filters:{...emptyFilters(),place:"original-authorized-place"},caseId:null,citation:null,selection:null,
  gridSystem:"h3",layer:"all",camera:{center:[0,0],zoom:1,reason:"fixture"}});
const acquiredPaper:PaperRecord={id:"earthnano:"+"c".repeat(64),dsKey:"doi:10.9999/controlled",papers:1,paperTitle:"Controlled acquired material",studyContext:"",points:[],
  need:{name:"已得材料",product:"Controlled data",type:"论文抽取线索",detail:"Controlled test material",status:"有论文用法记录",source:"文献资料",datasetId:"doi:10.9999/controlled",
    profile:{role:"data",spatial:"nonspatial",coverage:"未提供坐标",access:"Controlled source",limitation:""},
    tabs:[{kind:"table",label:"论文用法（本页）",rows:[["Controlled paper","input","temperature","","controlled-paper","controlled-dataset"]]}]}};
const acquiredSearch={engine:"controlled search",query:"confirmed target data",status:"done" as const,
  hits:[{url:"https://example.org/controlled-acquired-source",title:"Controlled acquired source",snippet:"Actual fixture result",pageExcerpt:"Retained source text",stage:"page-excerpt" as const}]};

async function fixture(t:TestContext,action:"supplement"|"new_goal"|"clarify"="supplement",givenContext=context(),newGoalSupplement=false,childWait=false,structured=false){
  const directory=mkdtempSync(path.join(tmpdir(),"oneearth-clarification-runtime-")),promptFile=path.join(directory,"prompts.txt"),guardFile=path.join(directory,"guard.json");
  const guard={action,reason:"controlled runtime model decision",proposedQuestion:action==="new_goal"?"查找一个已明确确认的新研究目标。":null,
    clarification:action==="clarify"?"还需说明哪个原定条件？":null};
  const planner={action:"search",goal:guard.proposedQuestion||normalizedGoal,evidenceNeed:"discover",targets:[],reason:"明确研究发现",clarification:null,
    researchIntent:{purpose:guard.proposedQuestion||normalizedGoal,task:guard.proposedQuestion||normalizedGoal,region:null,time:null,months:[]},
    conversationContext:guard.proposedQuestion||normalizedGoal,evidenceGap:"需要实际来源依据"};
  const fake=path.join(directory,"codex");
  const evidence={action:"discover",reason:"需要新目标下的具体证据",gap:"新目标缺少的具体字段",targets:[],clarification:null};
  writeFileSync(guardFile,JSON.stringify(guard));
  writeFileSync(fake,`#!/usr/bin/env node\nimport fs from 'node:fs';\nlet input='';for await(const chunk of process.stdin)input+=chunk;fs.appendFileSync(${JSON.stringify(promptFile)},input+'\\n');process.stdout.write(JSON.stringify(input.includes('先决定本轮要做什么')?${JSON.stringify(planner)}:input.includes('你负责决定同一轮研究任务的下一步')?${JSON.stringify(evidence)}:JSON.parse(fs.readFileSync(${JSON.stringify(guardFile)},'utf8'))));\n`,{mode:0o700});
  const previousPath=process.env.PATH,previousUrl=process.env.ONEEARTH_DISCOVERY_URL,previousProtocol=process.env.ONEEARTH_DISCOVERY_PROTOCOL;
  process.env.PATH=directory+path.delimiter+previousPath;delete process.env.ONEEARTH_DISCOVERY_PROTOCOL;
  const tasks=openTaskStore(":memory:"),parentId=randomUUID(),conversationId=randomUUID();
  const original={query:originalQuery,conversationId,turnId:randomUUID(),context:givenContext,history:[],config:{executor:"codex" as const,model:""},deepseekTools:{search:false,fetch:false}};
  tasks.submit(parentId,original);tasks.claim();
  const externalId="actual-"+randomUUID(),contextId="context-"+randomUUID();let sequence=20;
  const artifact=(seq:number,value:unknown)=>({artifactId:"event-"+seq,parts:[{data:{kind:"oneearth.discovery.event.v1",event:{seq,result:value}}}]});
  type Remote={id:string;contextId:string;status:{state:string};artifacts:any[];jobs:number};
  const remotes=new Map<string,Remote>();
  const remote:Remote={id:externalId,contextId,status:{state:"TASK_STATE_INPUT_REQUIRED"},artifacts:[artifact(sequence,dataResult("请补充原委托缺失的条件。"))],jobs:1};remotes.set(externalId,remote);
  const childMessageId=randomUUID(),focus="子委托待核实的具体字段";
  if(childWait){
    const initial={id:"completed-initial-"+randomUUID(),contextId:"completed-context",status:{state:"TASK_STATE_COMPLETED"},artifacts:[],jobs:1};
    remotes.set(initial.id,initial);
    tasks.append(parentId,{discoveryBinding:{transport:"a2a",kind:"initial",messageId:parentId,discoveryId:initial.id,contextId:initial.contextId,state:initial.status.state,lastSeq:19}});
  }
  tasks.append(parentId,{discoveryBinding:{transport:"a2a",kind:childWait?"continuation":"initial",messageId:childWait?childMessageId:parentId,discoveryId:externalId,contextId,state:"TASK_STATE_INPUT_REQUIRED",lastSeq:20}});
  tasks.finish(parentId,"complete",{result:{message:"请补充原委托缺失的条件。",clarification:true,discoveryClarification:true,
    ...(structured?{clarificationPrompt:createClarificationPrompt("research","请补充原委托缺失的条件。",[{id:"coast",label:"只看沿海站点"},{id:"inland",label:"只看内陆站点"}])}:{}),
    ...(childWait?{paperRecords:[acquiredPaper]}:{}),
    runTrace:{started:1,stages:[],searches:childWait?[acquiredSearch]:[],calls:[{id:"turn-action",status:"done",output:JSON.stringify({goal:normalizedGoal})},
      ...(childWait?[{id:childMessageId+":discovery",status:"done",input:JSON.stringify({focus})}]:[])]}}});
  const app=express(),posts:any[]=[],requests:string[]=[],accepted=new Map<string,{input:string;id:string}>();
  let completeReplies=false;
  app.use(express.json({type:"application/a2a+json"}));
  const reply=(res:express.Response,body:unknown,status=200)=>res.status(status).type("application/a2a+json").send(JSON.stringify(body));
  const snapshot=(r:Remote)=>({id:r.id,contextId:r.contextId,status:r.status,artifacts:r.artifacts});
  app.get("/tasks/:id",(req,res)=>{requests.push(req.path);const r=remotes.get(String(req.params.id));reply(res,r?snapshot(r):{error:{code:404,message:"missing"}},r?200:404);});
  app.post("/message:send",(req,res)=>{
    posts.push(req.body);const message=req.body.message,business=message.parts[0].data.input,serialized=JSON.stringify(req.body),old=accepted.get(message.messageId);
    if(old){reply(res,old.input===serialized?{task:snapshot(remotes.get(old.id)!)}:{error:{code:409,message:"conflict"}},old.input===serialized?200:409);return;}
    let target:Remote;
    if(message.taskId){
      target=remotes.get(message.taskId)!;
      if(!target||target.status.state!=="TASK_STATE_INPUT_REQUIRED"||business.clarificationReply.afterSeq!==sequence){reply(res,{error:{code:409,message:"stale wait"}},409);return;}
      target.jobs++;
    }else{target={id:"new-"+randomUUID(),contextId:"new-context",status:{state:"TASK_STATE_WORKING"},artifacts:[],jobs:1};remotes.set(target.id,target);}
    if((newGoalSupplement&&!message.taskId&&!business.continuation)||(message.taskId&&completeReplies)){
      const material:any=dataResult("");delete material.clarification;
      material.papers=[acquiredPaper];material.searches=[acquiredSearch];
      target.artifacts.push(artifact(++sequence,material));target.status={state:"TASK_STATE_COMPLETED"};
    }else{
      target.artifacts.push(artifact(++sequence,dataResult("请再补充另一个原定条件。")));target.status={state:"TASK_STATE_INPUT_REQUIRED"};
    }
    accepted.set(message.messageId,{input:serialized,id:target.id});reply(res,{task:snapshot(target)});
  });
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");
  process.env.ONEEARTH_DISCOVERY_URL="http://127.0.0.1:"+address.port;
  const services={tasks,push:{latest(){return{records:[]};}},
    coverage:async({cell}:any)=>({cellId:cell.id,gridKey:cell.grid.key,status:"unknown",reason:"expired"}),researchRegionService:{locate:async()=>null},adminBoundaryDir:directory,canonicalCache:new Map()} as unknown as RuntimeServices;
  t.after(async()=>{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));tasks.close();rmSync(directory,{recursive:true,force:true});
    if(previousPath===undefined)delete process.env.PATH;else process.env.PATH=previousPath;
    if(previousUrl===undefined)delete process.env.ONEEARTH_DISCOVERY_URL;else process.env.ONEEARTH_DISCOVERY_URL=previousUrl;
    if(previousProtocol===undefined)delete process.env.ONEEARTH_DISCOVERY_PROTOCOL;else process.env.ONEEARTH_DISCOVERY_PROTOCOL=previousProtocol;});
  const body=(text="2020年至2023年。")=>({...original,query:text,turnId:randomUUID(),clarificationReply:{parentTaskId:parentId}});
  const run=async(value:any)=>{
    const id=randomUUID(),issue=await validateTurn(tasks,value);assert.equal(issue,undefined,issue);
    tasks.submit(id,value);assert.equal(tasks.claim()?.id,id);
    const outcome=await executeTurn(services,id,value,new AbortController().signal,event=>{tasks.append(id,event);});
    tasks.finish(id,outcome.error?"failed":"complete",outcome);return{id,outcome};
  };
  return{tasks,parentId,conversationId,body,run,remote,remotes,posts,requests,services,promptFile,
    completeReplies(){completeReplies=true;},
    supplement(){writeFileSync(guardFile,JSON.stringify({action:"supplement",reason:"supplements original conditions",proposedQuestion:null,clarification:null}));},
    stale(){remote.artifacts.push(artifact(++sequence,dataResult("新的等待条件")));},
    prompts(){return existsSync(promptFile)?readFileSync(promptFile,"utf8"):"";}};
}

test("explicit clarification restores the archived goal/authority and sends only text plus server checkpoint",async t=>{
  const s=await fixture(t),value=s.body();
  value.context={...value.context,filters:{...value.context.filters,place:"untrusted-current-browser-mirror"}};
  value.deepseekTools={search:true,fetch:true};
  const {id,outcome}=await s.run(value);assert.equal(outcome.error,undefined);
  assert.equal((outcome.result as any).discoveryClarification,true);
  assert.equal(s.posts.length,1);
  const message=s.posts[0].message,business=message.parts[0].data.input;
  assert.deepEqual(business,{continuedFrom:s.remote.id,clarificationReply:{text:value.query,afterSeq:20}});
  assert.equal(message.taskId,s.remote.id);assert.equal(message.messageId,id);
  assert.ok(s.prompts().includes(normalizedGoal));assert.ok(!s.prompts().includes("untrusted-current-browser-mirror"));
  const bound=await previousDiscovery(s.tasks,s.conversationId,id);
  assert.equal(bound.transport,"a2a");assert.equal((bound as any).lastSeq,21);
  assert.ok(s.tasks.events(id,0).filter(e=>e.discoveryBinding).every(e=>!("request" in (e.discoveryBinding as any))));
  assert.equal((s.tasks.terminal(s.parentId)?.result as any).message,"请补充原委托缺失的条件。");
  t.diagnostic(JSON.stringify({runtime:id,parent:s.parentId,discovery:s.remote.id,oldCheckpoint:20,newCheckpoint:21,minimalBusiness:business,modelGuard:true}));
});

test("structured research choices resolve from the same archived parent and resume its exact wait",async t=>{
  const s=await fixture(t,"supplement",context(),false,false,true),body:any=s.body("只看沿海站点");
  body.clarificationAnswer={parentTaskId:s.parentId,optionId:"coast"};
  assert.equal(await validateTurn(s.tasks,body),undefined);
  for(const invalid of [{...body,query:"把选项改成另一个目标"},{...body,clarificationReply:undefined},
    {...body,clarificationAnswer:{...body.clarificationAnswer,parentTaskId:randomUUID()}},
    {...body,clarificationAnswer:{...body.clarificationAnswer,optionId:"unknown"}}])assert.ok(await validateTurn(s.tasks,invalid));
  const {outcome}=await s.run(body);assert.equal(outcome.error,undefined);assert.equal(s.posts.length,1);
  assert.equal(s.posts[0].message.taskId,s.remote.id);
  assert.deepEqual(s.posts[0].message.parts[0].data.input,{continuedFrom:s.remote.id,clarificationReply:{text:body.query,afterSeq:20}});
  assert.equal(s.remote.jobs,2);
});

test("an old waiting card cannot wake a newer clarification with a fresh message identity",async t=>{
  const s=await fixture(t);s.stale();const {outcome}=await s.run(s.body());
  assert.match(String(outcome.error),/等待水位/);assert.equal(s.posts.length,0);assert.equal(s.prompts(),"");
});

test("a persisted local follow-up validates its own options and inherits the original provider wait",async t=>{
  const s=await fixture(t),followupId=randomUUID();
  const question="请补充原委托的年份。";
  const prompt=createClarificationPrompt("research",question,clarificationOptions(["2023 年","2024 年"]))!;
  s.tasks.submit(followupId,s.body("不确定。"));s.tasks.claim();
  s.tasks.finish(followupId,"complete",{clarificationContinuation:true,
    result:{message:question,clarification:true,discoveryClarification:true,clarificationPrompt:prompt}});
  const next={...s.body("2023 年"),clarificationReply:{parentTaskId:followupId},
    clarificationAnswer:{parentTaskId:followupId,optionId:"option-1"}};
  const waiting=await clarificationParent(s.tasks,next);
  assert.equal(waiting.binding.discoveryId,s.remote.id);
  assert.equal(waiting.binding.lastSeq,20);
  assert.equal(waiting.result.message,question);
  assert.equal(waiting.original.query,originalQuery);
  await assert.rejects(clarificationParent(s.tasks,{...next,query:"2024 年"}),/选项或内容/);
  await assert.rejects(clarificationParent(s.tasks,{...next,conversationId:randomUUID()}),/不属于/);
  const resumed=await s.run(next);assert.equal(resumed.outcome.error,undefined);assert.equal(s.posts.length,1);
  const message=s.posts[0].message;
  assert.equal(message.taskId,s.remote.id);
  assert.deepEqual(message.parts[0].data.input,{continuedFrom:s.remote.id,clarificationReply:{text:"2023 年",afterSeq:20}});
});

test("after a child clarification completes, a new gap preserves the unconfirmed accepted query and goal",async t=>{
  const s=await fixture(t,"supplement",context(),false,true);s.completeReplies();
  const before=JSON.stringify(s.tasks.terminal(s.parentId));
  const {id,outcome}=await s.run(s.body());assert.equal(outcome.error,undefined);assert.equal(s.posts.length,2);
  assert.equal(s.posts[0].message.taskId,s.remote.id);assert.equal(s.remote.status.state,"TASK_STATE_COMPLETED");
  const next=s.posts[1].message.parts[0].data.input;
  assert.equal(next.query,originalQuery);assert.equal(next.researchGoal,normalizedGoal);
  assert.equal(next.decision,undefined);assert.equal(next.continuedFrom,undefined);
  assert.equal(next.continuation.previousId,s.remote.id);
  assert.ok(s.prompts().includes('"researchGoal":"'+normalizedGoal+'","evidenceGap":"子委托待核实的具体字段"'));
  assert.deepEqual((outcome.result as any).paperRecords,[acquiredPaper]);
  assert.deepEqual((outcome.result as any).runTrace.searches,[acquiredSearch]);
  assert.equal(JSON.stringify(s.tasks.terminal(s.parentId)),before);
  const pending=await previousDiscovery(s.tasks,s.conversationId,id,true);
  assert.notEqual(pending.discoveryId,s.remote.id);assert.equal(s.remotes.get(pending.discoveryId)?.status.state,"TASK_STATE_INPUT_REQUIRED");
  assert.equal("lastSeq" in pending?pending.lastSeq:undefined,22);
});

test("changing the goal asks through existing QuestionCheck and confirmed new work uses a new discovery Task",async t=>{
  const s=await fixture(t,"new_goal"),first=s.body("改为一个新的研究目的。");
  const proposed=await s.run(first),reply=proposed.outcome.result as any;
  assert.equal(reply.runtimeQuestionCheck,true);assert.equal(s.posts.length,0);assert.equal(s.remote.jobs,1);
  assert.equal(s.remote.status.state,"TASK_STATE_INPUT_REQUIRED");
  assert.deepEqual(await discoveryConfirmation(s.tasks,s.conversationId,proposed.id),{newTask:true,options:{}});
  const next={...first,query:reply.questionCheck.originalQuestion,turnId:randomUUID(),clarificationReply:undefined,
    questionDecision:{checkMessageId:proposed.id,originalQuestion:reply.questionCheck.originalQuestion,dataQuestion:reply.questionCheck.proposedQuestion,choice:"proposed"}};
  const completed=await s.run(next);assert.equal(completed.outcome.error,undefined);
  assert.equal(s.posts.length,1);
  const message=s.posts[0].message,business=message.parts[0].data.input;
  assert.equal(message.taskId,undefined);assert.equal(business.query,next.questionDecision.dataQuestion);assert.equal(business.researchGoal,next.questionDecision.dataQuestion);
  assert.equal(business.decision,undefined);assert.equal(business.continuedFrom,undefined);
  assert.equal(s.remotes.size,2);assert.equal(s.remote.jobs,1);assert.equal(s.remote.status.state,"TASK_STATE_INPUT_REQUIRED");
});

test("an insufficient explicit reply stays local and does not masquerade as a new provider wait",async t=>{
  const s=await fixture(t,"clarify"),{id,outcome}=await s.run(s.body("嗯。"));
  assert.equal((outcome.result as any).clarification,true);assert.equal((outcome.result as any).discoveryClarification,true);assert.equal(s.posts.length,0);
  assert.equal(outcome.clarificationContinuation,true);
  assert.deepEqual((outcome.result as any).clarificationPrompt,{kind:"research",question:"还需说明哪个原定条件？"});
  assert.equal(s.tasks.events(id,0).filter(event=>event.discoveryBinding).length,0);
  assert.equal(s.tasks.terminal(id)?.clarificationContinuation,true);
  s.supplement();
  const next:any={...s.body("2020年至2023年。"),clarificationReply:{parentTaskId:id},clarificationAnswer:{parentTaskId:id,text:"2020年至2023年。"}};
  const resumed=await s.run(next);assert.equal(resumed.outcome.error,undefined);assert.equal(s.posts.length,1);
  assert.equal(s.posts[0].message.taskId,s.remote.id);
  assert.deepEqual(s.posts[0].message.parts[0].data.input,{continuedFrom:s.remote.id,clarificationReply:{text:next.query,afterSeq:20}});
});

test("confirmed new-goal supplemental discovery retains the new input and binds its own waiting task",async t=>{
  const s=await fixture(t,"new_goal",context(),true),first=s.body("改为一个新的研究目的。");
  const proposed=await s.run(first),check=(proposed.outcome.result as any).questionCheck;
  const next={...first,query:check.originalQuestion,turnId:randomUUID(),clarificationReply:undefined,
    questionDecision:{checkMessageId:proposed.id,originalQuestion:check.originalQuestion,dataQuestion:check.proposedQuestion,choice:"proposed"}};
  const completed=await s.run(next);assert.equal(completed.outcome.error,undefined);assert.equal(s.posts.length,2);
  const firstRemote=(await previousDiscovery(s.tasks,s.conversationId,completed.id)).discoveryId;
  const waiting=(await previousDiscovery(s.tasks,s.conversationId,completed.id,true)).discoveryId;
  assert.notEqual(firstRemote,waiting);
  for(const send of s.posts){const business=send.message.parts[0].data.input;
    assert.equal(business.query,check.proposedQuestion);assert.equal(business.researchGoal,check.proposedQuestion);
    assert.equal(business.decision,undefined);assert.equal(business.continuedFrom,undefined);}
  assert.equal(s.posts[1].message.parts[0].data.input.continuation.previousId,firstRemote);
  assert.equal((completed.outcome.result as any).discoveryClarification,true);
  assert.equal(s.remotes.get(firstRemote)?.status.state,"TASK_STATE_COMPLETED");
  assert.equal(s.remotes.get(waiting)?.status.state,"TASK_STATE_INPUT_REQUIRED");
  const saved=s.tasks.terminal(completed.id)?.result as any;
  assert.deepEqual(saved.paperRecords,[acquiredPaper]);assert.deepEqual(saved.runTrace.searches,[acquiredSearch]);
  assert.deepEqual(s.tasks.events(completed.id,0).flatMap(e=>(e.researchMaterials as {papers?:PaperRecord[]}|undefined)?.papers||[]),[acquiredPaper]);
  const before=JSON.stringify(s.tasks.terminal(completed.id));s.supplement();s.completeReplies();
  const followup={...next,query:"补充原定区域内的观测站条件。",questionDecision:undefined,clarificationReply:{parentTaskId:completed.id},turnId:randomUUID()};
  const resumed=await s.run(followup);assert.equal(resumed.outcome.error,undefined);
  assert.equal(s.posts.length,4);assert.equal(s.posts[2].message.taskId,waiting);
  assert.deepEqual(s.posts[2].message.parts[0].data.input,{continuedFrom:waiting,clarificationReply:{text:followup.query,afterSeq:22}});
  assert.equal(s.remotes.get(firstRemote)?.status.state,"TASK_STATE_COMPLETED");assert.equal(s.remotes.get(firstRemote)?.jobs,1);
  assert.equal(s.remotes.get(waiting)?.status.state,"TASK_STATE_COMPLETED");
  const subsequent=s.posts[3].message.parts[0].data.input;
  assert.equal(subsequent.query,check.proposedQuestion);assert.equal(subsequent.researchGoal,check.proposedQuestion);
  assert.equal(subsequent.decision,undefined);assert.equal(subsequent.continuedFrom,undefined);
  assert.equal(subsequent.continuation.previousId,waiting);
  assert.equal(s.remotes.get(waiting)?.jobs,2);assert.equal(JSON.stringify(s.tasks.terminal(completed.id)),before);
  const stale=await s.run({...followup,turnId:randomUUID()});
  assert.match(String(stale.outcome.error),/等待水位|已不在等待/);assert.equal(s.posts.length,4);
  assert.equal(s.remote.status.state,"TASK_STATE_INPUT_REQUIRED");assert.equal(s.remote.jobs,1);
});

for(const invalid of ["legacy","foreign-conversation","forged-flag","client-checkpoint","edited-bypass"]){
  test(invalid+" cannot authorize clarification continuation",async t=>{
    const s=await fixture(t),value:any=s.body();
    if(invalid==="legacy"){
      const other=randomUUID();s.tasks.submit(other,{...value,clarificationReply:undefined});s.tasks.claim();
      s.tasks.finish(other,"complete",{result:{clarification:true,discoveryClarification:true,message:"legacy record has no accepted binding"}});
      value.clarificationReply={parentTaskId:other};
    }
    if(invalid==="foreign-conversation")value.conversationId=randomUUID();
    if(invalid==="forged-flag"){
      const other=randomUUID();s.tasks.submit(other,{...value,clarificationReply:undefined});s.tasks.claim();
      s.tasks.finish(other,"complete",{result:{clarification:true,message:"runtime-only clarification"}});value.clarificationReply={parentTaskId:other};
    }
    if(invalid==="client-checkpoint")value.clarificationReply.afterSeq=999;
    if(invalid==="edited-bypass")value.questionDecision={checkMessageId:s.parentId,originalQuestion:value.query,dataQuestion:"bypass",choice:"edited"};
    assert.ok(await validateTurn(s.tasks,value));assert.equal(s.posts.length,0);assert.equal(s.prompts(),"");
  });
}

test("an expired authoritative map handle stops continuation before a model or discovery call",async t=>{
  const scope=context();
  const selected={id:"871f8aa03ffffff",point:[10.722481503598425,46.806771799567294] as [number,number],
    grid:{system:"h3" as const,n:7,label:"H3 R7",key:"h7"}};
  scope.attachedScope=[{kind:"grid",place:"original grid",selection:selected,coverageScope:{id:randomUUID(),revision:"a".repeat(64)}}];
  scope.selection=selected;
  const s=await fixture(t,"supplement",scope),{outcome}=await s.run(s.body());
  assert.match((outcome.result as any).message,/覆盖范围已失效/);assert.equal(s.posts.length,0);assert.equal(s.prompts(),"");
});
