import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import {setTimeout as delay} from "node:timers/promises";
import test, {type TestContext} from "node:test";
import express from "express";
import {openTaskStore, taskRoutes, workTasks, type TaskStore, type Payload} from "./task-store";
import {discoverThroughService, type DiscoveryInput, type DiscoveryEvent} from "./discovery-contract";
import {researchExecutor} from "./research-executor";
import {TaskCancelled} from "./task-cancellation";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return {promise, resolve};
}
async function until(check: () => boolean, timeout = 2500) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    assert.ok(Date.now() < deadline, "controlled task did not reach expected state");
    await delay(10);
  }
}
async function paused(signal: AbortSignal, gate: ReturnType<typeof deferred>) {
  signal.throwIfAborted();
  let abort!: () => void;
  try {
    await Promise.race([gate.promise, new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, {once:true});
    })]);
  } finally { signal.removeEventListener("abort", abort); }
}
const input = (): DiscoveryInput => ({
  query:"controlled cancellation fixture", config:{executor:"codex", model:""}, history:[], references:[],
  currentDatasets:[], scope:{} as DiscoveryInput["scope"],
});
const result = {plan:{questionMode:"preserve",dataQuestion:"controlled fixture"}, papers:[],haina:[],searches:[],sourceStatus:[],issues:[]};
type Executor = ReturnType<typeof researchExecutor>;
type Options = {
  middleware?: express.RequestHandler;
  workerStore?: (store: TaskStore) => TaskStore;
  child?: (id: string, body: DiscoveryInput) => boolean;
  run?: (executor: Executor, id: string, emit: (event: Payload | DiscoveryEvent) => void, signal: AbortSignal) => Promise<Payload>;
};

async function controlled(t: TestContext, options: Options = {}) {
  const parent = openTaskStore(":memory:"), child = openTaskStore(":memory:");
  const gate = deferred(), finished = deferred();
  const requests: {method: string; id: string; status?: number}[] = [];
  const discovery = express();
  discovery.use(express.json());
  discovery.use((req, res, next) => {
    const entry = {method:req.method, id:req.body?.id ?? req.path.split("/")[3], status:undefined as number | undefined};
    requests.push(entry);
    res.once("finish", () => {entry.status = res.statusCode;});
    next();
  });
  if (options.middleware) discovery.use(options.middleware);
  taskRoutes(discovery, "/v1/discoveries", child, () => undefined);
  const remote = discovery.listen(0, "127.0.0.1");
  await once(remote, "listening");
  const address = remote.address();
  assert.ok(address && typeof address !== "string");
  const previous = process.env.ONEEARTH_DISCOVERY_URL;
  process.env.ONEEARTH_DISCOVERY_URL = "http://127.0.0.1:" + address.port;
  const stopChild = await workTasks(child, async ({id, body}, signal, emit) => {
    emit({finding:{id,channel:"fixture",items:[{title:"already acquired material"}]}});
    if (options.child?.(id, body) !== true) await paused(signal, gate);
    return {result};
  });
  const runtime = express();
  runtime.use(express.json());
  taskRoutes(runtime, "/api/tasks", parent, () => undefined);
  const local = runtime.listen(0, "127.0.0.1");
  await once(local, "listening");
  const localAddress = local.address();
  assert.ok(localAddress && typeof localAddress !== "string");
  const origin = "http://127.0.0.1:" + localAddress.port;
  const stopParent = await workTasks(options.workerStore?.(parent) ?? parent, async ({id}, signal, emit) => {
    const executor = researchExecutor(input().config, undefined, signal);
    const publish = (event: Payload | DiscoveryEvent) => emit({...event});
    try {
      return options.run ? await options.run(executor, id, publish, signal) : {result:await executor.discover(id, input(), publish)};
    } finally { await executor.close(); finished.resolve(); }
  });
  t.after(async () => {
    stopParent(); stopChild(); gate.resolve();
    local.closeAllConnections(); remote.closeAllConnections();
    await Promise.all([new Promise<void>(done => local.close(() => done())), new Promise<void>(done => remote.close(() => done()))]);
    // Let the stopped workers drain their final persistence operations.
    await delay(20);
    parent.close(); child.close();
    if (previous === undefined) delete process.env.ONEEARTH_DISCOVERY_URL;
    else process.env.ONEEARTH_DISCOVERY_URL = previous;
  });
  const start = async (id = randomUUID()) => {
    assert.equal((await fetch(origin + "/api/tasks", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({id,input:{query:"fixture"}})})).status, 202);
    return id;
  };
  const cancel = (id: string) => fetch(origin + "/api/tasks/" + id, {method:"DELETE"});
  const deletes = () => requests.filter(r => r.method === "DELETE");
  return {parent, child, gate, finished, requests, origin, start, cancel, deletes, stopParent};
}

