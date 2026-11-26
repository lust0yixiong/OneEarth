import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {Pool} from "pg";
import {postgresTaskStore} from "./postgres-task-store";
import {runtimeWebToolStore} from "./runtime-web-tool-store";

const fixture=process.env.ONEEARTH_WEB_TOOL_REPLAY_TEST_DATABASE_URL;
test("replay needs the original unbound web grant with live authority",
  {skip:!fixture&&"requires a disposable local runtime PostgreSQL database"},async t=>{
    const database=new URL(fixture!);
    assert.equal(database.hostname,"127.0.0.1");
    assert.match(database.pathname,/^\/oneearth_test_[a-z0-9_]+$/);
    const pool=new Pool({connectionString:database.href});
    assert.equal((await pool.query("SELECT to_regclass('runtime_tasks') AS tasks")).rows[0].tasks,null);
    const previous=process.env.ONEEARTH_RUNTIME_DATABASE_URL;
    process.env.ONEEARTH_RUNTIME_DATABASE_URL=database.href;
    t.after(()=>{if(previous===undefined)delete process.env.ONEEARTH_RUNTIME_DATABASE_URL;
      else process.env.ONEEARTH_RUNTIME_DATABASE_URL=previous;});
    const tasks=await postgresTaskStore("runtime");
    t.after(()=>tasks.close());
    let now=Date.now();
    const authority=await runtimeWebToolStore({pool,ttlMs:1000,now:()=>now});
    t.after(()=>authority.close());
    const researchTaskId=randomUUID();
    await tasks.submit(researchTaskId,{query:"isolated authority check"});
    assert.equal((await tasks.claim())?.id,researchTaskId);
    const messageId=randomUUID();
    const reserve=()=>authority.reserve({researchTaskId,messageId,kind:"discovery",allowSearch:true,
      allowFetch:false,deepseekSearch:false,deepseekFetch:false});
    const unbound=await reserve();
    assert.equal(await authority.canReplay(unbound,researchTaskId,messageId),true);
    assert.equal(await authority.canReplay(unbound,randomUUID(),messageId),false);
    assert.equal(await authority.canReplay(unbound,researchTaskId,randomUUID()),false);
    assert.equal(await authority.canReplay("invalid",researchTaskId,messageId),false);
    await authority.bind(unbound,randomUUID());
    assert.equal(await authority.canReplay(unbound,researchTaskId,messageId),false);
    const revoked=await reserve();
    await authority.revoke(revoked);
    assert.equal(await authority.canReplay(revoked,researchTaskId,messageId),false);
    const expires=await reserve();
    now+=1000;
    assert.equal(await authority.canReplay(expires,researchTaskId,messageId),false);
    const cancelled=await reserve();
    await tasks.finish(researchTaskId,"cancelled",{code:"cancelled"});
    assert.equal(await authority.canReplay(cancelled,researchTaskId,messageId),false);
  });
