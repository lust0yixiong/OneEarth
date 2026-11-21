import test,{type TestContext} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import express from "express";
import {chatHomeSettings} from "../../server/chat-home";
import {defaultHomeQuestions,parseHomeQuestions,maxHomeQuestions,maxHomeQuestionLength} from "./chat-home";

async function service(t:TestContext,file?:string){
  const dir=mkdtempSync(path.join(tmpdir(),"oneearth-home-test-"));
  const filename=file || path.join(dir,"chat-home.json");
  const app=express();app.use(express.json());app.use("/home",chatHomeSettings(filename));
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));
  t.after(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));rmSync(dir,{recursive:true,force:true});});
  const url="http://127.0.0.1:"+(server.address() as {port:number}).port+"/home";
  const read=()=>fetch(url).then(async r=>({status:r.status,body:await r.json()}));
  const save=(questions:unknown,revision:string)=>fetch(url,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({questions,revision})});
  return {filename,url,read,save};
}

test("Chat home defaults retain five questions after the requested removals",()=>{
  assert.equal(defaultHomeQuestions.length,5);
  assert.ok(defaultHomeQuestions.every(q=>!q.includes("近岸海底地形") && !q.includes("地震活动") && !q.includes("thermobarometric")));
  assert.ok(defaultHomeQuestions.some(q=>q.includes("川西") && q.includes("地表形变")));
  assert.deepEqual(parseHomeQuestions(["  完整问题？\n"]),["完整问题？"]);
  for(const value of [null,[" "],["x"," x "],[3],Array(maxHomeQuestions+1).fill("x"),["x".repeat(maxHomeQuestionLength+1)]])
    assert.throws(()=>parseHomeQuestions(value));
});

test("shared home edits persist in order across service instances, including an intentionally empty home",async t=>{
  const one=await service(t),initial=(await one.read()).body;
  assert.deepEqual(initial.questions,defaultHomeQuestions);
  const saved=await (await one.save([" 第二个问题 ","第一个问题"],initial.revision)).json();
  assert.deepEqual(saved.questions,["第二个问题","第一个问题"]);
  const two=await service(t,one.filename);
  assert.deepEqual((await two.read()).body,saved);
  assert.deepEqual(JSON.parse(readFileSync(one.filename,"utf8")).questions,saved.questions);
  assert.equal((await two.save([],saved.revision)).status,200);
  assert.deepEqual((await one.read()).body.questions,[]);
});

test("invalid saves and stale editors cannot overwrite the currently published questions",async t=>{
  const s=await service(t),initial=(await s.read()).body;
  const current=await (await s.save(["已发布问题"],initial.revision)).json();
  for(const questions of [[""],["重复","重复"],"not an array"])
    assert.equal((await s.save(questions,current.revision)).status,400);
  assert.equal((await s.save(["过时的编辑"],initial.revision)).status,409);
  assert.equal((await fetch(s.url,{method:"PUT",headers:{"Content-Type":"text/plain"},body:"wrong type"})).status,403);
  assert.deepEqual((await s.read()).body,current);
});

test("an unreadable existing configuration is surfaced rather than reset or overwritten with defaults",async t=>{
  const s=await service(t);writeFileSync(s.filename,"{invalid saved configuration");
  assert.equal((await s.read()).status,500);
  assert.equal((await s.save(["replacement"],"a".repeat(64))).status,500);
  assert.equal(readFileSync(s.filename,"utf8"),"{invalid saved configuration");
});
