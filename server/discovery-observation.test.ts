import assert from "node:assert/strict";
import {execFileSync, spawn} from "node:child_process";
import {randomBytes, randomUUID} from "node:crypto";
import {once} from "node:events";
import {mkdtempSync, rmSync} from "node:fs";
import {createServer} from "node:net";
import path from "node:path";
import test from "node:test";
import {setTimeout as delay} from "node:timers/promises";
import {Pool} from "pg";
import {
  observationCheckSkill, skillRequestKind, skillResultKind, type ObservationCheckResult, type SkillDemand,
} from "./observation-check-contract";

const pgBin = process.env.ONEEARTH_A2A_TEST_PG_BIN;
const headers = {"A2A-Version":"1.0","Content-Type":"application/a2a+json"};
const check = {skill:observationCheckSkill,artifactId:"fixture-observations",version:"v1",variable:"temperature",
  unit:"K",start:"2025-01-01",end:"2025-01-31"};
const result:ObservationCheckResult = {status:"verified",matches:true,evidence:{artifactId:check.artifactId,version:check.version,
  sha256:"a".repeat(64),variable:check.variable,unit:check.unit,count:2,first:check.start,last:check.end}};
type Event = {seq:number; taskId:string; skillDemand?:SkillDemand; result?:{observationCheckResult:ObservationCheckResult}};
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
      env:{PATH:"/usr/bin:/bin",ONEEARTH_DISCOVERY_PORT:String(address.port),ONEEARTH_STATE_DIR:dir,
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
});
