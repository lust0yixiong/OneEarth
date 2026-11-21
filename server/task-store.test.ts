import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { openTaskStore, TaskConflict } from "./task-store";

test("a browser reconnect replays ordered findings and does not enqueue a second task", () => {
  const dir=mkdtempSync(path.join(tmpdir(),"oneearth-store-test-"));
  const file=path.join(dir,"tasks.sqlite");
  const api=openTaskStore(file);
  const worker=openTaskStore(file);
  try {
    const id=randomUUID(),body={query:"已有数据？"};
    api.submit(id,body);
    assert.equal(worker.claim()?.id,id);
    worker.append(id,{finding:{title:"first result"}});
    const cursor=api.events(id,0).at(-1)!.seq;
    assert.equal(api.submit(id,body).status,"running");
    assert.throws(()=>api.submit(id,{query:"different"}),TaskConflict);
    assert.equal(worker.claim(),undefined);
    worker.append(id,{channel:"web",status:"failed"});
    worker.finish(id,"complete",{result:{kept:"first result"}});
    assert.deepEqual(api.events(id,cursor).map(event=>event.status ?? event.result.kept),["failed","first result"]);
    assert.deepEqual(api.terminal(id),{result:{kept:"first result"}});
  } finally {api.close();worker.close();rmSync(dir,{recursive:true,force:true});}
});

test("worker interruption keeps previous events and refuses to repeat uncertain upstream calls", () => {
  const dir=mkdtempSync(path.join(tmpdir(),"oneearth-store-test-"));
  const store=openTaskStore(path.join(dir,"tasks.sqlite"));
  try {
    const id=randomUUID();
    store.submit(id,{query:"样例"});
    store.claim();
    store.append(id,{finding:{title:"persisted"}});
    store.recoverInterrupted();
    assert.equal(store.get(id)?.status,"failed");
    const events=store.events(id,0);
    assert.equal(events.at(-2)?.finding.title,"persisted");
    assert.equal(events.at(-1)?.code,"worker_interrupted");
    assert.equal(store.claim(),undefined);
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
