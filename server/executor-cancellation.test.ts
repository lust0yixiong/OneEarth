import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {createModelExecutor} from "./executor";
import {ExecutorFailure} from "./executor-failure";

const model = {executor:"codex",model:"gpt-6-luna"} as const;

function isAlive(pid:number) {
  try {
    process.kill(pid,0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code==="ESRCH")return false;
    throw error;
  }
}

async function waitFor<T>(check:()=>Promise<T|undefined>,milliseconds:number) {
  const stop = Date.now()+milliseconds;
  do {
    const value = await check();
    if (value!==undefined)return value;
    await delay(15);
  } while (Date.now()<stop);
  throw Error("The controlled CLI did not reach the expected state.");
}

test("a cancelled CLI releases held pipes only after its process exits", {timeout:30_000}, async t=>{
  const directory = await mkdtemp(path.join(tmpdir(),"oneearth-executor-cancellation-"));
  const priorPath = process.env.PATH;
  process.env.PATH = directory+path.delimiter+(priorPath??"");
  t.after(async()=>{
    if(priorPath===undefined)delete process.env.PATH;
    else process.env.PATH=priorPath;
    await rm(directory,{recursive:true,force:true});
  });
  const run = createModelExecutor(()=>{});
  for(const order of ["abort-first","exit-first","normal-output"] as const)await t.test(order,async subtest=>{
    const ready = path.join(directory,order+".json");
    const grandchild = order==="normal-output"
      ? 'setTimeout(() => process.stdout.write("second"), 350)'
      : 'setTimeout(() => {}, 6000)';
    await writeFile(path.join(directory,"codex"),`#!/usr/bin/env node
const fs = require("node:fs");
const {spawn} = require("node:child_process");
process.stdin.resume();
process.stdin.once("end",()=>{
  const child=spawn(process.execPath,["-e",${JSON.stringify(grandchild)}],{stdio:["ignore",process.stdout,process.stderr]});
  child.unref();
  fs.writeFileSync(${JSON.stringify(ready)},JSON.stringify({pid:process.pid,pipeHolder:child.pid}));
  if(${JSON.stringify(order)}==="abort-first")setInterval(()=>{},1000);
  else {process.stdout.write("first\\n");process.exit(0);}
});
`,{mode:0o700});
    const controller = new AbortController();
    subtest.after(()=>controller.abort());
    let settled = false;
    const result = run(model,"Controlled cancellation test.",controller.signal).then(
      text=>{settled=true;return {text};},
      error=>{settled=true;return {error};},
    );
    const child = await waitFor(async()=>{
      try {return JSON.parse(await readFile(ready,"utf8")) as {pid:number;pipeHolder:number};}
      catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT" && !(error instanceof SyntaxError))throw error;}
    },4500);
    subtest.after(()=>{if(isAlive(child.pipeHolder))process.kill(child.pipeHolder,"SIGKILL");});

    if(order==="normal-output"){
      assert.deepEqual(await result,{text:"first\nsecond"});
      return;
    }
    if(order==="abort-first")assert.equal(isAlive(child.pid),true);
    else {
      await waitFor(async()=>isAlive(child.pid)?undefined:true,3000);
      assert.equal(settled,false,"Normal settlement still waits for inherited output");
    }
    controller.abort();
    const outcome = await waitFor(async()=>settled?result:undefined,1600);
    assert.ok("error" in outcome && outcome.error instanceof ExecutorFailure);
    assert.equal(outcome.error.diagnostic.kind,"aborted");
    assert.equal(isAlive(child.pid),false,"Cancellation settled before the real CLI exited");
    assert.equal(isAlive(child.pipeHolder),true,"The controlled child still kept the inherited pipes");
  });
});
