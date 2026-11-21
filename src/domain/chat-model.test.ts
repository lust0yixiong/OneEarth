import test from "node:test";
import assert from "node:assert/strict";
import {defaultChatModel,resolvedChatModel,readChatModel,rememberedModel,rememberedService} from "./chat-model";

test("empty native choices and legacy browser preferences use GPT-6-Luna",t=>{
  const values=new Map<string,string>();
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,"localStorage");
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:(k:string)=>values.get(k)??null}});
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,"localStorage",descriptor);else Reflect.deleteProperty(globalThis,"localStorage");});
  assert.equal(defaultChatModel.model,"gpt-6-luna");
  assert.equal(readChatModel().model,"gpt-6-luna");
  values.set("oneearth.chat-model.v1",JSON.stringify({executor:"codex",model:""}));
  values.set("oneearth.chat-model.v1.codex.native",JSON.stringify({executor:"codex",provider:"native",model:""}));
  assert.equal(readChatModel().model,"gpt-6-luna");
  assert.equal(rememberedModel("codex"),"gpt-6-luna");
  assert.equal(rememberedService("codex","native").model,"gpt-6-luna");
  assert.equal(rememberedModel("claude"),"");
});
test("explicit models and other providers retain their configured identity",()=>{
  for(const config of [
    {executor:"codex" as const,model:"gpt-6.1-sol"},
    {executor:"codex" as const,provider:"custom" as const,model:"",endpoint:"https://example.org"},
    {executor:"codex" as const,provider:"deepseek" as const,model:"deepseek-flash"},
    {executor:"claude" as const,model:""},
  ])assert.equal(resolvedChatModel(config),config);
  const config={executor:"codex" as const,model:""};
  assert.equal(resolvedChatModel(config).model,"gpt-6-luna");
  assert.equal(config.model,"");
});
