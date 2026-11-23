import assert from "node:assert/strict";
import test,{type TestContext} from "node:test";
import express from "express";
import {once} from "node:events";
import {createHash,randomUUID} from "node:crypto";
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {workspaceC40Publications} from "./workspace-c40-publication";
import {c40CityManifestPath,validWorkspaceViewContext,type WorkspaceViewContext} from "../src/domain/workspace-view-context";
import {parseTurnPlan,prepareTurn,turnPlanningSchema} from "./turn-planning";
import {executeTurn,type RuntimeServices} from "./runtime-turn";
import {openTaskStore} from "./task-store";
import {emptyFilters} from "../src/domain/spatial";
import {navigationTarget} from "./place-lookup";
import {discoverConversation} from "./conversation-discovery";
import type {DiscoveryContext} from "../src/domain/types";

function manifest(total=60){return {version:1,datasetId:"haina:1846639",cities:Array.from({length:total},(_,i)=>({id:i===49?"sydney-aus":"city-"+i.toString().padStart(3,"0"),
  name:i===49?"Sydney":"City "+i,aliases:i===49?["Sydney Harbour"]:undefined}))};}
const bytes=(value:unknown)=>Buffer.from(JSON.stringify(value));
const digest=(value:unknown)=>createHash("sha256").update(bytes(value)).digest("hex");
const view=(value=manifest(),current=0):WorkspaceViewContext=>({version:1,surface:"earth",activeLayer:{id:"c40",title:"C40 城市",status:"ready",controls:[{
  id:"city",label:"城市",ordered:true,current:{id:value.cities[current].id,label:value.cities[current].name},
  options:value.cities.slice(Math.max(0,current-2),current+3).map(city=>({id:city.id,label:city.name})),
  publication:{kind:"c40-cities",revision:digest(value),total:value.cities.length}}]}});
function planned(question:string,action:unknown){return {action:"workspace",goal:question,evidenceNeed:"none",targets:[],reason:"模型受控输出；验证生产消费、选项校验与落档",clarification:null,
  evidenceGap:null,researchIntent:{purpose:question,task:question,region:null,time:null,months:[]},conversationContext:question,workspaceAction:action};}
const action=(valueId="sydney-aus")=>({kind:"set-control",layerId:"c40",controlId:"city",valueId});

async function provider(t:TestContext){
  const app=express(),state={value:manifest(),status:200,badEtag:false,noEtag:false,oversized:false,afterModel:undefined as string|undefined},requests:Array<{path:string;condition?:string;status:number;bytes:number}>=[];
  app.get(c40CityManifestPath,(req,res)=>{
    if(state.afterModel&&existsSync(state.afterModel))state.value=manifest(95);
    const body=state.oversized?Buffer.alloc(2*1024*1024+1,32):bytes(state.value),etag='"'+(state.badEtag?"0".repeat(64):digest(state.value))+'"';
    const status=state.status!==200?state.status:!state.noEtag&&req.get("if-none-match")===etag?304:200;
    requests.push({path:req.path,condition:req.get("if-none-match"),status,bytes:status===200?body.length:0});
    if(!state.noEtag)res.set("etag",etag);res.set("cache-control","no-cache");res.status(status);
    if(status===200)res.type("json").end(body);else res.end();
  });
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");
  const origin="http://127.0.0.1:"+address.port;
  t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
  return {state,requests,origin,resolve:workspaceC40Publications({origin})};
}