test("explicit parent DELETE cancels its active discovery once and preserves acquired events", async t => {
  const s = await controlled(t), id = await s.start();
  await until(() => s.parent.events(id, 0).some(e => e.finding));
  assert.equal((await s.cancel(id)).status, 204);
  assert.equal((await s.cancel(id)).status, 409);
  await s.finished.promise;
  await until(() => s.child.get(id)?.status === "cancelled");
  assert.equal(s.parent.get(id)?.status, "cancelled");
  assert.deepEqual(s.deletes().map(r => r.id), [id]);
  assert.equal(s.parent.events(id, 0).filter(e => e.code === "cancelled").length, 1);
  assert.ok(s.parent.events(id, 0).some(e => e.finding));
  assert.ok(s.child.events(id, 0).some(e => e.finding));
  s.gate.resolve();
  await delay(250);
  assert.equal(s.child.get(id)?.status, "cancelled");
  t.diagnostic(JSON.stringify({parent:id,parentStatus:s.parent.get(id)?.status,childStatus:s.child.get(id)?.status,
    requests:s.requests,retainedParentFindings:s.parent.events(id,0).filter(e=>e.finding).length,
    retainedChildFindings:s.child.events(id,0).filter(e=>e.finding).length}));
});

test("a lost submission response remains unconfirmed and never authorizes DELETE", async t => {
  const diagnostics: string[] = [];
  t.mock.method(console, "error", (message: string) => diagnostics.push(message));
  const s = await controlled(t, {middleware:(req, res, next) => {
    if (req.method === "POST") res.json = () => {res.destroy(); return res;};
    next();
  }, run:async (executor, id, emit, signal) => {
    await executor.discover(id, input(), emit).catch(() => {});
    emit({stage:"submission outcome uncertain"});
    await paused(signal, deferred());
    return {};
  }});
  const id = await s.start();
  await until(() => s.parent.events(id, 0).some(e => e.stage === "submission outcome uncertain"));
  assert.equal((await s.cancel(id)).status, 204);
  await s.finished.promise;
  await until(() => s.child.get(id)?.status === "running");
  assert.equal(s.deletes().length, 0);
  assert.deepEqual(diagnostics, ["OneEarth discovery cancellation unconfirmed: " + id + " (submission not acknowledged)"]);
  t.diagnostic(JSON.stringify({case:"lost202",parent:id,childStatus:s.child.get(id)?.status,requests:s.requests,diagnostics}));
});

test("a POST still being processed after cancellation is left unconfirmed without DELETE or resubmission", async t => {
  const diagnostics: string[] = [];
  t.mock.method(console, "error", (message: string) => diagnostics.push(message));
  const submitted = deferred(), insert = deferred();
  const s = await controlled(t, {middleware:(req, _res, next) => {
    if (req.method === "POST") {submitted.resolve(); void insert.promise.then(() => next());}
    else next();
  }});
  t.after(() => insert.resolve());
  const id = await s.start();
  await submitted.promise;
  assert.equal((await s.cancel(id)).status, 204);
  await s.finished.promise;
  assert.equal(s.deletes().length, 0);
  insert.resolve();
  await until(() => s.child.get(id)?.status === "running");
  assert.equal(s.deletes().length, 0);
  assert.equal(s.requests.filter(r => r.method === "POST").length, 1);
  assert.deepEqual(diagnostics, ["OneEarth discovery cancellation unconfirmed: " + id + " (submission not acknowledged)"]);
  t.diagnostic(JSON.stringify({case:"pendingPOST",parent:id,childStatus:s.child.get(id)?.status,requests:s.requests,diagnostics}));
});

test("supplemental cancellation leaves the completed initial discovery intact", async t => {
  const supplement = randomUUID();
  const s = await controlled(t, {
    child:(_id, body) => !body.continuation,
    run:async (executor, id, emit) => {
      await executor.discover(id, input(), emit);
      return {result:await executor.discover(supplement, {...input(), continuation:{previousId:id, focus:"missing field"}}, emit)};
    },
  });
  const id = await s.start();
  await until(() => s.child.get(supplement)?.status === "running");
  assert.equal(s.child.get(id)?.status, "complete");
  assert.equal((await s.cancel(id)).status, 204);
  await s.finished.promise;
  assert.equal(s.child.get(id)?.status, "complete");
  assert.equal(s.child.get(supplement)?.status, "cancelled");
  assert.deepEqual(s.deletes().map(r => r.id), [supplement]);
});

