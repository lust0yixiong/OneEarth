import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {webGrantInput} from "./runtime-web-tool-authority";
const parent=randomUUID(),message=randomUUID(),model={executor:"codex" as const,provider:"native" as const,model:"authorized-model"};
for(const kind of ["discovery","source-read"] as const)test("an explicit non-web source restriction never grants web tools: "+kind,()=>{
  const scope=kind==="discovery"?{kind,question:"只在海纳查找2020年降水资料"}:{kind,question:"只在海纳查找2020年降水资料",urls:["https://example.org/old-reference"]};
  assert.equal(webGrantInput(parent,message,model,{search:true,fetch:true},scope),undefined);
});
test("a user-selected exact URL preserves origin/PDF authorization while DeepSeek switches are off",()=>{
  const grant=webGrantInput(parent,message,model,{search:false,fetch:false},{kind:"source-read",question:"请打开此原始PDF核对方法",urls:["https://example.org/original.pdf"]},{});
  assert.ok(grant);assert.equal(grant.allowSearch,false);assert.equal(grant.allowFetch,true);assert.equal(grant.deepseekSearch,false);assert.equal(grant.deepseekFetch,false);assert.equal(grant.nativeModel,undefined);
});
test("basic open search and authorized native executor do not inherit DeepSeek supply permission",()=>{
  const grant=webGrantInput(parent,message,model,{search:false,fetch:false},{kind:"discovery",question:"查找NOAA风场数据"},{});
  assert.ok(grant?.allowSearch);assert.equal(grant.allowFetch,false);assert.equal(grant.deepseekSearch,false);assert.deepEqual(grant.nativeModel,model);
  assert.equal(webGrantInput(parent,message,{executor:"claude",model:"other"},{search:true,fetch:true},{kind:"discovery",question:"找资料"},{})!.nativeModel,undefined);
});
test("DeepSeek permission is the intersection of this request, runtime deployment and its credential",()=>{
  const old=process.env.DEEPSEEK_API_KEY;process.env.DEEPSEEK_API_KEY="controlled-key-not-a-real-secret";
  try{
    const env={ONEEARTH_DEEPSEEK_SEARCH:"true",ONEEARTH_DEEPSEEK_FETCH:"true"};
    const granted=webGrantInput(parent,message,model,{search:true,fetch:false},{kind:"discovery",question:"找风场资料"},env)!;
    assert.equal(granted.deepseekSearch,true);assert.equal(granted.deepseekFetch,false);assert.equal(granted.allowFetch,false);assert.ok(!JSON.stringify(granted).includes(process.env.DEEPSEEK_API_KEY));
    assert.equal(webGrantInput(parent,message,model,{search:true,fetch:true},{kind:"discovery",question:"找资料"},{})!.deepseekSearch,false);
  }finally{if(old===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=old;}
});
