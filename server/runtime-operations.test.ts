import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {Pool} from "pg";
import {postgresTaskStore} from "./postgres-task-store";
import {runtimeTaskLease} from "./runtime-task-lease";
import type {OperationBinding,OperationStep,OperationWait} from "./runtime-operations";
import {TaskConflict} from "./task-store";

const database=process.env.ONEEARTH_OPERATION_TEST_DATABASE_URL;
test("one PostgreSQL operation queue serves browser, service, and human waits without losing ownership",{skip:!database,timeout:20000},async t=>{
  assert.ok(database);
  assert.match(new URL(database).pathname,/(?:^|_)test(?:_|$)/u);
  const prior=process.env.ONEEARTH_RUNTIME_DATABASE_URL;
  process.env.ONEEARTH_RUNTIME_DATABASE_URL=database;
  const first=await postgresTaskStore("runtime"),second=await postgresTaskStore("runtime"),audit=new Pool({connectionString:database});
  t.after(async()=>{
    await Promise.all([first.close(),second.close(),audit.end()]);
    if(prior===undefined)delete process.env.ONEEARTH_RUNTIME_DATABASE_URL;
    else process.env.ONEEARTH_RUNTIME_DATABASE_URL=prior;
  });
  const actions=first.operations,other=second.operations;
  const conversationId=randomUUID();
  const binding=():OperationBinding=>({conversationId,runId:randomUUID(),turnId:randomUUID()});
  const wait=(kind:OperationWait["kind"],owner?:string):OperationWait=>({stepId:randomUUID(),kind,request:{value:"fixture"},...(owner?{owner}:{})});
  const stepStates=(steps:OperationStep[])=>steps.map(step=>[step.ordinal,step.kind,step.state]);

  await t.test("browser receipt advances once, service dispatch uses the saved ID on takeover, and final projection is atomic",async()=>{
    const ordinaryRun=binding(),operationId=randomUUID(),browser=wait("browser","page-owner"),service=wait("service","catalogue");
    const initial={...ordinaryRun,operationId,kind:"fly-query-draw",input:{b:2,a:1},checkpoint:{after:"arrive"},wait:browser};
    assert.equal((await actions.create(initial)).currentStepId,browser.stepId);
    assert.deepEqual(await other.create({...initial,input:{a:1,b:2}}),await actions.read(operationId));
    await assert.rejects(other.create({...initial,wait:undefined}),TaskConflict);
    await assert.rejects(other.create({...initial,operationId:randomUUID()}),TaskConflict);
    assert.equal((await actions.readForRun(ordinaryRun.runId))?.operationId,operationId);
    assert.equal(await actions.wait(operationId,service,{}),undefined);
    assert.equal(await first.finish(operationId,"cancelled",{error:"Wrong public ID"}),false);
    await second.recoverInterrupted();
    assert.equal(await second.claim(),undefined);
    const arrive={operationId,stepId:browser.stepId,kind:"browser" as const,owner:browser.owner,receiptId:"one-arrival",
      payload:{coordinates:[1,2],status:"arrived"},checkpoint:{after:"lookup"}};
    assert.equal((await actions.receipt({...arrive,owner:"another-page"})).status,"missing");
    const receipts=await Promise.all([actions.receipt(arrive),other.receipt({...arrive,payload:{status:"arrived",coordinates:[1,2]}})]);
    assert.deepEqual(receipts.map(item=>item.status).sort(),["accepted","duplicate"]);
    assert.equal((await other.receipt({...arrive,checkpoint:{after:"skip"}})).status,"conflict");
    assert.equal((await other.receipt({...arrive,payload:{coordinates:[2,1],status:"arrived"}})).status,"conflict");
    const worker1=await first.claim();
    assert.equal(worker1?.id,operationId);assert.ok(worker1.lease);
    assert.deepEqual(worker1.body,{type:"workspace-operation",...ordinaryRun,operationId,kind:initial.kind,input:initial.input});
    assert.deepEqual(worker1.checkpoint,{after:"lookup"});
    const asFirst=<T>(work:()=>T)=>runtimeTaskLease.run(worker1.lease,work);
    assert.equal(await first.saveStep!(operationId,{after:"unauthorized"}),false);
    assert.equal(await asFirst(()=>first.clearStep!(operationId)),false);
    assert.equal((await asFirst(()=>actions.wait(operationId,browser,{after:"stale"})))?.state,"received");
    assert.deepEqual(await first.step?.(operationId),{after:"lookup"});
    assert.equal((await asFirst(()=>actions.wait(operationId,service,{after:"remote-lookup"},{releaseLease:false})))?.state,"waiting");
    await assert.rejects(asFirst(()=>actions.wait(operationId,wait("browser"),{})),TaskConflict);
    assert.equal(await asFirst(()=>actions.complete(operationId,{})),false);
    const dispatch=await asFirst(()=>actions.prepareDispatch(operationId,service.stepId));
    assert.ok(dispatch?.requestId);assert.equal(dispatch.first,true);
    assert.equal((await other.readStep(operationId,service.stepId))?.requestId,dispatch.requestId);
    await audit.query("UPDATE runtime_tasks SET lease_until=0 WHERE id=$1",[operationId]);
    await second.recoverInterrupted();
    const worker2=await second.claim();
    assert.equal(worker2?.id,operationId);assert.ok(worker2.lease);
    assert.ok(worker2.lease.fence>worker1.lease.fence);
    const asSecond=<T>(work:()=>T)=>runtimeTaskLease.run(worker2.lease,work);
    assert.deepEqual(await asSecond(()=>other.prepareDispatch(operationId,service.stepId)),{requestId:dispatch.requestId,first:false});
    const serviceReceipt={operationId,stepId:service.stepId,kind:"service" as const,owner:service.owner,
      requestId:dispatch.requestId,receiptId:"catalogue-42",payload:{result:"catalogue"}};
    assert.equal((await asFirst(()=>actions.receipt(serviceReceipt))).status,"conflict");
    assert.equal((await other.receipt({...serviceReceipt,requestId:randomUUID()})).status,"missing");
    assert.equal(await asSecond(()=>other.reschedule(operationId,service.stepId,Date.now())),true);
    const worker3=await first.claim();
    assert.equal(worker3?.id,operationId);assert.ok(worker3.lease);
    const asThird=<T>(work:()=>T)=>runtimeTaskLease.run(worker3.lease,work);
    assert.deepEqual(await asThird(()=>actions.prepareDispatch(operationId,service.stepId)),{requestId:dispatch.requestId,first:false});
    assert.equal((await asThird(()=>actions.receipt(serviceReceipt))).status,"accepted");
    const result={reply:"original result"};
    await assert.rejects(asThird(()=>actions.transaction(db=>actions.completeInTransaction(db,operationId,result,async()=>{
      throw Error("projection failed");
    }))),/projection failed/u);
    assert.equal((await other.read(operationId))?.status,"running");
    assert.equal((await other.read(operationId))?.result,undefined);
    assert.equal(await asThird(()=>actions.transaction(db=>actions.completeInTransaction(db,operationId,result,async(tx,final)=>{
      assert.equal(final.status,"complete");assert.deepEqual(final.result,result);
      assert.equal((await actions.readInTransaction(tx,operationId))?.status,"complete");
      assert.deepEqual(stepStates(await actions.stepsInTransaction(tx,operationId)),[[1,"browser","received"],[2,"service","received"]]);
    }))),true);
    assert.deepEqual((await other.readForRun(ordinaryRun.runId))?.result,result);
    assert.equal(await other.cancel(operationId),false);
    assert.equal(await second.terminal(operationId),undefined);
    assert.deepEqual(await second.events(operationId,0),[]);
    assert.deepEqual(await second.chat.agUiEvents(operationId),[]);
  });

  await t.test("cancel wins without requeue; late and expired observations stay on their original steps",async()=>{
    const operationId=randomUUID(),browser=wait("browser","original-window");
    await actions.transaction(async db=>{
      await actions.createInTransaction(db,{operationId,conversationId,kind:"window-action",input:{}});
      await actions.waitInTransaction(db,operationId,browser,{after:"browser"});
    });
    const receipt={operationId,stepId:browser.stepId,kind:browser.kind,owner:browser.owner,receiptId:"late-1",payload:{rendered:true}};
    let reached!:()=>void,release!:()=>void;
    const locked=new Promise<void>(done=>{reached=done;}),unblock=new Promise<void>(done=>{release=done;});
    const cancelled=actions.transaction(async db=>{
      assert.equal(await actions.cancelInTransaction(db,operationId,{stopped:true}),true);
      reached();await unblock;
    });
    await locked;
    const late=other.receipt(receipt);
    release();await cancelled;
    assert.equal((await late).status,"late");
    assert.equal((await other.receipt(receipt)).status,"duplicate");
    assert.equal((await other.receipt({...receipt,payload:{rendered:false}})).status,"conflict");
    assert.equal((await actions.read(operationId))?.runId,undefined);
    assert.equal((await actions.readStep(operationId,browser.stepId))?.state,"cancelled");
    assert.equal((await actions.readStep(operationId,browser.stepId))?.receipt?.late,true);
    assert.deepEqual((await actions.read(operationId))?.result,{stopped:true});
    await first.recoverInterrupted();assert.equal(await first.claim(),undefined);

    const expiring=randomUUID(),expired={...wait("browser"),expiresAt:Date.now()-1};
    await actions.create({operationId:expiring,conversationId,kind:"window-action",input:{},wait:expired});
    const claim=await first.claim();assert.equal(claim?.id,expiring);assert.ok(claim.lease);
    await runtimeTaskLease.run(claim.lease,async()=>{
      assert.equal((await actions.expire(expiring,expired.stepId))?.state,"expired");
      assert.equal(await actions.complete(expiring,{outcome:"no-arrival"}),true);
    });
    assert.equal((await other.receipt({...receipt,operationId:expiring,stepId:expired.stepId,owner:undefined})).status,"late");
    assert.deepEqual((await other.read(expiring))?.result,{outcome:"no-arrival"});
  });

  await t.test("human response links a new native run in the same transaction and cannot adopt an old or competing answer",async()=>{
    const origin=binding(),resumed=binding(),rival=binding(),operationId=randomUUID(),firstWait=wait("human"),secondWait=wait("human");
    await first.chat.admit(origin.runId,{conversationId,turnId:origin.turnId},8);
    await first.chat.admit(resumed.runId,{conversationId,turnId:resumed.turnId},8);
    await actions.create({...origin,operationId,kind:"research",input:{finding:"source"},wait:firstWait});
    const answer={operationId,stepId:firstWait.stepId,kind:"human" as const,receiptId:"confirmed",payload:{answer:"yes"},checkpoint:{answered:true}};
    await assert.rejects(actions.transaction(async db=>{
      assert.equal((await actions.receiptInTransaction(db,answer,{resumeRun:resumed,wake:false})).status,"accepted");
      throw Error("native admission rejected");
    }),/native admission rejected/u);
    assert.equal(await other.readForRun(resumed.runId),undefined);
    assert.equal((await other.readStep(operationId,firstWait.stepId))?.state,"waiting");
    assert.equal((await other.receipt(answer,{resumeRun:resumed,wake:false})).status,"accepted");
    assert.equal((await actions.receipt(answer,{resumeRun:rival,wake:false})).status,"conflict");
    assert.deepEqual(await actions.readForRun(origin.runId),await actions.readForRun(resumed.runId));
    assert.equal((await actions.read(operationId))?.activeRunId,resumed.runId);
    assert.deepEqual((await actions.read(operationId))?.checkpoint,{answered:true});
    assert.equal(await actions.readForRun(rival.runId),undefined);
    await first.recoverInterrupted();assert.equal(await first.claim(),undefined);
    assert.equal(await actions.transaction(db=>actions.waitInTransaction(db,operationId,secondWait,{}, {runId:origin.runId})),undefined);
    assert.equal((await actions.transaction(db=>actions.waitInTransaction(db,operationId,secondWait,{}, {runId:resumed.runId})))?.state,"waiting");
    await assert.rejects(actions.receipt({...answer,stepId:secondWait.stepId},{resumeRun:origin,wake:false}),TaskConflict);
    assert.equal((await actions.readStep(operationId,secondWait.stepId))?.state,"waiting");
    assert.equal(await actions.transaction(db=>actions.cancelForRunInTransaction(db,origin.runId)),false);
    assert.equal(await actions.transaction(db=>actions.cancelForRunInTransaction(db,resumed.runId)),true);
    assert.deepEqual(stepStates(await other.steps(operationId)),[[1,"human","received"],[2,"human","cancelled"]]);
  });

  await t.test("queued native cancellation can close its operation only in the transaction that wrote the original terminal",async()=>{
    const origin=binding(),resumed=binding(),operationId=randomUUID(),human=wait("human");
    await actions.create({...origin,operationId,kind:"research",input:{},wait:human});
    assert.equal((await actions.receipt({operationId,stepId:human.stepId,kind:"human",receiptId:"answer",payload:{answer:"confirmed"}},
      {resumeRun:resumed,wake:false})).status,"accepted");
    await first.submit(resumed.runId,{conversationId,turnId:resumed.turnId});
    const result={runId:resumed.runId};
    assert.equal(await actions.transaction(db=>actions.completeFromRunInTransaction(db,operationId,resumed.runId,result,"cancelled")),false);
    await assert.rejects(actions.transaction(async db=>{
      await db.query("UPDATE runtime_tasks SET status='cancelled' WHERE id=$1",[resumed.runId]);
      assert.equal(await actions.completeFromRunInTransaction(db,operationId,resumed.runId,result,"cancelled"),true);
      throw Error("original cancellation rolled back");
    }),/original cancellation rolled back/u);
    assert.equal((await other.read(operationId))?.status,"running");
    assert.equal((await second.get(resumed.runId))?.status,"queued");
    await actions.transaction(async db=>{
      await db.query("UPDATE runtime_tasks SET status='cancelled' WHERE id=$1",[resumed.runId]);
      assert.equal(await actions.completeFromRunInTransaction(db,operationId,resumed.runId,result,"cancelled"),true);
    });
    assert.equal(await actions.transaction(db=>actions.completeFromRunInTransaction(db,operationId,resumed.runId,{changed:true},"cancelled")),false);
    assert.deepEqual((await other.read(operationId))?.result,result);
  });
});