test("a child completing as DELETE arrives keeps its result and returns the existing 409", async t => {
  let complete: (id: string) => void = () => {};
  const s = await controlled(t, {middleware:(req, _res, next) => {
    if (req.method === "DELETE") complete(req.path.split("/")[3]);
    next();
  }});
  complete = id => {s.child.finish(id, "complete", {result});};
  const id = await s.start();
  await until(() => s.parent.events(id, 0).some(e => e.finding));
  assert.equal((await s.cancel(id)).status, 204);
  await s.finished.promise;
  assert.equal(s.child.get(id)?.status, "complete");
  assert.deepEqual(s.child.terminal(id), {result});
  assert.equal(s.deletes()[0].status, 409);
  assert.equal(s.parent.get(id)?.status, "cancelled");
});

test("a lost DELETE response is retried safely against the cancelled terminal state", async t => {
  let first = true;
  const s = await controlled(t, {middleware:(req, res, next) => {
    if (req.method === "DELETE" && first) {first = false; res.end = (() => {res.destroy(); return res;}) as typeof res.end;}
    next();
  }});
  const id = await s.start();
  await until(() => s.parent.events(id, 0).some(e => e.finding));
  assert.equal((await s.cancel(id)).status, 204);
  await s.finished.promise;
  assert.equal(s.child.get(id)?.status, "cancelled");
  assert.equal(s.deletes().length, 2);
  assert.equal(s.deletes()[1].status, 409);
  assert.equal(s.child.events(id, 0).filter(e => e.code === "cancelled").length, 1);
});

test("browser disconnection and idempotent resubmission do not cancel a live discovery", async t => {
  const s = await controlled(t), id = await s.start();
  const browser = new AbortController();
  const stream = await fetch(s.origin + "/api/tasks/" + id + "/events", {signal:browser.signal});
  await stream.body!.getReader().read();
  browser.abort();
  await until(() => s.parent.events(id, 0).some(e => e.finding));
  assert.equal((await fetch(s.origin + "/api/tasks", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({id,input:{query:"fixture"}})})).status, 202);
  assert.equal(s.child.get(id)?.status, "running");
  assert.equal(s.deletes().length, 0);
  s.gate.resolve();
  await s.finished.promise;
  await until(() => s.parent.get(id)?.status === "complete");
  assert.equal(s.requests.filter(r => r.method === "POST").length, 1);
});

for (const cause of ["worker-stop", "persistence-error", "store-read-error"] as const) {
  test(cause + " does not masquerade as user cancellation", async t => {
    let broken = false;
    const s = await controlled(t, {workerStore:store => ({...store,
      append:(id, event) => {if (broken && cause === "persistence-error") throw Error("injected persistence failure"); return store.append(id, event);},
      get:id => {if (broken && cause === "store-read-error") throw Error("injected store read failure"); return store.get(id);},
    }), run:async (executor, id, emit, signal) => {
      const active = executor.discover(id, input(), event => {
        emit(event);
        if (event.finding && cause === "persistence-error") {broken = true; emit({stage:"fail next append"});}
      });
      if (cause === "store-read-error") {await until(() => s.child.get(id)?.status === "running"); broken = true;}
      return {result:await active};
    }});
    const id = await s.start();
    if (cause === "worker-stop") {await until(() => s.parent.events(id, 0).some(e => e.finding)); s.stopParent();}
    await s.finished.promise;
    await until(() => s.parent.get(id)?.status === "failed");
    assert.equal(s.deletes().length, 0);
    assert.equal(s.child.get(id)?.status, "running");
    s.gate.resolve();
    await until(() => s.child.get(id)?.status === "complete");
  });
}

test("a cancellation before submission sends neither POST nor DELETE", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("cancelled turn must not submit work"));
  const controller = new AbortController();
  controller.abort(new TaskCancelled());
  await assert.rejects(discoverThroughService(randomUUID(), input(), controller.signal, () => {}), TaskCancelled);
});

test("an observed child failure is terminal and is not cancelled again", async t => {
  const s = await controlled(t, {run:async (executor, id, emit, signal) => {
    await executor.discover(id, input(), emit).catch(() => {});
    emit({stage:"child failure received"});
    await paused(signal, deferred());
    return {};
  }});
  const id = await s.start();
  await until(() => s.parent.events(id, 0).some(e => e.finding));
  s.child.finish(id, "failed", {error:"controlled channel failure"});
  await until(() => s.parent.events(id, 0).some(e => e.stage === "child failure received"));
  assert.equal((await s.cancel(id)).status, 204);
  await s.finished.promise;
  assert.equal(s.child.get(id)?.status, "failed");
  assert.equal(s.deletes().length, 0);
});