test("published city 50 resolves into a small authoritative window and the same single planner",async t=>{
  const p=await provider(t),snapshot=view(p.state.value),query="切换到 Sydney 看看",r=await p.resolve(snapshot,query,new AbortController().signal);
  assert.ok(validWorkspaceViewContext(r.view));assert.ok(r.proof);assert.deepEqual(r.matches,["sydney-aus"]);
  assert.deepEqual(r.read,{status:200,bytes:bytes(p.state.value).length});
  assert.ok(r.view!.activeLayer!.controls[0].options.length<36);assert.ok(r.proof.ids.includes("sydney-aus"));assert.ok(!snapshot.activeLayer!.controls[0].options.some(option=>option.id==="sydney-aus"));
  let calls=0;const input={question:query,context:{caseId:null,filters:emptyFilters(),selection:null,citation:null,gridSystem:"h3" as const,layer:"all" as const,camera:{center:[0,0] as [number,number],zoom:1,reason:"test"},workspaceView:r.view},history:[],workspacePublication:r.proof};
  const turn=await prepareTurn(input,new AbortController().signal,{run:async prompt=>{calls++;assert.match(prompt,/Sydney/);assert.ok(!prompt.includes('"City 59"'));return JSON.stringify(planned(query,action()));},stage:()=>{},report:()=>{},search:async()=>assert.fail("city selection is not research discovery")});
  assert.equal(calls,1);assert.deepEqual(turn.plan.workspaceAction,{...action(),publicationRevision:digest(p.state.value)});
  assert.ok(await r.revalidate!(new AbortController().signal));assert.deepEqual(p.requests.map(r=>r.status),[200,304]);assert.equal(p.requests[1].bytes,0);
  assert.ok(!Object.hasOwn((turnPlanningSchema({workspaceView:r.view}).properties as any).workspaceAction.anyOf[1].properties,"publicationRevision"));
});

test("current neighbors and named late entries remain bounded as a publication grows from 60 to 95",async t=>{
  const p=await provider(t),old=view(p.state.value),initial=await p.resolve(old,"下一项",new AbortController().signal);
  p.state.value=manifest(95);assert.equal(await initial.revalidate!(new AbortController().signal),false);
  const stale=await p.resolve(old,"切换到Sydney",new AbortController().signal);assert.match(stale.issue!,/已更新/);assert.equal(stale.proof,undefined);
  const fresh=await p.resolve(view(p.state.value,49),"切换到 City 94",new AbortController().signal);
  assert.deepEqual(fresh.matches,["city-094"]);assert.equal(fresh.proof!.ids.length,6);assert.ok(fresh.proof!.ids.includes("city-094"));
  assert.ok(fresh.view!.activeLayer!.controls[0].options.some(option=>option.id==="sydney-aus"));assert.equal(fresh.proof!.revision,digest(p.state.value));
});

test("case, whitespace and declared aliases normalize without fabricating city translations",async t=>{
  const p=await provider(t);
  for(const query of ["切换到 sYdNeY 看看","切换到 SYDNEY   HARBOUR 看看","切换到 sydney-aus"]){
    const r=await p.resolve(view(p.state.value),query,new AbortController().signal);assert.deepEqual(r.matches,["sydney-aus"]);
  }
  assert.deepEqual((await p.resolve(view(p.state.value),"切换到悉尼",new AbortController().signal)).matches,[],"unpublished aliases are not guessed");
  p.state.value.cities[47].name="York";p.state.value.cities[48].name="New York";
  assert.deepEqual((await p.resolve(view(p.state.value),"切换到 New York",new AbortController().signal)).matches,["city-048"]);
  assert.deepEqual((await p.resolve(view(p.state.value),"切换到 Yorkshire",new AbortController().signal)).matches,[]);
});

test("ambiguous aliases, duplicate IDs and a removed current city never produce an action proof",async t=>{
  const p=await provider(t);p.state.value.cities[48].name="Sydney";
  let r=await p.resolve(view(p.state.value),"切换到Sydney",new AbortController().signal);assert.match(r.issue!,/多个/);assert.equal(r.proof,undefined);
  p.state.value=manifest();p.state.value.cities[10].id=p.state.value.cities[0].id;
  r=await p.resolve(view(p.state.value),"切换到Sydney",new AbortController().signal);assert.match(r.issue!,/身份重复/);
  p.state.value=manifest();const invalid=view(p.state.value);invalid.activeLayer!.controls[0].current={id:"absent",label:"absent"};
  r=await p.resolve(invalid,"切换到Sydney",new AbortController().signal);assert.match(r.issue!,/不在发布目录/);
});

