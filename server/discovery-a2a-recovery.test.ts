import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import test from "node:test";
import express from "express";
import {Pool} from "pg";
import {discoveryA2aRouter} from "./discovery-a2a-server";
import {discoveryA2aStore} from "./discovery-a2a-store";
import {discoveryDelegationLookupPath,discoveryRequestFingerprint} from "./discovery-request-fingerprint";
import {postgresTaskStore} from "./postgres-task-store";
import type {DiscoveryInput} from "./discovery-contract";

const fixture = process.env.ONEEARTH_A2A_RECOVERY_TEST_DATABASE_URL;
test("discovery recovery only reads accepted jobs with their exact message fingerprint",
  {skip:!fixture&&"requires a disposable local discovery PostgreSQL database"}, async t => {
    const url = new URL(fixture!);
    assert.equal(url.hostname,"127.0.0.1");
    assert.match(url.pathname,/^\/oneearth_test_[a-z0-9_]+$/);
    const pool = new Pool({connectionString:url.href});
    t.after(()=>pool.end());
    assert.equal((await pool.query("SELECT to_regclass('discovery_tasks') AS tasks")).rows[0].tasks,null);
    const oldDatabase = process.env.ONEEARTH_DISCOVERY_DATABASE_URL;
    const oldToken = process.env.ONEEARTH_DISCOVERY_RECOVERY_TOKEN;
    const token = randomUUID()+randomUUID();
    process.env.ONEEARTH_DISCOVERY_DATABASE_URL = url.href;
    process.env.ONEEARTH_DISCOVERY_RECOVERY_TOKEN = token;
    t.after(()=>{
      if (oldDatabase===undefined) delete process.env.ONEEARTH_DISCOVERY_DATABASE_URL;
      else process.env.ONEEARTH_DISCOVERY_DATABASE_URL=oldDatabase;
      if (oldToken===undefined) delete process.env.ONEEARTH_DISCOVERY_RECOVERY_TOKEN;
      else process.env.ONEEARTH_DISCOVERY_RECOVERY_TOKEN=oldToken;
    });
    const tasks = await postgresTaskStore("discovery");
    t.after(()=>tasks.close());
    const delegations = await discoveryA2aStore(pool);
    const app = express();
    app.use(discoveryA2aRouter(delegations,async input=>({body:input as unknown as DiscoveryInput})));
    const server = app.listen(0,"127.0.0.1");
    await once(server,"listening");
    t.after(async ()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
    const address = server.address();
    assert.ok(address&&typeof address!=="string");
    const origin = "http://127.0.0.1:"+address.port;
    const messageId = randomUUID();
    const kind = "oneearth.discovery.request.v1";
    const input = {query:"固定隔离资料",history:[],references:[]};
    const digest = discoveryRequestFingerprint(kind,input);
    const lookup = (id:string, extra:Record<string,string> = {}) => fetch(
      origin+discoveryDelegationLookupPath+"/"+encodeURIComponent(id),{
        signal:AbortSignal.timeout(3000),
        headers:{Authorization:"Bearer "+token,"X-OneEarth-Request-Fingerprint":digest,...extra},
      });
    const missing = await lookup(messageId);
    assert.equal(missing.status,404);
    assert.deepEqual(await missing.json(),{code:"DELEGATION_NOT_FOUND",idempotentReplay:true});
    const submit = () => fetch(origin+"/message:send",{
      method:"POST",headers:{"Content-Type":"application/a2a+json","A2A-Version":"1.0"},
      body:JSON.stringify({message:{role:"ROLE_USER",messageId,parts:[{data:{kind,input}}]},
        configuration:{returnImmediately:true}}),
      signal:AbortSignal.timeout(3000),
    });
    const accepted = await submit();
    assert.equal(accepted.status,200);
    const {task:{id}} = await accepted.json();
    assert.notEqual(id,messageId);
    assert.equal((await lookup(messageId,{Authorization:"Bearer incorrect"})).status,403);
    assert.equal((await lookup(messageId,{"Sec-Fetch-Site":"same-origin"})).status,404);
    assert.equal((await lookup(messageId,{"X-OneEarth-Request-Fingerprint":"a".repeat(64)})).status,409);
    const recovered = await lookup(messageId);
    assert.equal(recovered.status,200);
    assert.deepEqual(await recovered.json(),{taskId:id,idempotentReplay:true});
    assert.equal((await (await submit()).json()).task.id,id);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM discovery_a2a_delegations")).rows[0].count,1);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM discovery_tasks")).rows[0].count,1);
  });