test("discovery event-stream reconnect does not cancel or resubmit the child", async t => {
  let dropped = false;
  const s = await controlled(t, {middleware:(req, res, next) => {
    if (req.method === "GET" && req.path.endsWith("/events") && !dropped) {
      dropped = true;
      setTimeout(() => res.destroy(), 25);
    }
    next();
  }});
  const id = await s.start();
  await until(() => s.requests.filter(r => r.method === "GET").length >= 2);
  await until(() => s.child.get(id)?.status === "running");
  assert.equal(s.deletes().length, 0);
  assert.equal(s.child.get(id)?.status, "running");
  s.gate.resolve();
  await s.finished.promise;
  await until(() => s.parent.get(id)?.status === "complete");
  assert.equal(s.requests.filter(r => r.method === "POST").length, 1);
});

test("a rejected ID never authorizes cancellation of another discovery", async t => {
  const foreign = randomUUID();
  const s = await controlled(t, {run:async (executor, _id, emit, signal) => {
    await assert.rejects(executor.discover(foreign, input(), emit), /HTTP 409/);
    emit({stage:"ID conflict rejected"});
    await paused(signal, deferred());
    return {};
  }});
  s.child.submit(foreign, {different:"belongs to an existing task"});
  const id = await s.start();
  await until(() => s.parent.events(id, 0).some(e => e.stage === "ID conflict rejected"));
  assert.equal((await s.cancel(id)).status, 204);
  await s.finished.promise;
  assert.equal(s.deletes().length, 0);
  assert.equal(s.child.get(foreign)?.status, "running");
});

test("a delayed rejection never cancels the existing discovery with the parent ID", async t => {
  const diagnostics: string[] = [];
  t.mock.method(console, "error", (message: string) => diagnostics.push(message));
  const rejected = deferred(), release = deferred();
  const s = await controlled(t, {middleware:(req, res, next) => {
    if (req.method === "POST") {
      const json = res.json.bind(res);
      res.json = body => {
        if (res.statusCode === 409) {rejected.resolve(); void release.promise.then(() => json(body)); return res;}
        return json(body);
      };
    }
    next();
  }});
  t.after(() => release.resolve());
  const id = randomUUID(), body = {query:"pre-existing discovery belongs to another request"};
  s.child.submit(id, body);
  await until(() => s.child.get(id)?.status === "running");
  await s.start(id);
  await rejected.promise;
  assert.equal((await s.cancel(id)).status, 204);
  await s.finished.promise;
  assert.equal(s.deletes().length, 0, "unacknowledged POST must not authorize DELETE");
  assert.equal(s.child.get(id)?.status, "running");
  assert.deepEqual(JSON.parse(s.child.get(id)!.body), body);
  assert.equal(s.child.events(id, 0).filter(e => e.code === "cancelled").length, 0);
  assert.deepEqual(diagnostics, ["OneEarth discovery cancellation unconfirmed: " + id + " (submission not acknowledged)"]);
  t.diagnostic(JSON.stringify({case:"delayed409",parent:id,parentStatus:s.parent.get(id)?.status,
    existingChildStatus:s.child.get(id)?.status,requests:s.requests,diagnostics}));
});

test("a lost rejection never cancels the existing discovery with the parent ID", async t => {
  const diagnostics: string[] = [];
  t.mock.method(console, "error", (message: string) => diagnostics.push(message));
  const s = await controlled(t, {middleware:(req, res, next) => {
    if (req.method === "POST") {
      const json = res.json.bind(res);
      res.json = body => {if (res.statusCode === 409) {res.destroy(); return res;} return json(body);};
    }
    next();
  }, run:async (executor, id, emit, signal) => {
    await executor.discover(id, input(), emit).catch(() => {});
    emit({stage:"submission has no acknowledgement"});
    await paused(signal, deferred());
    return {};
  }});
  const id = randomUUID(), body = {query:"another pre-existing discovery"};
  s.child.submit(id, body);
  await until(() => s.child.get(id)?.status === "running");
  await s.start(id);
  await until(() => s.parent.events(id, 0).some(e => e.stage === "submission has no acknowledgement"));
  assert.equal((await s.cancel(id)).status, 204);
  await s.finished.promise;
  assert.equal(s.deletes().length, 0, "lost 409 must not authorize DELETE");
  assert.equal(s.child.get(id)?.status, "running");
  assert.deepEqual(JSON.parse(s.child.get(id)!.body), body);
  assert.deepEqual(diagnostics, ["OneEarth discovery cancellation unconfirmed: " + id + " (submission not acknowledged)"]);
  t.diagnostic(JSON.stringify({case:"lost409",parent:id,parentStatus:s.parent.get(id)?.status,
    existingChildStatus:s.child.get(id)?.status,requests:s.requests,diagnostics}));
});