test("unavailable, changed hash and oversized responses cannot fall back to an old cached publication",async t=>{
  const p=await provider(t),snapshot=view(p.state.value);
  assert.ok((await p.resolve(snapshot,"Sydney",new AbortController().signal)).proof);
  p.state.status=404;assert.equal((await p.resolve(snapshot,"Sydney",new AbortController().signal)).proof,undefined);
  p.state.status=200;p.state.badEtag=true;assert.match((await p.resolve(snapshot,"Sydney",new AbortController().signal)).issue!,/内容与发布/);
  p.state.badEtag=false;p.state.oversized=true;
  // A new client has no 304 cache and must enforce the actual byte boundary.
  assert.match((await workspaceC40Publications({origin:p.origin})(snapshot,"Sydney",new AbortController().signal)).issue!,/读取上限/);
  p.state.oversized=false;p.state.noEtag=true;assert.ok((await p.resolve(snapshot,"Sydney",new AbortController().signal)).proof,"raw bytes can prove a publication when a strong ETag is absent");
});

test("ordinary Earth, forest and legacy C40 contexts never contact the city endpoint",async t=>{
  const p=await provider(t),signal=new AbortController().signal;
  await p.resolve(undefined,"你好",signal);await p.resolve({version:1,surface:"earth"},"定位到上海",signal);
  const forest=view();forest.activeLayer!.id="forest";delete forest.activeLayer!.controls[0].publication;
  await p.resolve(forest,"我现在看的这期是哪年哪月",signal);
  const legacy=view();delete legacy.activeLayer!.controls[0].publication;await p.resolve(legacy,"切换到Sydney",signal);
  assert.equal(p.requests.length,0);
});

async function runtime(t:TestContext){
  const p=await provider(t),dir=mkdtempSync(path.join(tmpdir(),"oe-c40-runtime-")),log=path.join(dir,"calls.jsonl"),reply=path.join(dir,"reply.json"),marker=path.join(dir,"model-returned");
  const oldPath=process.env.PATH,oldOrigin=process.env.ONEEARTH_SPATIAL_URL,originalFetch=globalThis.fetch;
  writeFileSync(path.join(dir,"codex"),`#!${process.execPath}\nimport fs from 'node:fs';let prompt='';for await(const b of process.stdin)prompt+=b;fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({prompt})+'\\n');fs.writeFileSync(${JSON.stringify(marker)},'done');process.stdout.write(fs.readFileSync(${JSON.stringify(reply)},'utf8'));\n`,{mode:0o700});
  process.env.PATH=dir+path.delimiter+oldPath;process.env.ONEEARTH_SPATIAL_URL=p.origin;
  globalThis.fetch=(url,init)=>{assert.equal(new URL(String(url)).href,p.origin+c40CityManifestPath,"no imagery, geocoder or research source requests");return originalFetch(url,init);};
  const tasks=openTaskStore(":memory:"),services={tasks,push:{latest:()=>({records:[]})},coverage:async()=>assert.fail("no grid handle"),researchRegionService:{locate:async()=>assert.fail("not a research region")},adminBoundaryDir:dir,canonicalCache:new Map()} as unknown as RuntimeServices;
  t.after(()=>{globalThis.fetch=originalFetch;tasks.close();if(oldPath===undefined)delete process.env.PATH;else process.env.PATH=oldPath;if(oldOrigin===undefined)delete process.env.ONEEARTH_SPATIAL_URL;else process.env.ONEEARTH_SPATIAL_URL=oldOrigin;rmSync(dir,{recursive:true,force:true});});
  return {...p,marker,tasks,async run(query:string,output:unknown,contextOverrides:Partial<DiscoveryContext>={}){
    writeFileSync(reply,JSON.stringify(output));const id=randomUUID(),body={query,conversationId:randomUUID(),turnId:randomUUID(),history:[],config:{executor:"codex" as const,model:""},
      // A forged internal-looking browser field must never become a proof.
      workspacePublication:{revision:"0".repeat(64),ids:["invented-city"]},
      context:{caseId:null,filters:{...emptyFilters(),place:"独立研究附件范围"},selection:null,citation:null,gridSystem:"h3" as const,layer:"all" as const,camera:{center:[0,0] as [number,number],zoom:1,reason:"test"},
        attachedScope:[{kind:"time" as const,period:[2010,2011] as [number,number],utcWindow:null}],workspaceView:view(p.state.value),...contextOverrides}};
    tasks.submit(id,body);tasks.claim();const result=await executeTurn(services,id,body,new AbortController().signal,event=>tasks.append(id,event));tasks.finish(id,result.error?"failed":"complete",result);
    return {outcome:result,result:result.result as any,prompts:readFileSync(log,"utf8").trim().split("\n").map(line=>JSON.parse(line).prompt as string),record:tasks.terminal(id)};
  }};
}

