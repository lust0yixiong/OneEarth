import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import {mkdtempSync, rmSync} from "node:fs";
import path from "node:path";
import test from "node:test";
import {setTimeout as delay} from "node:timers/promises";
import express from "express";
import {discoveryA2aRouter} from "./discovery-a2a-server";
import {discoveryA2aStore} from "./discovery-a2a-store";
import {allowedDiscoveryTools,discoveryConfiguration} from "./discovery-config";
import {discoveryInput,discoveryLegacyStore} from "./discovery-input";
import {postgresTaskStore} from "./postgres-task-store";
import {productDatabase} from "./product-database";
import {taskRoutes,workTasks} from "./task-store";
import {requiredDataSearch} from "./data-search";
import type {DiscoveryInput} from "./discovery-contract";

const fixtureModel = '{"executor":"codex","model":"gpt-6-luna"}';
const configuration = discoveryConfiguration({ONEEARTH_DISCOVERY_CHAT_MODEL:fixtureModel,
  ONEEARTH_DEEPSEEK_SEARCH:"true",ONEEARTH_DEEPSEEK_FETCH:"true",DEEPSEEK_API_KEY:"fixture-not-a-key"});
const business: Omit<DiscoveryInput,"config"> = {
  query:"固定资料缺口",history:[],references:[],currentDatasets:[],
  scope:{filters:{need:-1,type:"",source:"",place:"",period:null,depth:null,maxDem:null},selection:null,caseId:null,citation:null},
  deepseekTools:{search:false,fetch:true},
};
const receiptHeaders = {"A2A-Version":"1.0","Content-Type":"application/a2a+json"};
const result = {plan:{questionMode:"preserve",dataQuestion:business.query},papers:[],haina:[],searches:[],issues:[],
  sourceStatus:[{source:"论文",status:"done",count:1},{source:"公开网络",status:"failed",count:0}]};

test("provider model and optional tools use local authorization without exposing credential values", () => {
  assert.equal(discoveryConfiguration({}).kind,"missing");
  const invalid = discoveryConfiguration({ONEEARTH_DISCOVERY_CHAT_MODEL:'{"apiKey":"fixture-secret"}'});
  assert.equal(invalid.kind,"invalid");
  assert.doesNotMatch(JSON.stringify(invalid),/fixture-secret/);
  assert.equal(discoveryConfiguration({ONEEARTH_DISCOVERY_CHAT_MODEL:'{"executor":"claude","model":"m","provider":"deepseek"}'}).kind,"invalid");
  assert.equal(discoveryConfiguration({ONEEARTH_DISCOVERY_CHAT_MODEL:'{"executor":"codex","model":"m","provider":"custom","endpoint":"https://example.test"}'}).kind,"invalid");
  assert.deepEqual(allowedDiscoveryTools({search:true,fetch:true},{search:false,fetch:true}),{search:false,fetch:true});
  assert.deepEqual(allowedDiscoveryTools(undefined,{search:true,fetch:true}),{search:false,fetch:false});
});

