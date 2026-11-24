import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import test from "node:test";
import {setTimeout as delay} from "node:timers/promises";
import express from "express";
import {postgresTaskStore} from "./postgres-task-store";
import {productDatabase} from "./product-database";
import {runtimeChatChannel, type ChatPreparation} from "./runtime-chat-channel";
import {taskRoutes, workTasks, type Payload} from "./task-store";

const fixture = process.env.ONEEARTH_CHAT_TEST_DATABASE_URL;
function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>(ready => { resolve = ready; });
  return {promise, resolve};
}

test("Chat receipt and research handoff retain identity while the existing worker is busy", {skip: !fixture, timeout: 15000}, async t => {
  assert.ok(fixture);
  assert.match(new URL(fixture).pathname, /(?:^|[-_])test(?:[-_]|$)/);
  const old = process.env.ONEEARTH_RUNTIME_DATABASE_URL;
  process.env.ONEEARTH_RUNTIME_DATABASE_URL = fixture;
  const tasks = await postgresTaskStore("runtime");
  const audit = productDatabase("RUNTIME");
  const app = express();
  app.use(express.json());
  const entered = latch();
  const release = latch();
  const seen = new Map<string, number>();
  const resumed: string[] = [];
  const pending = latch();
  const chat = await runtimeChatChannel(app, tasks, async (_id, raw): Promise<ChatPreparation> => ({
    kind: "foreground",
    async run(id, signal, emit) {
      seen.set(id, (seen.get(id) ?? 0) + 1);
      const {query} = raw as {query: string};
      emit({stage: "plan"});
      if (query === "cancel before handoff") {
        pending.resolve();
        await delay(5000, undefined, {signal});
      }
      if (query !== "show next city") return {kind: "research", handoff: {query}};
      return {kind: "reply", payload: {result: {message: "next city", camera: {center: [116.4, 39.9], zoom: 165}}}};
    },
  }));
  taskRoutes(app, "/api/tasks", tasks, () => undefined, {researchRecords: true, onCancelled: id => chat.cancel(id)});
  const stop = await workTasks(tasks, async task => {
    resumed.push(task.id);
    assert.deepEqual(await tasks.chat.handoff(task.id), {query: "long research"});
    await tasks.append(task.id, {discoveryBinding: {discoveryId: "controlled-discovery", messageId: task.id, state: "TASK_STATE_WORKING"}});
    entered.resolve();
    await release.promise;
    await tasks.append(task.id, {discoveryBinding: {discoveryId: "controlled-discovery", messageId: task.id, state: "TASK_STATE_COMPLETED"}});
    return {result: {message: "original research"}};
  });
  const server = app.listen(0, "127.0.0.1");
  t.after(async () => {
    release.resolve();
    await stop();
    await chat.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await audit.end();
    await tasks.close();
    if (old === undefined) delete process.env.ONEEARTH_RUNTIME_DATABASE_URL;
    else process.env.ONEEARTH_RUNTIME_DATABASE_URL = old;
  });
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = "http://127.0.0.1:" + address.port;
  const conversationId = randomUUID();
  const input = (query: string) => ({query, conversationId, turnId: randomUUID()});
  const submit = (id: string, value: ReturnType<typeof input>, route = "/api/chat/messages") =>
    fetch(base + route, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({id, input: value})});
  const research = randomUUID(), city = randomUUID(), cancelled = randomUUID(), interrupted = randomUUID();
  const researchInput = input("long research");
  const cityInput = input("show next city");
  const task = (id: string) => base + "/api/tasks/" + id;
  async function until(check: () => Promise<boolean>) {
    for (let n = 0; n < 100; n++) {
      if (await check()) return;
      await delay(20);
    }
    assert.fail("message did not reach the expected state");
  }

  assert.equal((await submit(research, researchInput)).status, 202);
  await entered.promise;
  assert.equal((await tasks.get(research))?.status, "running");
  assert.deepEqual(await tasks.researchExecution?.(research), {
    status: "running",
    bindings: [{taskId: "controlled-discovery", messageId: research, state: "TASK_STATE_WORKING", operation: "discover"}],
  });
  const acknowledgements = await Promise.all([submit(city, cityInput), submit(city, cityInput)]);
  assert.deepEqual(acknowledgements.map(response => response.status), [202, 202]);
  await until(async () => (await tasks.get(city))?.status === "complete");
  assert.equal((await tasks.get(research))?.status, "running");
  assert.equal((await audit.query("SELECT id FROM runtime_tasks WHERE id=$1", [city])).rowCount, 0);
  assert.equal(seen.get(city), 1);
  assert.deepEqual(resumed, [research]);
  assert.equal((await submit(city, input("different"))).status, 409);
  assert.equal((await submit(city, cityInput, "/api/tasks")).status, 202);
  assert.equal((await audit.query("SELECT id FROM runtime_tasks WHERE id=$1", [city])).rowCount, 0);
  const cityRecord = await (await fetch(task(city) + "/record")).json();
  assert.equal(cityRecord.conversationId, conversationId);
  assert.equal(cityRecord.turnId, cityInput.turnId);
  assert.equal(cityRecord.result.message, "next city");
  assert.deepEqual(cityRecord.result.workspaceEffect, {effectId: "workspace:" + city, state: "proposed", fields: ["camera"]});
  assert.equal(cityRecord.workspaceReceipt, undefined);
  assert.equal(await tasks.researchExecution?.(city), undefined);
  assert.equal(await tasks.chat.latestCompleted(conversationId), city);
  const firstEvents = await tasks.events(city, 0);
  assert.equal(firstEvents[0].chatPhase, "foreground");
  const cursor = firstEvents[0].seq;
  const tail: Payload[] = (await (await fetch(task(city) + "/events?after=" + cursor)).text()).trim().split("\n").map(line => JSON.parse(line));
  assert.ok(tail.every(event => Number(event.seq) > Number(cursor)));
  assert.deepEqual(tail.at(-1)?.result, cityRecord.result);

  const effect = {effectId: "workspace:" + city, conversationId, turnId: cityInput.turnId, state: "applied"};
  const acknowledge = (body: typeof effect, id = city) => fetch(base + "/api/chat/messages/" + id + "/workspace-receipt", {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body),
  });
  assert.equal((await acknowledge({...effect, conversationId: randomUUID()})).status, 404);
  assert.equal((await acknowledge({...effect, turnId: randomUUID()})).status, 404);
  assert.equal((await acknowledge({...effect, effectId: "workspace:" + randomUUID()})).status, 404);
  assert.equal((await acknowledge({...effect, effectId: "workspace:" + research}, research)).status, 404);
  const browserReports = await Promise.all([acknowledge(effect), acknowledge(effect)]);
  assert.deepEqual(browserReports.map(response => response.status), [200, 200]);
  const [receipt, duplicate] = await Promise.all(browserReports.map(response => response.json()));
  assert.deepEqual(receipt, {...effect, taskId: city, reportedAt: receipt.reportedAt});
  assert.ok(Number.isSafeInteger(receipt.reportedAt));
  assert.deepEqual(duplicate, receipt);
  assert.equal((await acknowledge({...effect, state: "stale"})).status, 409);
  assert.deepEqual(await tasks.workspaceReceipt?.(city), receipt);
  const recorded = await (await fetch(task(city) + "/record")).json();
  assert.deepEqual(recorded, {...cityRecord, workspaceReceipt: receipt});
  assert.deepEqual(await tasks.events(city, 0), firstEvents);

  assert.equal((await submit(cancelled, input("cancel before handoff"))).status, 202);
  await pending.promise;
  assert.equal((await fetch(task(cancelled), {method: "DELETE"})).status, 204);
  assert.equal(await tasks.chat.promote(cancelled, {query: "late"}), false);
  assert.equal((await tasks.get(cancelled))?.status, "cancelled");
  assert.equal((await audit.query("SELECT id FROM runtime_tasks WHERE id=$1", [cancelled])).rowCount, 0);
  release.resolve();
  await until(async () => (await tasks.get(research))?.status === "complete");
  assert.deepEqual(await tasks.researchExecution?.(research), {
    status: "complete",
    bindings: [{taskId: "controlled-discovery", messageId: research, state: "TASK_STATE_COMPLETED", operation: "discover"}],
  });
  assert.equal(await tasks.chat.latestCompleted(conversationId), city);
  assert.equal(seen.get(research), 1);
  const events = await tasks.events(research, 0);
  assert.deepEqual(events.filter(event => event.chatPhase).map(event => event.chatPhase), ["foreground", "research"]);
  assert.equal(events.filter(event => event.started).length, 1);
  assert.deepEqual(events.at(-1)?.result, {message: "original research"});

  // Two different IDs cannot both claim one immutable parent. Delivery retries keep the original ID.
  const replyIds = [randomUUID(), randomUUID()];
  const reply = {...input("show next city"), clarificationAnswer: {parentTaskId: city, text: "show next city"}};
  const replies = await Promise.all(replyIds.map(id => submit(id, reply)));
  assert.deepEqual(replies.map(response => response.status).sort(), [202, 409]);
  const winner = replyIds[replies.findIndex(response => response.status === 202)];
  await until(async () => (await tasks.get(winner))?.status === "complete");
  assert.equal((await submit(winner, reply)).status, 202);
  assert.equal((await submit(winner, {...reply, query: "different"})).status, 409);
  assert.deepEqual((await audit.query("SELECT answer_id FROM runtime_clarification_answers WHERE parent_task_id=$1", [city])).rows,
    [{answer_id: winner}]);
  assert.equal(seen.get(winner), 1);

  await stop();
  const researchReplies = [randomUUID(), randomUUID()];
  const researchReply = {...input("original clarification"), clarificationReply: {parentTaskId: research}};
  const claims = await Promise.allSettled(researchReplies.map(id=>tasks.submit(id, researchReply)));
  assert.deepEqual(claims.map(claim=>claim.status).sort(),["fulfilled","rejected"]);
  const acceptedReply = researchReplies[claims.findIndex(claim=>claim.status==="fulfilled")];
  assert.deepEqual((await audit.query("SELECT answer_id FROM runtime_clarification_answers WHERE parent_task_id=$1", [research])).rows,
    [{answer_id:acceptedReply}]);
  assert.equal((await audit.query("SELECT id FROM runtime_tasks WHERE id=ANY($1)",[researchReplies])).rowCount,1);
  assert.equal((await tasks.submit(acceptedReply, researchReply)).id,acceptedReply);
  await tasks.finish(acceptedReply,"cancelled",{error:"controlled test completed"});

  await chat.close();
  await tasks.chat.admit(interrupted, input("interrupted"), 4);
  tasks.chat.release();
  await tasks.chat.acquire();
  assert.equal((await tasks.get(interrupted))?.status, "failed");
  assert.equal((await tasks.terminal(interrupted))?.code, "chat_interrupted");
  assert.equal((await tasks.get(city))?.status, "complete");
  assert.deepEqual(await tasks.workspaceReceipt?.(city), receipt);
});