test("production runtime accepts a late city in one model decision, preserves scope and archives its stable versioned action",async t=>{
  const f=await runtime(t),query="切换到 Sydney 看看",r=await f.run(query,planned(query,action()));
  assert.equal(r.outcome.error,undefined);assert.equal(r.prompts.length,1);assert.match(r.prompts[0],/独立研究附件范围/);assert.match(r.prompts[0],/2010,2011/);
  assert.ok(!r.prompts[0].includes('"City 59"'));assert.deepEqual(r.result.workspaceAction,{...action(),publicationRevision:digest(f.state.value)});
  assert.equal(r.result.camera,undefined);assert.deepEqual((r.record as any).result.workspaceAction,r.result.workspaceAction);
  const trace=JSON.parse(r.result.runTrace.calls.find((call:any)=>call.id==="turn-action").output);
  assert.deepEqual(trace.modelPlanning,{attempts:1,workspaceAction:action()});assert.equal(trace.workspaceAction.publicationRevision,digest(f.state.value));
  assert.deepEqual(f.requests.map(request=>request.status),[200,304]);
});

test("a publication changed while the model runs refuses the old action and retains the answer record",async t=>{
  const f=await runtime(t);f.state.afterModel=f.marker;const query="切换到 Sydney 看看",r=await f.run(query,planned(query,action()));
  assert.equal(r.outcome.error,undefined);assert.equal(r.result.workspaceAction,undefined);assert.equal(r.result.clarification,true);assert.match(r.result.message,/目录已变化/);
  assert.deepEqual(f.requests.map(request=>request.status),[200,200]);assert.ok(r.record);
});

test("an unknown C40 city with a neutral action does not become a normal geographic flight",async t=>{
  const f=await runtime(t),query="切换到 Atlantis 看看",r=await f.run(query,planned(query,null));
  assert.equal(r.outcome.error,undefined);assert.equal(r.result.workspaceAction,undefined);assert.equal(r.result.camera,undefined);assert.equal(r.result.clarification,true);assert.match(r.result.message,/未切换城市/);
  assert.equal(r.prompts.length,1);assert.equal(f.requests.length,1);
});

test("C40 retains explicit camera navigation and local zoom without changing city control",async t=>{
  const f=await runtime(t);
  for(const query of ["定位到 120.2E, 30.3N","把地图定位到 120.2E, 30.3N，保持图层"]){
    const r=await f.run(query,planned(query,null));assert.equal(r.outcome.error,undefined);
    assert.deepEqual(r.result.camera.center,[120.2,30.3]);assert.equal(r.result.workspaceAction,undefined);assert.equal(r.result.visualization,undefined);
  }
  const query="放大一点",zoomed=await f.run(query,planned(query,null));assert.equal(zoomed.outcome.error,undefined);
  assert.ok(zoomed.result.camera.zoom>1);assert.equal(zoomed.result.workspaceAction,undefined);
  assert.equal(navigationTarget("把地图定位到杭州，保持图层",true)?.place,"杭州");
  assert.equal(navigationTarget("定位到杭州",true)?.verb,"定位");
  assert.equal(navigationTarget("切换到 Atlantis 看看",true)?.verb,"切换到");
});

