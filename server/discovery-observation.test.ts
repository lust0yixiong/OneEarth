import assert from "node:assert/strict";
import {execFileSync, spawn} from "node:child_process";
import {randomBytes, randomUUID} from "node:crypto";
import {once} from "node:events";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {createServer} from "node:net";
import path from "node:path";
import test from "node:test";
import {setTimeout as delay} from "node:timers/promises";
import {Pool} from "pg";
import {
  observationCheckSkill, skillRequestKind, skillResultKind, type ObservationCheckResult, type SkillDemand,
} from "./observation-check-contract";
import {modelObservationEvidence, observationResearchKind, type ObservationResearchResult} from "./observation-research-contract";

const pgBin = process.env.ONEEARTH_A2A_TEST_PG_BIN;
const headers = {"A2A-Version":"1.0","Content-Type":"application/a2a+json"};
const check = {skill:observationCheckSkill,artifactId:"fixture-observations",version:"v1",variable:"temperature",
  unit:"K",start:"2025-01-01",end:"2025-01-31"};
const result:ObservationCheckResult = {status:"verified",matches:true,evidence:{artifactId:check.artifactId,version:check.version,
  sha256:"a".repeat(64),variable:check.variable,unit:check.unit,count:2,first:check.start,last:check.end}};
type Event = {seq:number; taskId:string; skillDemand?:SkillDemand;
  result?:{observationCheckResult?:ObservationCheckResult;observationResearchResult?:ObservationResearchResult};
  observationResearchModel?:{phase:string;action?:string;model?:{model:string;provider:string};input?:unknown;executorFailure?:string};
  observationResearchConsumption?:{requestId:string;afterSeq:number;status:string}};
type Document = {id:string;status:{state:string};artifacts:{parts:{data:{event:Event}}[]}[]};
const events = (task:Document) => task.artifacts.map(artifact=>artifact.parts[0].data.event);