test("202 headers without a complete receipt do not authorize cancelling an accepted task", async t => {
  const accepted = deferred(), release = deferred(), diagnostics: string[] = [];
  t.mock.method(console, "error", (message: string) => diagnostics.push(message));
  const s = await controlled(t, {middleware:(req, res, next) => {
    if (req.method === "POST") {
      const json = res.json.bind(res);
      res.json = body => {
        res.type("application/json").flushHeaders(); accepted.resolve();
        void release.promise.then(() => {if (!res.destroyed) res.end(JSON.stringify(body));});
        return res;
      };
    }
    next();
  }});
  t.after(() => release.resolve());
  const id = await s.start();
  await accepted.promise;
  assert.equal((await s.cancel(id)).status, 204);
  await s.finished.promise;
  assert.equal(s.deletes().length, 0);
  assert.deepEqual(diagnostics, ["OneEarth discovery cancellation unconfirmed: " + id + " (submission not acknowledged)"]);
});

test("a receipt for a different ID is not ownership proof", async t => {
  const diagnostics: string[] = [];
  t.mock.method(console, "error", (message: string) => diagnostics.push(message));
  const s = await controlled(t, {middleware:(req, res, next) => {
    if (req.method === "POST") {
      const json = res.json.bind(res);
      res.json = body => json({...body,id:randomUUID()});
    }
    next();
  }, run:async (executor, id, emit, signal) => {
    await assert.rejects(executor.discover(id, input(), emit), /有效的任务受理确认/);
    emit({stage:"invalid receipt rejected"});
    await paused(signal, deferred());
    return {};
  }});
  const id = await s.start();
  await until(() => s.parent.events(id, 0).some(e => e.stage === "invalid receipt rejected"));
  assert.equal((await s.cancel(id)).status, 204);
  await s.finished.promise;
  assert.equal(s.deletes().length, 0);
  assert.deepEqual(diagnostics, ["OneEarth discovery cancellation unconfirmed: " + id + " (submission not acknowledged)"]);
});

test("an uncertain supplemental stream remains cancellable while the turn continues", async t => {
  const supplement = randomUUID();
  const s = await controlled(t, {middleware:(req, res, next) => {
    if (req.method === "GET" && req.path === "/v1/discoveries/" + supplement + "/events") res.destroy();
    else next();
  }, child:(_id, body) => !body.continuation,
  run:async (executor, id, emit, signal) => {
    await executor.discover(id, input(), emit);
    await executor.discover(supplement, {...input(),continuation:{previousId:id,focus:"additional field"}}, emit).catch(() => {});
    emit({stage:"continue with retained material"});
    await paused(signal, deferred());
    return {};
  }});
  const id = await s.start();
  await until(() => s.parent.events(id, 0).some(e => e.stage === "continue with retained material"));
  assert.equal((await s.cancel(id)).status, 204);
  await s.finished.promise;
  assert.equal(s.child.get(id)?.status, "complete");
  assert.equal(s.child.get(supplement)?.status, "cancelled");
  assert.deepEqual(s.deletes().map(r => r.id), [supplement]);
});

test("an unreachable cancellation is bounded and reported without erasing acquired material", async t => {
  const diagnostics: string[] = [];
  t.mock.method(console, "error", (message: string) => diagnostics.push(message));
  const s = await controlled(t, {middleware:(req, res, next) => {
    if (req.method === "DELETE") res.sendStatus(503);
    else next();
  }});
  const id = await s.start();
  await until(() => s.parent.events(id, 0).some(e => e.finding));
  const started = Date.now();
  assert.equal((await s.cancel(id)).status, 204);
  await s.finished.promise;
  assert.ok(Date.now() - started < 4500);
  assert.equal(s.parent.get(id)?.status, "cancelled");
  assert.equal(s.child.get(id)?.status, "running");
  assert.ok(s.parent.events(id, 0).some(e => e.finding));
  assert.deepEqual(diagnostics, ["OneEarth discovery cancellation unconfirmed: " + id + " (HTTP 503)"]);
  t.diagnostic(JSON.stringify({parent:id,parentStatus:s.parent.get(id)?.status,childStatus:s.child.get(id)?.status,
    requests:s.requests,diagnostics}));
});