const pgBin = process.env.ONEEARTH_A2A_TEST_PG_BIN;
test("isolated PostgreSQL and loopback exercise the A2A provider and legacy compatibility",
  {skip:!pgBin && "set ONEEARTH_A2A_TEST_PG_BIN to local PostgreSQL binaries",timeout:30000}, async t => {
  assert.ok(pgBin);
  const dir = mkdtempSync("/tmp/oe-a2a-");
  const data = path.join(dir,"data");
  const pg = (name:string,args:string[]) => execFileSync(path.join(pgBin,name),args,{encoding:"utf8",stdio:"pipe"});
  let started = false;
  const previous = process.env.ONEEARTH_DISCOVERY_DATABASE_URL;
  let close = async () => {};
  t.after(async () => {
    try {await close();}
    finally {
      if (previous === undefined) delete process.env.ONEEARTH_DISCOVERY_DATABASE_URL;
      else process.env.ONEEARTH_DISCOVERY_DATABASE_URL = previous;
      if (started) pg("pg_ctl",["-D",data,"-m","fast","-w","stop"]);
      rmSync(dir,{recursive:true,force:true});
    }
  });
  pg("initdb",["-D",data,"-U","oneearth_fixture","-A","trust","--no-locale","--encoding=UTF8"]);
  pg("pg_ctl",["-D",data,"-l",path.join(dir,"postgres.log"),"-o",'-c listen_addresses= -k "'+dir+'"',"-w","start"]);
  started = true;
  process.env.ONEEARTH_DISCOVERY_DATABASE_URL = "postgresql://oneearth_fixture@localhost/postgres?host="+encodeURIComponent(dir);

  let activeConfig = configuration;
  let origin = "";
  const seen: DiscoveryInput[] = [];
  let channelCalls = 0;
  let initialReleased = false;
  async function startService() {
    const pool = productDatabase("DISCOVERY"), store = await postgresTaskStore("discovery");
    const delegations = await discoveryA2aStore(pool);
    const app = express();
    const prepare = discoveryInput(store,configuration,delegations);
    app.use(discoveryA2aRouter(delegations,(input,resume) => discoveryInput(store,activeConfig,delegations).a2a(input,resume)));
    app.use(express.json());
    taskRoutes(app,"/v1/discoveries",discoveryLegacyStore(store,delegations,configuration,prepare),prepare.legacy);
    const server = app.listen(0,"127.0.0.1");
    await once(server,"listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    origin = "http://127.0.0.1:" + address.port;
    const stop = await workTasks(store, async ({body}: {body:DiscoveryInput},signal,emit) => {
      seen.push(body);
      if (body.query === "确认前不可检索" && !body.decision) return {result:{...result,
        questionCheck:{originalQuestion:body.query,proposedQuestion:"经确认的研究问题"},sourceStatus:[]}};
      if (body.query === "需澄清") {
        const reply = body.clarificationReply?.text;
        if (!reply) return {result:{...result,clarification:"请补充目标资料类型。",sourceStatus:[]}};
        const original = (await store.terminal(body.continuedFrom!))?.result as {clarification?:string};
        assert.ok(original.clarification);
        const plan = {
          questionMode:"preserve",dataQuestion:body.query,dataNeed:null,hainaQueries:["研究覆盖范围"],
          paper:{name:"",facets:[{need:"资料覆盖",queries:["coverage data"]}],region:[],scenario:[]},
          web:[{web:"coverage data",dataset:"coverage data"}],
        };
        return {result:await requiredDataSearch(body.query,signal,{
          resumingClarification:true,
          plan:async () => JSON.stringify(reply === "先核对资料" ? {...plan,clarification:"请补充想核对的字段。"}
            : reply === "改查另一个研究对象" ? {questionMode:"reframe",dataQuestion:"比较火星地层的多光谱数据"}
            : reply === "返回错误的 preserve" ? {...plan,dataQuestion:"比较火星地层的多光谱数据"} : plan),
          stage:stage=>emit({stage}),report:call=>emit({call}),finding:finding=>emit({finding}),planned:planned=>emit({planned}),
          paper:async () => {channelCalls++;return {records:[],incomplete:[],tools:[]};},
          haina:async () => {channelCalls++;return {assets:[],total:0,synced:"",endpoint:"fixture",warning:""};},
          web:async () => {channelCalls++;return [{engine:"DataCite",query:"coverage data",status:"done",
            hits:[{title:"已取得的固定资料",url:"https://example.test/clarified",snippet:"覆盖范围"}]}];},
        },body.decision)};
      }
      channelCalls++;
      while (body.query === business.query && !body.continuation && !initialReleased) await delay(20,undefined,{signal});
      emit({finding:{title:"已取得的论文材料",source:"https://example.test/material"}});
      if (body.query === "保持运行") await delay(8000,undefined,{signal});
      else await delay(400,undefined,{signal});
      return {result};
    });
    close = async () => {
      stop();
      server.closeAllConnections();
      await new Promise<void>(done => server.close(() => done()));
      await delay(250);
      await store.close();
      await pool.end();
    };
    return {pool,store,delegations};
  }
  let service = await startService();
  function request(url:string,method = "GET",body?:object) {
    return fetch(origin+url,{method,headers:receiptHeaders,body:body && JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  }
  function submit(messageId:string,input:object,immediate:boolean|undefined=true, task?:{id:string;contextId:string}) {
    return request("/message:send","POST",{
      message:{role:"ROLE_USER",messageId,parts:[{data:{kind:"oneearth.discovery.request.v1",input}}],
        ...(task ? {taskId:task.id,contextId:task.contextId} : {})},
      ...(immediate === undefined ? {} : {configuration:{returnImmediately:immediate}}),
    });
  }
  type Receipt = Awaited<ReturnType<typeof task>>;
  async function task(response:Response, wrapped = false) {
    assert.equal(response.status,200,await response.clone().text());
    const body = await response.json();
    return (wrapped ? body.task : body) as {id:string;contextId:string;status:{state:string};
      artifacts:{artifactId:string;parts:[{data:{event:{seq:number;[key:string]:unknown}}}]}[]};
  }
  const events = (value:Receipt) => value.artifacts.map(a => a.parts[0].data.event);
  async function waitState(id:string,state:string) {
    for (let i=0; i<120; i++) {
      const current = await task(await request("/tasks/"+id));
      if (current.status.state === state) return current;
      await delay(25);
    }
    assert.fail("missing state " + state);
  }

  const card = await (await fetch(origin+"/.well-known/agent-card.json")).json();
  assert.equal(card.supportedInterfaces[0].url,origin);
  assert.equal(card.supportedInterfaces[0].protocolBinding,"HTTP+JSON");
  const versionError = await fetch(origin+"/tasks/"+randomUUID());
  assert.equal(versionError.status,400);
  assert.equal((await versionError.json()).error.details[0].reason,"VERSION_NOT_SUPPORTED");

  activeConfig = discoveryConfiguration({});
  assert.equal((await submit(randomUUID(),business)).status,503);
  activeConfig = discoveryConfiguration({ONEEARTH_DISCOVERY_CHAT_MODEL:"broken-json"});
  assert.equal((await submit(randomUUID(),business)).status,503);
  activeConfig = configuration;
  assert.equal((await submit(randomUUID(),{...business,config:{executor:"claude",model:"foreign"}})).status,400);
  assert.equal((await submit(randomUUID(),{...business,deepseekTools:{search:false,fetch:true,key:"fixture"}})).status,400);

  const messageId = randomUUID();
  const receipts = await Promise.all(Array.from({length:8},() => submit(messageId,business).then(r=>task(r,true))));
  const id = receipts[0].id;
  assert.notEqual(id,messageId);
  assert.ok(receipts.every(r=>r.id === id));
  assert.equal((await submit(messageId,{...business,query:"different input"})).status,409);
  const reordered = {...business,scope:{...business.scope,filters:{...business.scope.filters,need:-1}}};
  assert.equal((await task(await submit(messageId,Object.fromEntries(Object.entries(reordered).reverse())),true)).id,id);
  assert.equal((await request("/tasks/"+messageId+":cancel","POST",{})).status,404);

  const stream = await request("/tasks/"+id+":subscribe","POST",{id});
  initialReleased = true;
  assert.equal(stream.status,200,await stream.clone().text());
  assert.match(stream.headers.get("Content-Type") ?? "",/^text\/event-stream/);
  const frames = (await stream.text()).trim().split("\n\n").map(line => JSON.parse(line.slice(6)));
  assert.equal(frames[0].task.id,id);
  assert.ok(frames.some(frame => frame.artifactUpdate?.artifact.parts[0].data.event.result));
  assert.equal(frames.at(-1).statusUpdate.status.state,"TASK_STATE_COMPLETED");
  const completed = await task(await request("/tasks/"+id));
  assert.ok(events(completed).some(event=>event.finding));
  assert.deepEqual(events(completed).at(-1)?.result,result);
  assert.equal((await request("/tasks/"+id+":subscribe","POST")).status,400);
  assert.equal((await request("/tasks/"+id+":cancel","POST",{})).status,400);
  assert.equal(seen.filter(b=>b.query===business.query).length,1);
  assert.equal(seen[0].config.model,"gpt-6-luna");

  const running = await task(await submit(randomUUID(),{...business,query:"保持运行"}),true);
  await waitState(running.id,"TASK_STATE_WORKING");
  for (let i=0; i<40 && !events(await task(await request("/tasks/"+running.id))).some(e=>e.finding); i++)
    await delay(25);
  const live = await request("/tasks/"+running.id+":subscribe","POST");
  assert.equal(live.status,200);
  await live.body!.getReader().cancel();
  assert.equal((await task(await request("/tasks/"+running.id))).status.state,"TASK_STATE_WORKING");
  const cancelled = await task(await request("/tasks/"+running.id+":cancel","POST",{id:running.id}));
  assert.equal(cancelled.status.state,"TASK_STATE_CANCELED");
  assert.ok(events(cancelled).some(event=>event.finding));
  assert.equal((await task(await request("/tasks/"+running.id+":cancel","POST"))).status.state,"TASK_STATE_CANCELED");
  assert.equal(events(await task(await request("/tasks/"+running.id))).filter(e=>e.code==="cancelled").length,1);

  const channelsBeforeConfirmation = channelCalls;
  const pending = {...business,query:"确认前不可检索"};
  const waitResponse = await request("/message:send","POST",{
    message:{role:"ROLE_USER",messageId:randomUUID(),parts:[{data:{kind:"oneearth.discovery.request.v1",input:pending}}]},
  });
  const paused = await task(waitResponse,true);
  assert.equal(paused.status.state,"TASK_STATE_INPUT_REQUIRED");
  assert.equal(channelCalls,channelsBeforeConfirmation);
  const before = events(paused).at(-1)!.seq;
  assert.match((await (await request("/tasks/"+paused.id+":subscribe","POST")).text()),/TASK_STATE_INPUT_REQUIRED/);

  const input = {...pending,continuedFrom:paused.id,decision:{
    choice:"proposed",originalQuestion:pending.query,dataQuestion:"经确认的研究问题",checkMessageId:randomUUID(),
  }};
  assert.equal((await submit(randomUUID(),input,true,{...paused,contextId:randomUUID()})).status,400);
  assert.equal((await submit(randomUUID(),input)).status,400);
  assert.equal((await submit(randomUUID(),{...input,scope:{...input.scope,filters:{...input.scope.filters,place:"越界"} }},true,paused)).status,400);
  assert.equal((await submit(randomUUID(),{...input,decision:{...input.decision,dataQuestion:"未确认提议"}},true,paused)).status,400);
  assert.equal(channelCalls,channelsBeforeConfirmation);
  const confirmId = randomUUID();
  const restarted = await Promise.all(Array.from({length:8},()=>submit(confirmId,input,true,paused).then(r=>task(r,true))));
  assert.ok(restarted.every(r=>r.id===paused.id && r.contextId===paused.contextId));
  const continued = await waitState(paused.id,"TASK_STATE_COMPLETED");
  assert.deepEqual(events(continued).filter(e=>e.seq<=before),events(paused));
  assert.ok(events(continued).some(e=>e.seq>before && e.finding));
  assert.equal(new Set(continued.artifacts.map(a=>a.artifactId)).size,continued.artifacts.length);
  assert.equal(channelCalls,channelsBeforeConfirmation+1);
  assert.equal((await task(await submit(confirmId,input,true,paused),true)).id,paused.id);
  assert.equal((await submit(randomUUID(),input,true,paused)).status,400);

  const supplemental = {...input,continuedFrom:undefined,decision:undefined,continuation:{previousId:id,focus:"另一证据缺口"},
    evidenceGap:"另一证据缺口",query:business.query};
  const newTask = await task(await submit(randomUUID(),supplemental,false),true);
  assert.notEqual(newTask.id,id);
  assert.equal(newTask.status.state,"TASK_STATE_COMPLETED");
  assert.equal((await submit(randomUUID(),{...supplemental,deepseekTools:{search:true,fetch:true}})).status,400);
  assert.equal((await submit(randomUUID(),{...supplemental,query:"另一个研究目标"})).status,400);

  const confirmedSupplement = {...input,continuation:{previousId:paused.id,focus:"确认后的新证据缺口"}};
  assert.equal((await task(await submit(randomUUID(),confirmedSupplement,false),true)).status.state,"TASK_STATE_COMPLETED");

  const raceParent = await task(await submit(randomUUID(),pending,false),true);
  const competing = {...input,continuedFrom:raceParent.id};
  const confirmations = [randomUUID(),randomUUID()];
  const race = await Promise.all(confirmations.map(key=>submit(key,competing,true,raceParent)));
  assert.equal(race.filter(response=>response.status===200).length,1);
  assert.ok(race.some(response=>response.status===409 || response.status===400));
  await Promise.all(race.map(response=>response.text()));
  await waitState(raceParent.id,"TASK_STATE_COMPLETED");
  const jobs = await service.pool.query("SELECT count(*) FROM discovery_a2a_delegations WHERE task_id=$1",[raceParent.id]);
  assert.equal(Number(jobs.rows[0].count),2,"initial planning plus exactly one admitted confirmation job");

  const clarificationInput = {...business,query:"需澄清",researchGoal:"核对原资料的覆盖范围",
    scope:{...business.scope,filters:{...business.scope.filters,place:"科切拉谷"}}};
  const clarification = await task(await submit(randomUUID(),clarificationInput,false),true);
  assert.equal(clarification.status.state,"TASK_STATE_INPUT_REQUIRED");
  const firstWait = events(clarification).at(-1)!.seq;
  const firstReply = {continuedFrom:clarification.id,clarificationReply:{text:"先核对资料",afterSeq:firstWait}};
  const beforeClarification = channelCalls;
  assert.equal((await submit(randomUUID(),firstReply)).status,400);
  assert.equal((await submit(randomUUID(),{...firstReply,query:"新问题"},true,clarification)).status,400);
  assert.equal((await submit(randomUUID(),{...firstReply,researchGoal:"新目标"},true,clarification)).status,400);
  assert.equal((await submit(randomUUID(),{...firstReply,scope:business.scope},true,clarification)).status,400);
  assert.equal((await submit(randomUUID(),{...firstReply,deepseekTools:{search:true,fetch:true}},true,clarification)).status,400);
  assert.equal((await submit(randomUUID(),{...firstReply,clarificationReply:{text:"   ",afterSeq:firstWait}},true,clarification)).status,400);
  const forged = {...clarificationInput,continuedFrom:clarification.id,decision:{
    choice:"edited",originalQuestion:clarificationInput.query,dataQuestion:"未经确认的新目标",checkMessageId:randomUUID(),
  }};
  assert.equal((await submit(randomUUID(),forged,true,clarification)).status,400);
  const firstReplyId = randomUUID();
  const secondWaitTask = await task(await submit(firstReplyId,firstReply,false,clarification),true);
  assert.equal(secondWaitTask.id,clarification.id);
  assert.equal(secondWaitTask.status.state,"TASK_STATE_INPUT_REQUIRED");
  const secondWait = events(secondWaitTask).at(-1)!.seq;
  assert.ok(secondWait > firstWait);
  assert.equal(channelCalls,beforeClarification);
  assert.deepEqual(events(secondWaitTask).filter(e=>e.seq<=firstWait),events(clarification));
  assert.equal((await submit(randomUUID(),firstReply,true,clarification)).status,400);
  assert.equal((await task(await submit(firstReplyId,firstReply,true,clarification),true)).id,clarification.id);
  assert.equal((await submit(firstReplyId,{...firstReply,clarificationReply:{...firstReply.clarificationReply,text:"改了文本"}},true,clarification)).status,409);

  const finalReply = {continuedFrom:clarification.id,clarificationReply:{text:"时间覆盖范围",afterSeq:secondWait}};
  const clarifyRace = await Promise.all([randomUUID(),randomUUID()].map(key=>submit(key,finalReply,true,clarification)));
  assert.equal(clarifyRace.filter(response=>response.status===200).length,1);
  assert.ok(clarifyRace.some(response=>response.status===409 || response.status===400));
  await Promise.all(clarifyRace.map(response=>response.text()));
  const clarified = await waitState(clarification.id,"TASK_STATE_COMPLETED");
  assert.equal(channelCalls,beforeClarification+3);
  assert.ok(events(clarified).some(e=>e.seq>secondWait && e.finding));
  const workerReplies = seen.filter(body=>body.query===clarificationInput.query && body.clarificationReply);
  assert.deepEqual(workerReplies.map(body=>body.clarificationReply),[firstReply.clarificationReply,finalReply.clarificationReply]);
  assert.ok(workerReplies.every(body=>body.researchGoal===clarificationInput.researchGoal &&
    body.scope.filters.place===clarificationInput.scope.filters.place && !body.deepseekTools?.search && body.deepseekTools?.fetch));
  assert.equal((await submit(randomUUID(),finalReply,true,clarification)).status,400);

  const change = await task(await submit(randomUUID(),clarificationInput,false),true);
  const changeReply = {continuedFrom:change.id,clarificationReply:{text:"改查另一个研究对象",afterSeq:events(change).at(-1)!.seq}};
  const proposal = await task(await submit(randomUUID(),changeReply,false,change),true);
  assert.equal(proposal.status.state,"TASK_STATE_INPUT_REQUIRED");
  assert.equal(channelCalls,beforeClarification+3);
  assert.deepEqual((events(proposal).at(-1)!.result as {questionCheck:unknown}).questionCheck,{
    originalQuestion:clarificationInput.query,proposedQuestion:"比较火星地层的多光谱数据"});
  const replyToProposal = {...changeReply,clarificationReply:{...changeReply.clarificationReply,afterSeq:events(proposal).at(-1)!.seq}};
  assert.equal((await submit(randomUUID(),replyToProposal,true,change)).status,400);
  const ended = await task(await request("/tasks/"+change.id+":cancel","POST"));
  assert.equal(ended.status.state,"TASK_STATE_CANCELED");
  assert.ok(events(ended).some(e=>e.result));
  assert.equal((await submit(randomUUID(),replyToProposal,true,change)).status,400);

  const malformed = await task(await submit(randomUUID(),clarificationInput,false),true);
  const badPlan = await task(await submit(randomUUID(),{continuedFrom:malformed.id,
    clarificationReply:{text:"返回错误的 preserve",afterSeq:events(malformed).at(-1)!.seq}},false,malformed),true);
  assert.equal(badPlan.status.state,"TASK_STATE_FAILED");
  assert.equal(channelCalls,beforeClarification+3);

  const legacyId = randomUUID();
  const legacyInput = {...business,config:{executor:"claude",model:"caller-model"}};
  const legacy = (input:object) => fetch(origin+"/v1/discoveries",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({id:legacyId,input})});
  assert.equal((await legacy(legacyInput)).status,202);
  assert.equal((await legacy(legacyInput)).status,202);
  assert.equal((await legacy({...legacyInput,query:"different"})).status,409);
  assert.equal((await request("/tasks/"+legacyId)).status,404);
  assert.equal((await fetch(origin+"/v1/discoveries/"+legacyId)).status,200);
  const jobId = (await service.delegations.progress(id))!.jobId;
  for (const suffix of ["","/events"])
    assert.equal((await fetch(origin+"/v1/discoveries/"+jobId+suffix)).status,404);
  assert.equal((await fetch(origin+"/v1/discoveries/"+jobId,{method:"DELETE"})).status,404);
  assert.deepEqual(JSON.parse((await service.store.get(legacyId))!.body).config,{executor:"codex",model:"gpt-6-luna",provider:"native"});

  // Reopen only after the intentionally queued legacy work has settled.
  for (let i=0; i<120 && (await service.store.get(legacyId))?.status !== "complete"; i++) await delay(25);
  assert.equal((await service.store.get(legacyId))?.status,"complete");
  await close();
  close = async () => {};
  service = await startService();
  const callsBeforeReplay = channelCalls;
  assert.equal((await task(await request("/tasks/"+paused.id))).id,paused.id);
  assert.equal((await task(await submit(confirmId,input,true,paused),true)).id,paused.id);
  assert.equal((await task(await submit(messageId,business),true)).id,id);
  assert.equal((await task(await submit(firstReplyId,firstReply,true,clarification),true)).id,clarification.id);
  assert.deepEqual(events(await task(await request("/tasks/"+clarification.id))),events(clarified));
  assert.equal((await submit(confirmId,{...input,evidenceGap:"different"},true,paused)).status,409);
  assert.deepEqual(events(await task(await request("/tasks/"+paused.id))),events(continued));
  await delay(200);
  assert.equal(channelCalls,callsBeforeReplay);
  t.diagnostic("HTTP and worker reopened on the same isolated PostgreSQL storage without replaying work");
});