test("actual discovery worker persists and resumes a private operation in the same A2A Task",
  {skip:!pgBin && "set ONEEARTH_A2A_TEST_PG_BIN to PostgreSQL binaries",timeout:30000}, async t => {
  assert.ok(pgBin);
  const dir = mkdtempSync("/tmp/oe-obs-");
  const data = path.join(dir,"data");
  const pg = (name:string,args:string[]) => execFileSync(path.join(pgBin,name),args,{encoding:"utf8",stdio:"pipe"});
  let stopService: (()=>Promise<void>)|undefined, pool:Pool|undefined, postgresStarted = false;
  t.after(async () => {
    try {
      await stopService?.();
      await pool?.end();
    } finally {
      if (postgresStarted) pg("pg_ctl",["-D",data,"-m","fast","-w","stop"]);
      rmSync(dir,{recursive:true,force:true});
    }
  });
  pg("initdb",["-D",data,"-U","oneearth_fixture","-A","trust","--no-locale","--encoding=UTF8"]);
  pg("pg_ctl",["-D",data,"-l",path.join(dir,"postgres.log"),"-o",'-c listen_addresses= -k "'+dir+'"',"-w","start"]);
  postgresStarted = true;
  const database = "postgresql://oneearth_fixture@localhost/postgres?host="+encodeURIComponent(dir);
  pool = new Pool({connectionString:database});
  const db = pool;
  const token = randomBytes(32).toString("hex");
  let origin = "";

  // The real service calls its normal model adapter, but this executable never contacts a provider.
  writeFileSync(path.join(dir,"claude"),"#!"+process.execPath+"\n"+`
const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
assert.equal(process.env.ANTHROPIC_BASE_URL,"https://api.deepseek.com/anthropic");
assert.equal(process.env.ANTHROPIC_MODEL,"deepseek-flash");
assert.equal(process.env.ONEEARTH_SKILL_SERVICE_TOKEN,undefined);
const prompt = readFileSync(0,"utf8").trim().split("\\n");
const input = JSON.parse(prompt.at(-1));
assert.deepEqual(Object.keys(input),["question","materials","evidence"]);
assert.ok(!JSON.stringify(input.materials).includes("expectedSha256"));
assert.ok(!JSON.stringify(input.evidence).includes("sha256"));
const blank = {action:"general",artifactId:null,version:null,variable:null,purpose:null,unit:null,start:null,end:null,missing:null};
const schemaPrefix = "Output JSON Schema: ";
const schema = JSON.parse(prompt.find(line=>line.startsWith(schemaPrefix)).slice(schemaPrefix.length));
assert.deepEqual(schema.required,Object.keys(blank));
assert.equal(schema.additionalProperties,false);
assert.match(prompt[0],/JSON null for every inapplicable field/);
const target = {artifactId:input.materials[0].artifactId,version:input.materials[0].version,variable:"temperature",purpose:"describe"};
let plan = {...blank};
if (input.question === "这个文件用哪个变量记录水温，单位和有值的首末？") {
  assert.match(prompt.join("\\n"),/primary direct measurement of that quantity/);
  assert.deepEqual(input.materials[0].variables,["temperature_qc","time","temperature"]);
  assert.deepEqual(input.evidence,[]);
  plan = {...blank,...target,action:"read"};
}
if (input.question === "刚才有多少条？" && input.evidence.length) {
  const [archived] = input.evidence;
  assert.equal(archived.unit,"K");
  assert.ok(archived.count===0 || archived.count===2);
  assert.equal(archived.first,archived.count ? "2025-01-01" : null);
  assert.equal(archived.last,archived.count ? "2025-01-31" : null);
  plan = {...blank,...target,action:"reuse"};
}
if (input.question === "归档记录是否符合摄氏度要求？") plan = {...blank,...target,action:"reuse",purpose:"check",
  unit:"C",start:"2025-01-01",end:"2025-01-31"};
if (input.question === "这个文件的数据怎么样？") plan = {...blank,action:"clarify",missing:"variable"};
if (input.question === "这个文件的温度变量是哪个？") {
  assert.deepEqual(input.materials[0].variables,["temperature_air","temperature_water"]);
  plan = {...blank,action:"clarify",missing:"variable"};
}
if (input.question === "Fixture returns an unregistered variable") plan = {...blank,...target,action:"read",variable:"unregistered"};
if (input.question === "Fixture returns a malformed response") {process.stdout.write("not JSON");process.exit(0);}
if (input.question === "Fixture returns a provider failure") {process.stderr.write("Error: 401 Unauthorized fixture-private-text");process.exit(1);}
process.stdout.write(JSON.stringify(plan));
`,{mode:0o700});

  async function startService() {
    const reservation = createServer().listen(0,"127.0.0.1");
    await once(reservation,"listening");
    const address = reservation.address();
    assert.ok(address && typeof address !== "string");
    const closed = once(reservation,"close");
    reservation.close();
    await closed;
    origin = "http://127.0.0.1:"+address.port;
    // Product startup keeps its Haina publish schedule. Prevent even that independent process activity from reaching an upstream.
    const preload = "data:text/javascript,"+encodeURIComponent("globalThis.fetch=async()=>{ throw Error('Fixture blocks upstream HTTP'); };");
    const worker = spawn(process.execPath,["--import","tsx","--import",preload,"server/discovery-service.ts"],{
      env:{PATH:dir+":/usr/bin:/bin",ONEEARTH_DISCOVERY_PORT:String(address.port),ONEEARTH_STATE_DIR:dir,
        ONEEARTH_DISCOVERY_CHAT_MODEL:'{"executor":"claude","provider":"deepseek","model":"deepseek-flash"}',
        DEEPSEEK_API_KEY:"fixture-only",
        ONEEARTH_DISCOVERY_DATABASE_URL:database,ONEEARTH_SKILL_SERVICE_TOKEN:token},
      stdio:["ignore","pipe","pipe"],
    });
    let diagnostics = "";
    worker.stdout?.on("data",chunk=>diagnostics+=String(chunk));
    worker.stderr?.on("data",chunk=>diagnostics+=String(chunk));
    stopService = async () => {
      if (worker.exitCode !== null || worker.signalCode !== null) return;
      const exited = once(worker,"exit");
      worker.kill("SIGTERM");
      await exited;
    };
    for (let attempt=0;attempt<100;attempt++) {
      assert.equal(worker.exitCode,null,diagnostics);
      const health = await fetch(origin+"/api/health").catch(()=>undefined);
      if (health?.ok) {await health.body?.cancel();return;}
      await delay(50);
    }
    assert.fail("Discovery service failed to start: "+diagnostics);
  }

  function call(url:string, method:string, body?:unknown, authorization = "Bearer "+token) {
    return fetch(origin+url,{method,headers:{...headers,...(authorization ? {Authorization:authorization} : {})},
      ...(body === undefined ? {} : {body:JSON.stringify(body)}),signal:AbortSignal.timeout(4000)});
  }
  function send(kind:string,input:unknown,messageId:string,taskId?:string,authorization?:string,returnImmediately=true) {
    return call("/message:send","POST",{message:{role:"ROLE_USER",messageId,parts:[{data:{kind,input}}],
      ...(taskId ? {taskId,contextId:taskId} : {})},configuration:{returnImmediately}},authorization);
  }
  async function status(response:Response, expected:number) {
    const body = await response.json();
    assert.equal(response.status,expected,JSON.stringify(body));
    return body;
  }
  const taskRoute = (id:string) => "/tasks/"+id;
  async function task(id:string):Promise<Document> {
    return status(await call(taskRoute(id),"GET"),200);
  }
  async function after(id:string, found:(task:Document)=>boolean) {
    for (let attempt=0;attempt<80;attempt++) {
      const document = await task(id);
      if (found(document)) return document;
      await delay(30);
    }
    assert.fail("Expected state did not appear for "+id);
  }
  function requirement(task:Document) {
    const event = events(task).find(event=>event.skillDemand);
    assert.ok(event?.skillDemand);
    return {event,demand:event.skillDemand};
  }
  async function jobs(id:string) {
    const {rows} = await db.query<{job_id:string;status:string}>(`SELECT d.job_id,t.status FROM discovery_a2a_delegations d
      JOIN discovery_tasks t ON t.id=d.job_id WHERE d.task_id=$1 ORDER BY t.created,t.id`,[id]);
    return rows;
  }

  await startService();
  const input = {researchTaskId:randomUUID(),check}, initialMessage = randomUUID();
  await status(await send(skillRequestKind,input,initialMessage,undefined,""),401);
  await status(await send(skillRequestKind,{...input,check:{...check,url:"https://example.test"}},initialMessage),400);
  const original:Document = (await status(await send(skillRequestKind,input,initialMessage,undefined,undefined,false),200)).task;
  assert.equal(original.status.state,"TASK_STATE_WORKING");
  assert.notEqual(original.id,input.researchTaskId);
  const {event,demand} = requirement(original);
  assert.equal(event.taskId,original.id);
  assert.deepEqual(demand,{...input,requestId:demand.requestId});
  const firstJobs = await jobs(original.id);
  assert.deepEqual(firstJobs.map(job=>job.status),["complete"]);

  const route = taskRoute(original.id);
  for (const [method,suffix] of [["GET",""],["POST",":subscribe"],["POST",":cancel"]])
    await status(await call(route+suffix,method,undefined,"Bearer incorrect"),404);
  await status(await call("/v1/discoveries/"+firstJobs[0].job_id,"GET"),404);
  await status(await send("oneearth.discovery.request.v1",{},randomUUID(),original.id),404);
  await status(await send(skillRequestKind,{...input,researchTaskId:randomUUID()},initialMessage),409);

  const second:Document = (await status(await send(skillRequestKind,input,randomUUID(),undefined,undefined,false),200)).task;
  assert.notEqual(second.id,original.id);
  const secondDemand = requirement(second);
  assert.notEqual(demand.requestId,secondDemand.demand.requestId);
  assert.equal((await task(original.id)).status.state,"TASK_STATE_WORKING");
  await stopService?.();
  await startService();
  const originalRetry = (await status(await send(skillRequestKind,input,initialMessage),200)).task;
  assert.deepEqual(originalRetry,original);

  const subscription = await call(route+":subscribe","POST",{id:original.id});
  assert.equal(subscription.status,200);
  assert.match(subscription.headers.get("content-type")??"",/text\/event-stream/);
  const stream = subscription.body?.getReader();
  assert.ok(stream);
  const decoder = new TextDecoder();
  let buffered = "", frames: {task?:Document; artifactUpdate?:{artifact:Document["artifacts"][number]};statusUpdate?:{status:{state:string}}}[] = [];
  async function readFrames(until:()=>boolean) {
    while (!until()) {
      const chunk = await stream!.read();
      assert.equal(chunk.done,false);
      buffered += decoder.decode(chunk.value,{stream:true});
      const payloads = buffered.split("\n\n");
      buffered = payloads.pop()!;
      frames = frames.concat(payloads.filter(frame=>frame.startsWith("data: ")).map(frame=>JSON.parse(frame.slice(6))));
    }
  }
  await readFrames(()=>frames.length>0);
  assert.deepEqual(frames[0].task,original);

  const receipt = {afterSeq:event.seq,requestId:demand.requestId,result};
  const accept = (value:unknown,id=original.id,messageId=randomUUID(),authorization?:string) =>
    send(skillResultKind,value,messageId,id,authorization);
  await status(await accept(receipt,original.id,randomUUID(),""),401);
  await status(await accept({...receipt,afterSeq:event.seq-1}),409);
  await status(await accept(receipt,second.id),409);
  await status(await accept({...receipt,result:{...result,evidence:{...result.evidence,version:"v2"}}}),409);
  await status(await accept({...receipt,result:{status:["failed"],reason:"fixture"}}),400);
  assert.equal((await jobs(original.id)).length,1);

  const messages = [randomUUID(),randomUUID()];
  const responses = await Promise.all(messages.map(message=>accept(receipt,original.id,message)));
  assert.deepEqual(responses.map(response=>response.status).sort(),[200,409]);
  const winner = messages[responses[0].status===200 ? 0 : 1];
  await Promise.all(responses.map(response=>response.json()));
  const done = await after(original.id,task=>task.status.state==="TASK_STATE_COMPLETED");
  assert.deepEqual(events(done).filter(event=>event.result).map(event=>event.result),[{observationCheckResult:result}]);
  assert.deepEqual(requirement(done).event,event);
  await readFrames(()=>frames.some(frame=>frame.statusUpdate?.status.state==="TASK_STATE_COMPLETED"));
  assert.deepEqual(frames.flatMap(frame=>frame.artifactUpdate?.artifact.parts.map(part=>part.data.event.result)??[]).filter(Boolean),
    [{observationCheckResult:result}]);
  assert.ok(!frames.some(frame=>frame.statusUpdate?.status.state==="TASK_STATE_SUBMITTED"));
  await stream.cancel();
  const replay = (await status(await accept(receipt,original.id,winner),200)).task;
  assert.deepEqual(replay,done);
  await status(await accept({...receipt,result:{status:"unknown",reason:"fixture"}},original.id,winner),409);
  assert.equal((await jobs(original.id)).length,2);

  const cancelled = (await status(await call(taskRoute(second.id)+":cancel","POST"),200)) as Document;
  assert.equal(cancelled.status.state,"TASK_STATE_CANCELED");
  assert.deepEqual(requirement(cancelled).event,secondDemand.event);
  await status(await accept({afterSeq:secondDemand.event.seq,requestId:secondDemand.demand.requestId,result},second.id),409);
  assert.equal((await jobs(second.id)).length,1);

  const uncertain = (await status(await send(skillRequestKind,input,randomUUID(),undefined,undefined,false),200)).task as Document;
  const uncertainDemand = requirement(uncertain);
  const unknown = {status:"unknown",reason:"receipt_lost"};
  await status(await accept({afterSeq:uncertainDemand.event.seq,requestId:uncertainDemand.demand.requestId,result:unknown},uncertain.id),200);
  const uncertainDone = await after(uncertain.id,task=>task.status.state==="TASK_STATE_COMPLETED");
  assert.deepEqual(events(uncertainDone).at(-1)?.result,{observationCheckResult:unknown});
  assert.equal((await jobs(uncertain.id)).length,2);

  const racing = (await status(await send(skillRequestKind,input,randomUUID(),undefined,undefined,false),200)).task as Document;
  const raceDemand = requirement(racing);
  const raceInput = {afterSeq:raceDemand.event.seq,requestId:raceDemand.demand.requestId,result:{status:"unknown",reason:"receipt_lost"}};
  const [accepted,cancelledRace] = await Promise.all([accept(raceInput,racing.id),call(taskRoute(racing.id)+":cancel","POST")]);
  assert.ok([200,409].includes(accepted.status));
  assert.ok([200,400].includes(cancelledRace.status));
  await Promise.all([accepted.json(),cancelledRace.json()]);
  const raceFinal = await after(racing.id,task=>["TASK_STATE_CANCELED","TASK_STATE_COMPLETED"].includes(task.status.state));
  assert.deepEqual(requirement(raceFinal).event,raceDemand.event);
  assert.equal((await jobs(racing.id)).length,accepted.status===200 ? 2 : 1);
  await status(await accept(raceInput,racing.id),409);

  await t.test("natural research selects reads, consumes receipts, and answers from archive", async () => {
    assert.equal(result.status,"verified");
    const material = {artifactId:check.artifactId,version:check.version,title:"Small observation file",
      variables:["temperature_qc","time",check.variable]};
    const publicEvidence = modelObservationEvidence(result.evidence);
    const request = {researchTaskId:randomUUID(),question:"这个文件用哪个变量记录水温，单位和有值的首末？",materials:[material],evidence:[]};
    const sendResearch = (value:unknown,messageId=randomUUID(),authorization?:string) =>
      send(observationResearchKind,value,messageId,undefined,authorization,false);
    await status(await sendResearch(request,randomUUID(),""),401);
    await status(await sendResearch({...request,materials:[{...material,path:"/denied"}]}),400);
    await status(await sendResearch({...request,evidence:[result.evidence]}),400);

    const requestId = randomUUID();
    const natural = (await status(await sendResearch(request,requestId),200)).task as Document;
    const pending = requirement(natural);
    assert.equal(natural.status.state,"TASK_STATE_WORKING");
    assert.notEqual(natural.id,request.researchTaskId);
    assert.deepEqual(pending.demand.check,{skill:observationCheckSkill,
      artifactId:check.artifactId,version:check.version,variable:check.variable,purpose:"describe"});
    const modelInput = events(natural).find(event=>event.observationResearchModel?.phase==="input")?.observationResearchModel;
    assert.deepEqual(modelInput?.model,{executor:"claude",provider:"deepseek",model:"deepseek-flash"});
    assert.deepEqual(modelInput?.input,{questionLength:request.question.length,
      materials:[{artifactId:material.artifactId,version:material.version,variables:material.variables}],evidence:[]});
    assert.equal(events(natural).find(event=>event.observationResearchModel?.phase==="decision")?.observationResearchModel?.action,"read");
    assert.doesNotMatch(JSON.stringify(natural),/expectedSha256|fixture-only|这个文件用哪个变量记录水温/);
    assert.equal((await jobs(natural.id)).length,1);

    await stopService?.();
    await startService();
    assert.deepEqual((await status(await sendResearch(request,requestId),200)).task,natural);
    const observed = {status:"verified",evidence:result.evidence};
    const input = {requestId:pending.demand.requestId,afterSeq:pending.event.seq,result:observed};
    await status(await accept({...input,result},natural.id),409);
    const receiptMessage = randomUUID();
    await status(await accept(input,natural.id,receiptMessage),200);
    const terminal = await after(natural.id,task=>task.status.state==="TASK_STATE_COMPLETED");
    assert.deepEqual(events(terminal).at(-1)?.result?.observationResearchResult,{action:"answer",basedOn:"read",evidence:publicEvidence});
    assert.equal(events(terminal).at(-1)?.result?.observationCheckResult,undefined);
    assert.deepEqual(events(terminal).flatMap(event=>event.observationResearchConsumption??[]),
      [{requestId:input.requestId,afterSeq:input.afterSeq,status:"verified"}]);
    assert.doesNotMatch(JSON.stringify(terminal),/sha256|fixture-only/);
    assert.deepEqual((await status(await accept(input,natural.id,receiptMessage),200)).task,terminal);
    assert.equal((await jobs(natural.id)).length,2);

    const uncertain = (await status(await sendResearch({...request,researchTaskId:randomUUID()}),200)).task as Document;
    const waiting = requirement(uncertain);
    await status(await accept({requestId:waiting.demand.requestId,afterSeq:waiting.event.seq,
      result:{status:"unknown",reason:"receipt_lost"}},uncertain.id),200);
    const uncertainResult = await after(uncertain.id,task=>task.status.state==="TASK_STATE_COMPLETED");
    assert.deepEqual(events(uncertainResult).at(-1)?.result?.observationResearchResult,{action:"unavailable",reason:"receipt_lost"});
    assert.deepEqual(events(uncertainResult).flatMap(event=>event.observationResearchConsumption?.status??[]),["unknown"]);

    async function withoutRead(question:string,evidence=request.evidence as typeof publicEvidence[]) {
      const task = (await status(await sendResearch({...request,researchTaskId:randomUUID(),question,evidence}),200)).task as Document;
      assert.equal(task.status.state,"TASK_STATE_COMPLETED");
      assert.equal(events(task).some(event=>event.skillDemand),false);
      assert.equal((await jobs(task.id)).length,1);
      return events(task).at(-1)?.result?.observationResearchResult;
    }
    assert.deepEqual(await withoutRead("刚才有多少条？",[publicEvidence]),{action:"answer",basedOn:"archive",evidence:publicEvidence});
    const emptyEvidence = {...publicEvidence,count:0,first:null,last:null};
    assert.deepEqual(await withoutRead("刚才有多少条？",[emptyEvidence]),
      {action:"answer",basedOn:"archive",evidence:emptyEvidence});
    assert.deepEqual(await withoutRead("归档记录是否符合摄氏度要求？",[publicEvidence]),
      {action:"answer",basedOn:"archive",evidence:publicEvidence,matches:false});
    assert.equal((await withoutRead("这个文件的数据怎么样？"))?.action,"clarify");
    const ambiguous = (await status(await sendResearch({...request,researchTaskId:randomUUID(),
      question:"这个文件的温度变量是哪个？",materials:[{...material,variables:["temperature_air","temperature_water"]}]}),200)).task as Document;
    assert.equal(ambiguous.status.state,"TASK_STATE_COMPLETED");
    assert.equal(events(ambiguous).at(-1)?.result?.observationResearchResult?.action,"clarify");
    assert.equal(events(ambiguous).some(event=>event.skillDemand),false);
    assert.equal((await jobs(ambiguous.id)).length,1);
    assert.deepEqual(await withoutRead("海水为什么是咸的？"),{action:"general"});
    assert.equal((await withoutRead("Fixture returns an unregistered variable"))?.action,"clarify");
    assert.deepEqual(await withoutRead("Fixture returns a malformed response"),{action:"unavailable",reason:"invalid_plan"});
    const failed = (await status(await sendResearch({...request,question:"Fixture returns a provider failure"}),200)).task as Document;
    assert.equal(events(failed).find(event=>event.observationResearchModel?.phase==="error")?.observationResearchModel?.executorFailure,
      "authentication");
    assert.deepEqual(events(failed).at(-1)?.result?.observationResearchResult,{action:"unavailable",reason:"planning_failed"});
    assert.doesNotMatch(JSON.stringify(failed),/fixture-private-text/);
  });
});
