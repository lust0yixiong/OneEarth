import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {once} from "node:events";
import {spawn,type ChildProcess} from "node:child_process";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
import test from "node:test";
import express from "express";
import {Pool} from "pg";
import {EventSchema} from "@ag-ui/core/schemas";
import {cellAt,emptyFilters,gridSpec} from "../src/domain/spatial";
import {readWorkspaceDiscoveryAccepted,readWorkspaceDiscoveryView,workspaceDiscoveryAccessHeader} from "../src/domain/workspace-discovery";
import {createRuntimeApi} from "./runtime-api-service";
import {discoveryDelegationLookupPath,discoveryRequestFingerprint} from "./discovery-request-fingerprint";

const fixture=process.env.ONEEARTH_WORKSPACE_DISCOVERY_TEST_DATABASE_URL;
test("independent workspace and native Chat discovery share admission, durable execution and archived sources",
  {skip:!fixture,timeout:75_000},async t=>{
    assert.ok(fixture&&new URL(fixture).host==="127.0.0.1:56578");
    assert.match(new URL(fixture).pathname,/test/u);
    const scratch=await mkdtemp(join(tmpdir(),"oe-shared-discovery-"));
    const pg=new Pool({connectionString:fixture});
    const token=randomBytes(24).toString("hex");
    const savedEnv=new Map<string,string|undefined>();
    const set=(key:string,value:string)=>{savedEnv.set(key,process.env[key]);process.env[key]=value;};
    set("ONEEARTH_RUNTIME_DATABASE_URL",fixture);
    set("ONEEARTH_DISCOVERY_RECOVERY_TOKEN",token);
    t.after(async()=>{
      for(const [key,value] of savedEnv)if(value===undefined)delete process.env[key];else process.env[key]=value;
      await pg.end();
      await rm(scratch,{force:true,recursive:true});
    });
    const upstream=express();upstream.use(express.json({type:["application/a2a+json","application/json"]}));
    const query="独立验收冰川前缘和高程资料",cancelQuery="独立验收取消原高程委托";
    const exactTitle="冰川前缘合成资料",exactUrl="https://example.org/glacier-proof";
    const grid=gridSpec("h3",2),point:[number,number]=[99.8,38],selection={point,grid,id:cellAt(point,grid)};
    const coverageScope={id:randomUUID(),revision:"a".repeat(64),summary:{selection,filters:emptyFilters(),caseId:null,
      layer:"all",metric:"products",candidateCount:null,candidateIdentity:null}};
    let publication=coverageScope.revision;
    const posts:{messageId:string;input:Record<string,unknown>;id:string}[]=[],lookups:string[]=[],cancels:string[]=[];
    const remote=new Map<string,{id:string;contextId:string;input:Record<string,unknown>;state:string}>();
    let letFirstReturn:()=>void=()=>{},firstReceived:(id:string)=>void=()=>{};
    const firstAccepted=new Promise<string>(r=>firstReceived=r),firstHeld=new Promise<void>(r=>letFirstReturn=r);
    const material=(asked:string,wait=false)=>({
      plan:{dataQuestion:asked,questionMode:"preserve",dataNeed:null,paper:{region:[],facets:[]},web:[],
        researchIntent:{purpose:asked,task:asked,region:null,time:null,months:[]},conversationContext:asked,
        hainaQueries:[],paperQueries:[],webQueries:[]},
      papers:[],haina:[{id:"haina:1481000",kind:"dataset",title:exactTitle,source:"隔离资料目录",url:exactUrl}],
      searches:[],sourceStatus:[{source:"海纳资料",status:"done",count:1}],issues:[],
      ...(wait?{clarification:"请补充原观测季节。"}:{})
    });
    const task=(row:NonNullable<ReturnType<typeof remote.get>>)=>({
      id:row.id,contextId:row.contextId,status:{state:row.state},
      artifacts:row.state==="TASK_STATE_COMPLETED"||row.state==="TASK_STATE_INPUT_REQUIRED"
        ?[{artifactId:"native-result",parts:[{data:{kind:"oneearth.discovery.event.v1",
          event:{seq:1,result:material(String(row.input.query),row.state==="TASK_STATE_INPUT_REQUIRED")}}}]}]:[],
    });
    upstream.post("/message:send",async(req,res)=>{
      const {message}=req.body,{messageId}=message,{kind,input}=message.parts[0].data;
      if(kind==="oneearth.paper.query.v1"||kind==="oneearth.haina.catalog.query.v1"){
        const data=kind==="oneearth.paper.query.v1"?{kind:"oneearth.paper.result.v1",operation:input.operation,
          value:{records:[],total:0,nextCursor:null,cached:true,catalog:{complete:true,revision:"isolated",source:"fixture",sourceTotal:0,filteredOut:0,updatedAt:null}}}
          :{kind:"oneearth.haina.catalog.result.v1",value:{records:[],total:0,nextCursor:null,complete:true,refreshing:false,
            areaId:"isolated",synced:"2026-11-28T00:00:00Z",endpoint:"https://example.org/isolated-haina"}};
        res.type("application/a2a+json").json({message:{messageId:randomUUID(),contextId:randomUUID(),role:"ROLE_AGENT",parts:[{data}]}});
        return;
      }
      assert.equal(kind,"oneearth.discovery.request.v1");
      const existing=remote.get(messageId);
      const row=existing??{id:randomUUID(),contextId:randomUUID(),input,state:input.query===cancelQuery
        ?"TASK_STATE_WORKING":input.query==="缺少观测季节的资料发现"?"TASK_STATE_INPUT_REQUIRED":"TASK_STATE_COMPLETED"};
      remote.set(messageId,row);
      posts.push({messageId,input,id:row.id});
      if(posts.length===1){firstReceived(messageId);await firstHeld;}
      if(!res.destroyed)res.json({task:task(row)});
    });
    upstream.get(discoveryDelegationLookupPath+"/:messageId",(req,res)=>{
      const messageId=String(req.params.messageId);
      const row=remote.get(messageId);
      assert.equal(req.get("Authorization"),"Bearer "+token);
      lookups.push(messageId);
      if(!row){res.status(404).json({code:"DELEGATION_NOT_FOUND",idempotentReplay:true});return;}
      assert.equal(req.get("X-OneEarth-Request-Fingerprint"),discoveryRequestFingerprint("oneearth.discovery.request.v1",row.input));
      res.json({taskId:row.id,idempotentReplay:true});
    });
    upstream.get("/tasks/:id",(req,res)=>{
      const row=[...remote.values()].find(x=>x.id===req.params.id);
      if(!row){res.sendStatus(404);return;}
      res.json(task(row));
    });
    upstream.post(/^\/tasks\/([a-f\d-]+):cancel$/u,(req,res)=>{
      const row=[...remote.values()].find(x=>x.id===req.params[0]);
      assert.ok(row);cancels.push(row.id);row.state="TASK_STATE_CANCELED";res.json(task(row));
    });
    upstream.post("/api/coverage/cells",(req,res)=>{
      if(req.body.id!==coverageScope.id||req.body.revision!==publication){res.sendStatus(410);return;}
      assert.deepEqual(req.body.cells,[selection.id]);
      res.json({revision:publication,ready:req.body.cells,scope:coverageScope.summary,cells:[[selection.id,0]],members:[[selection.id,[]]]});
    });
    upstream.post("/api/coverage/scopes",(_req,res)=>{res.sendStatus(409);});
    const provider=upstream.listen(0,"127.0.0.1");await once(provider,"listening");
    const providerAddress=provider.address();assert.ok(providerAddress&&typeof providerAddress!=="string");
    set("ONEEARTH_DISCOVERY_URL","http://127.0.0.1:"+providerAddress.port);
    set("ONEEARTH_SPATIAL_URL","http://127.0.0.1:"+providerAddress.port);
    t.after(async()=>{letFirstReturn();provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>r()));});
    const built=await createRuntimeApi(join(scratch,"api"));
    const app=express();app.use(built.business);
    const browserProof=process.env.ONEEARTH_WORKSPACE_DISCOVERY_BROWSER_TEST==="1";
    if(browserProof)app.use(express.static(join(process.cwd(),"dist")));
    const http=app.listen(0,"127.0.0.1");await once(http,"listening");
    const addr=http.address();assert.ok(addr&&typeof addr!=="string");
    const base="http://127.0.0.1:"+addr.port;
    t.after(async()=>{http.closeAllConnections();await new Promise<void>(r=>http.close(()=>r()));await built.close();});
    const workers:ChildProcess[]=[];
    let errors="";
    function startWorker(){
      const child=spawn(process.execPath,["--import","tsx","server/runtime-worker.ts"],{env:{...process.env,
        ONEEARTH_STATE_DIR:join(scratch,"worker")},stdio:["ignore","ignore","pipe"]});
      child.stderr!.on("data",chunk=>{errors=(errors+chunk).slice(-5000);});workers.push(child);
      return child;
    }
    t.after(async()=>{for(const child of workers)if(child.exitCode===null&&child.signalCode===null){
      const exit=once(child,"exit");child.kill("SIGTERM");await exit;
    }});
    async function until<T>(fn:()=>Promise<T|undefined>,label:string,ms=30_000):Promise<T>{
      const end=Date.now()+ms;
      while(Date.now()<end){const value=await fn();if(value!==undefined)return value;await sleep(80);}
      throw Error(label+"; "+errors);
    }

    const thread=randomUUID(),otherThread=randomUUID(),watch=randomBytes(32).toString("hex"),chatKey=randomBytes(32).toString("hex");
    const actions=(c=thread)=>"/api/workspaces/"+c+"/actions";
    const opPath=(id:string,c=thread)=>"/api/workspaces/"+c+"/operations/"+id;
    const execute=(path:string,method="GET",body?:unknown,key?:string)=>fetch(base+path,{method,
      headers:{...(body?{"Content-Type":"application/json"}:{}),...(key?{[workspaceDiscoveryAccessHeader]:key}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45_000)});
    const advance=(expectedRevision:number)=>execute(actions(),"POST",{kind:"clear-research-range",actionId:randomUUID(),expectedRevision});
    const adoption={kind:"adopt-research-range",actionId:randomUUID(),expectedRevision:0,
      range:{scope:{kind:"grid",place:"隔离网格",selection,coverageScope}}};
    const adopted=await execute(actions(),"POST",adoption);assert.equal(adopted.status,200);
    const frozenScope=(await adopted.json()).range.scope;
    const action={kind:"discover-materials",actionId:randomUUID(),expectedRevision:1,query};
    const received=await Promise.all(Array.from({length:6},()=>execute(actions(),"POST",action,watch)));
    assert.ok(received.every(x=>x.status===202));
    const admissions=await Promise.all(received.map(r=>r.json()));
    const direct=readWorkspaceDiscoveryAccepted(admissions[0]);assert.ok(direct);
    assert.ok(admissions.every(a=>JSON.stringify(a)===JSON.stringify(direct)));
    assert.deepEqual(await (await execute(actions()+"/"+action.actionId,"GET",undefined,watch)).json(),direct);
    assert.equal((await execute(actions(),"POST",{...action,query:query+"另问"},watch)).status,409);
    assert.equal((await execute(actions(),"POST",action,chatKey)).status,404);
    assert.equal((await execute(actions(),"POST",{kind:"clear-research-range",actionId:action.actionId,expectedRevision:1})).status,409);
    assert.equal((await execute(opPath(direct.operationId),"GET")).status,404);
    assert.equal((await execute(opPath(direct.operationId,otherThread),"GET",undefined,watch)).status,404);
    assert.equal((await execute(opPath(direct.operationId,otherThread),"DELETE",undefined,watch)).status,404);
    assert.equal((await execute("/api/tasks/"+direct.operationId)).status,404);

    const context={filters:emptyFilters(),caseId:null,selection:null,citation:null,gridSystem:"h3",layer:"all",camera:{center:[0,0],zoom:1,reason:"controlled"}};
    const config={executor:"codex",model:"gpt-6-luna"};
    const postChat=(asked:string,submission:Record<string,unknown>,conversationId=thread,runId=randomUUID())=>({
      runId,response:fetch(base+"/api/ag-ui",{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},
        signal:AbortSignal.timeout(45_000),body:JSON.stringify({protocolVersion:"1.0",runId,threadId:conversationId,
          messages:[{id:randomUUID(),role:"user",content:asked}],tools:[],context:[],state:{},
          forwardedProps:{oneearth:{version:1,submission:{context,config,...submission}}}})})
    });
    const frames=(text:string)=>text.split("\n\n").filter(x=>x.startsWith("data: "))
      .map(x=>EventSchema.parse(JSON.parse(x.slice(6)))) as any[];
    assert.equal((await postChat("发现资料：",{}).response).status,400);
    const chatActionId=randomUUID(),native=postChat("发现资料："+query,{discoveryAction:{actionId:chatActionId,expectedRevision:1,accessKey:chatKey}});
    const stream=await native.response;
    assert.equal(stream.status,200);
    const linked=readWorkspaceDiscoveryAccepted(await (await execute(actions()+"/"+chatActionId,"GET",undefined,chatKey)).json());
    assert.ok(linked);
    assert.notEqual(linked.operationId,direct.operationId);
    assert.deepEqual(await (await execute(actions(),"POST",{...action,actionId:chatActionId},chatKey)).json(),linked);
    const initial=await pg.query("SELECT operation_id,body,admission_checkpoint FROM runtime_operations WHERE operation_id=ANY($1::uuid[])",
      [[direct.operationId,linked.operationId]]);
    assert.equal(initial.rowCount,2);
    const frozen=initial.rows.map(row=>({query:row.body.input.query,revision:row.body.input.researchRevision,scope:row.body.input.scope,
      phase:row.admission_checkpoint.phase}));
    assert.deepEqual(frozen,[{query,revision:1,scope:frozenScope,phase:"discover"},{query,revision:1,scope:frozenScope,phase:"discover"}]);
    assert.equal((await pg.query("SELECT count(*)::int n FROM runtime_operation_runs WHERE operation_id=$1",[direct.operationId])).rows[0].n,0);
    assert.equal((await pg.query("SELECT count(*)::int n FROM runtime_chat_messages WHERE body::jsonb->>'conversationId'=$1",[thread])).rows[0].n,1);
    assert.equal((await advance(1)).status,200);
    assert.deepEqual(await (await execute(actions(),"POST",action,watch)).json(),direct);
    assert.equal((await execute(actions(),"POST",{...action,actionId:randomUUID()},watch)).status,409);

    const firstWorker=startWorker();
    const firstMessage=await Promise.race([firstAccepted,sleep(10_000,undefined,{ref:false}).then(()=>{throw Error("worker never delegated");})]);
    const checkpoint=await pg.query("SELECT request_id,operation_id FROM runtime_operation_steps WHERE request_id=$1",[firstMessage]);
    assert.equal(checkpoint.rowCount,1);
    const exited=once(firstWorker,"exit");firstWorker.kill("SIGKILL");
    assert.equal((await exited)[1],"SIGKILL");letFirstReturn();
    const replacement=startWorker();
    assert.notEqual(firstWorker.pid,replacement.pid);
    const getResult=async(id:string,key:string)=>await until(async()=>{
      const response=await execute(opPath(id),"GET",undefined,key);
      const view=readWorkspaceDiscoveryView(await response.json());
      if(view?.status==="failed")throw Error("discovery failed: "+JSON.stringify(view));
      if(view?.status==="complete"&&view.result)return view.result;
    },"operation did not complete");
    const [directResult,chatResult]=await Promise.all([getResult(direct.operationId,watch),getResult(linked.operationId,chatKey)]);
    assert.ok(lookups.includes(firstMessage));
    assert.equal(posts.filter(p=>p.messageId===firstMessage).length,1);
    assert.equal(posts.length,2);
    assert.deepEqual(posts[0].input,posts[1].input);
    const submitted=posts[0].input.scope as {selection?:unknown;attachedScope?:{coverageScope?:{revision?:string}}[]};
    assert.deepEqual(submitted.selection,selection);
    assert.equal(submitted.attachedScope?.[0].coverageScope?.revision,coverageScope.revision);
    assert.equal(directResult.items[0].title,exactTitle);
    assert.equal(directResult.items[0].url,exactUrl);
    const nativeFrames=frames(await stream.text());
    assert.equal(nativeFrames.filter(f=>f.type==="RUN_FINISHED"||f.type==="RUN_ERROR").length,1);
    assert.equal(nativeFrames.at(-1).type,"RUN_FINISHED");
    assert.deepEqual(nativeFrames.at(-1).result.oneearth.response.workspaceDiscovery,{operationId:linked.operationId,...chatResult});
    assert.doesNotMatch(JSON.stringify(nativeFrames),new RegExp(chatKey));
    assert.doesNotMatch(JSON.stringify(await (await execute(opPath(direct.operationId)+"/record","GET",undefined,watch)).json()),new RegExp(watch));
    const ref={operationId:direct.operationId,batchId:directResult.batchId,accessKey:watch};
    for(const [reference,selectedThread] of [[{...ref,accessKey:chatKey},thread],[ref,otherThread],[{...ref,batchId:randomUUID()},thread]] as const)
      assert.equal((await postChat("请给我原资料出处",{discoveryReference:reference},selectedThread).response).status,404);
    const reference=postChat("请给我原资料出处",{discoveryReference:ref});
    const answer=frames(await (await reference.response).text());
    assert.deepEqual(answer.at(-1).result.oneearth.response.workspaceDiscovery,{operationId:direct.operationId,...directResult});
    assert.equal(posts.length,2);
    assert.doesNotMatch(JSON.stringify(answer),new RegExp(watch));
    const persisted=await pg.query("SELECT body FROM runtime_chat_messages WHERE id=ANY($1::uuid[])",[[native.runId,reference.runId]]);
    assert.ok(persisted.rows.every(row=>!String(row.body).includes(watch)&&!String(row.body).includes(chatKey)));
    assert.equal((await pg.query("SELECT count(*)::int n FROM runtime_operation_runs WHERE operation_id=$1",[direct.operationId])).rows[0].n,0);

    const cancelled=readWorkspaceDiscoveryAccepted(await (await execute(actions(),"POST",
      {kind:"discover-materials",actionId:randomUUID(),expectedRevision:2,query:cancelQuery},watch)).json());
    assert.ok(cancelled);
    const started=await until(async()=>posts.find(p=>p.input.query===cancelQuery),"cancel fixture was not delegated");
    assert.equal((await execute(opPath(cancelled.operationId),"DELETE",undefined,chatKey)).status,404);
    assert.equal((await execute(opPath(cancelled.operationId),"DELETE",undefined,watch)).status,204);
    await until(async()=>cancels.find(id=>id===started.id),"remote cancellation not observed",8500);
    assert.equal((await (await execute(opPath(cancelled.operationId),"GET",undefined,watch)).json()).status,"cancelled");
    const nativeCancelled=postChat("发现资料："+cancelQuery,{discoveryAction:{actionId:randomUUID(),expectedRevision:2,accessKey:chatKey}});
    const nativeCancellationStream=await nativeCancelled.response;
    assert.equal(nativeCancellationStream.status,200);
    const nativeRemote=await until(async()=>posts.find(p=>p.input.query===cancelQuery&&p.id!==started.id),"native cancel was not delegated");
    assert.equal((await execute("/api/tasks/"+nativeCancelled.runId,"DELETE")).status,404);
    assert.equal((await execute("/api/tasks/"+nativeCancelled.runId,"DELETE",undefined,watch)).status,404);
    assert.equal((await execute("/api/tasks/"+nativeCancelled.runId,"DELETE",undefined,chatKey)).status,204);
    assert.deepEqual(frames(await nativeCancellationStream.text()).at(-1).outcome,{type:"cancelled"});
    await until(async()=>cancels.find(id=>id===nativeRemote.id),"native remote cancellation not observed",8500);
    assert.equal(cancels.filter(id=>id===started.id).length,1);
    assert.equal(cancels.filter(id=>id===nativeRemote.id).length,1);

    const count=posts.length;
    assert.ok(replacement.kill("SIGSTOP"));
    let stale:NonNullable<ReturnType<typeof readWorkspaceDiscoveryAccepted>>;
    try{
      assert.equal((await execute(actions(otherThread),"POST",{...adoption,actionId:randomUUID()})).status,200);
      const accepted=readWorkspaceDiscoveryAccepted(await (await execute(actions(otherThread),"POST",
        {...action,actionId:randomUUID()},watch)).json());
      assert.ok(accepted);stale=accepted;publication="b".repeat(64);
    }finally{replacement.kill("SIGCONT");}
    const rejected=await until(async()=>{
      const view=readWorkspaceDiscoveryView(await (await execute(opPath(stale.operationId,otherThread),"GET",undefined,watch)).json());
      if(view?.status==="failed")return view;
    },"stale publication accepted instead of refusing the original scope");
    assert.equal(rejected.result?.complete,false);
    assert.equal(posts.length,count);

    if(browserProof){
      const {chromium}=await import("playwright-core");
      const browser=await chromium.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true,
        args:["--enable-webgl","--ignore-gpu-blocklist","--enable-unsafe-swiftshader","--disable-background-networking"]});
      try{
        const page=await browser.newPage({viewport:{width:1440,height:960}});
        let workspaceWrites=0,nativeWrites=0;
        const offsite:string[]=[];
        await page.route("**/*",route=>{
          const url=new URL(route.request().url());
          if(url.origin===base)return route.continue();
          offsite.push(url.hostname);return route.abort();
        });
        page.on("request",req=>{
          const path=new URL(req.url()).pathname;
          if(req.method()==="POST"&&path.endsWith("/actions")&&req.postDataJSON()?.kind==="discover-materials")workspaceWrites++;
          if(req.method()==="POST"&&path==="/api/ag-ui")nativeWrites++;
        });
        await page.goto(base+"/?view=chat",{waitUntil:"domcontentloaded"});
        const composer=page.getByRole("textbox",{name:"向 OneEarth 提问",exact:true});
        await composer.waitFor({timeout:12000});
        await composer.fill("浏览器隔离资料查找");
        const pane=page.getByRole("region",{name:"查找资料",exact:true});
        const receipt=page.waitForResponse(response=>response.request().method()==="POST"&&new URL(response.url()).pathname.endsWith("/actions"));
        await pane.getByRole("button",{name:"查找资料",exact:true}).click();
        const operation=readWorkspaceDiscoveryAccepted(await (await receipt).json());assert.ok(operation);
        await pane.getByRole("link",{name:exactTitle,exact:true}).waitFor({timeout:15000});
        assert.equal(await pane.getByRole("link",{name:exactTitle,exact:true}).getAttribute("href"),exactUrl);
        assert.equal(nativeWrites,0);
        assert.equal(posts.length,count+1);
        await page.reload({waitUntil:"domcontentloaded"});
        await pane.getByRole("link",{name:exactTitle,exact:true}).waitFor({timeout:12000});
        assert.equal(workspaceWrites,1);
        await pane.getByRole("button",{name:"引用到 Chat",exact:true}).click();
        await composer.fill("给出这项资料保存的出处");
        const sent=page.waitForRequest(req=>req.method()==="POST"&&new URL(req.url()).pathname==="/api/ag-ui");
        await composer.press("Enter");
        const native=(await sent).postDataJSON();
        assert.equal(native.forwardedProps.oneearth.submission.discoveryReference.operationId,operation.operationId);
        await page.getByText("以下为你选定的原批次资料。",{exact:true}).waitFor({timeout:15000});
        assert.equal(nativeWrites,1);
        assert.equal(posts.length,count+1);
        assert.deepEqual(offsite,[]);
        const screenshot=process.env.ONEEARTH_WORKSPACE_DISCOVERY_SCREENSHOT;
        if(screenshot)await page.screenshot({path:screenshot});
        console.log(JSON.stringify({combinedChrome:true,workspaceWrites,nativeWrites,refreshReusedOperation:true,exactSource:exactUrl,referenceNewDelegations:0}));
      }finally{await browser.close();}
    }

    console.log(JSON.stringify({sameFrozenInput:true,oneAcceptedOperationPerAction:true,standaloneHasNoChatRun:true,archivedSourcesReused:true,
      workerPidChanged:true,recoveredA2ARequestWithoutResubmit:true,remoteCancellation:true,crossConversationDenied:true,stalePublicationZeroDelegation:true}));
  });