test("an unresolved C40 menu cannot reuse a previous research case's geographic filters",async t=>{
  const f=await runtime(t);
  for(const verb of ["切换到","切到"]){
    const query=verb+"阿尔卑斯看看",ctx={caseId:"Q02",filters:emptyFilters(),selection:null,citation:null,gridSystem:"h3" as const,layer:"all" as const,camera:{center:[0,0] as [number,number],zoom:1,reason:"test"}};
    assert.ok(discoverConversation(query,ctx).filters,"original fallback would have altered the research filter");
    const r=await f.run(query,planned(query,null),{caseId:"Q02"});
    if(verb==="切到"){
      assert.match(String(r.outcome.error),/没能确定/);assert.equal(r.result,undefined);continue;
    }
    assert.equal(r.outcome.error,undefined);
    assert.equal(r.result.camera,undefined);assert.equal(r.result.filters,undefined);assert.equal(r.result.clearSelection,undefined);assert.match(r.result.message,/未切换城市/);
  }
});

test("C40 without publication prevents unresolved menu fallback but keeps legacy typed choices and explicit camera moves",async t=>{
  const f=await runtime(t),legacy=view(f.state.value);delete legacy.activeLayer!.controls[0].publication;
  const query="切换到阿尔卑斯看看",r=await f.run(query,planned(query,null),{caseId:"Q02",workspaceView:legacy});
  assert.equal(r.outcome.error,undefined);assert.equal(r.result.camera,undefined);assert.equal(r.result.filters,undefined);assert.match(r.result.message,/未切换城市/);
  const known="切换到 City 2",selected=await f.run(known,planned(known,action("city-002")),{workspaceView:legacy});
  assert.deepEqual(selected.result.workspaceAction,action("city-002"));
  const move="把地图定位到 120.2E, 30.3N，保持图层",moved=await f.run(move,planned(move,null),{workspaceView:legacy});
  assert.deepEqual(moved.result.camera.center,[120.2,30.3]);assert.equal(moved.result.workspaceAction,undefined);
  const loading={...legacy,activeLayer:{...legacy.activeLayer!,status:"loading" as const,controls:[]}};
  const unavailable=await f.run(query,planned(query,null),{workspaceView:loading});assert.equal(unavailable.result.camera,undefined);assert.match(unavailable.result.message,/未切换城市/);
  assert.equal(f.requests.length,0,"no publication means no server city-directory authority query");
});

test("guessed late IDs and model-supplied revisions cannot bypass server publication proof",async t=>{
  const p=await provider(t),resolved=await p.resolve(view(p.state.value),"切换到 Sydney",new AbortController().signal);
  const input={question:"切换到 Sydney",context:{caseId:null,filters:emptyFilters(),selection:null,citation:null,gridSystem:"h3" as const,layer:"all" as const,camera:{center:[0,0] as [number,number],zoom:1,reason:"test"},workspaceView:resolved.view},history:[],workspacePublication:resolved.proof};
  assert.throws(()=>parseTurnPlan(JSON.stringify(planned(input.question,action("city-059"))),input),/不能猜测/);
  assert.throws(()=>parseTurnPlan(JSON.stringify(planned(input.question,{...action(),publicationRevision:digest(p.state.value)})),input),/不能猜测/);
  assert.throws(()=>parseTurnPlan(JSON.stringify(planned(input.question,action())),{...input,workspacePublication:undefined}),/不能猜测/);
});
