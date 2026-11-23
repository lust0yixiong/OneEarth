import assert from "node:assert/strict";
import {test} from "node:test";
import {clarificationAnswerText,clarificationOptions,createClarificationPrompt,validClarificationAnswer,validClarificationPrompt} from "./clarification";

const parentTaskId="55aa4e03-e9d3-405f-b4af-e4f60b747099";

test("human choices use server IDs and preserve an optional note",()=>{
  const options=clarificationOptions(["  看本月 ","看上月"]);
  const prompt=createClarificationPrompt("research","核对哪个时段？",options)!;
  assert.deepEqual(options,[{id:"option-1",label:"看本月"},{id:"option-2",label:"看上月"}]);
  assert.equal(clarificationAnswerText(prompt,{parentTaskId,optionId:"option-1",text:"  保留原区域。  "}),"看本月\n保留原区域。");
  assert.equal(clarificationAnswerText(prompt,{parentTaskId,optionId:"different",text:"看本月"}),undefined);
  assert.deepEqual(clarificationOptions(["同一选项Ａ","同一选项a"]),[]);
  assert.deepEqual(createClarificationPrompt("chat","请说明资料。",[]),{kind:"chat",question:"请说明资料。"});
  assert.ok(!validClarificationAnswer({parentTaskId,text:" ",optionId:undefined}));
});

test("confirmation has fixed recorded options and free text is a separate response",()=>{
  const prompt=createClarificationPrompt("confirmation","是否切换？",[{id:"choice",label:"突变"}])!;
  assert.deepEqual(prompt.options,[{id:"approve",label:"确认执行"},{id:"decline",label:"不执行"}]);
  assert.ok(!validClarificationPrompt({...prompt,options:[{id:"approve",label:"拒绝"},prompt.options![1]]}));
  assert.equal(clarificationAnswerText(prompt,{parentTaskId,optionId:"approve",text:"改去另一城市"}),undefined);
  assert.equal(clarificationAnswerText(prompt,{parentTaskId,optionId:"decline"}),"不执行");
  assert.equal(clarificationAnswerText(prompt,{parentTaskId,text:"可以吗？"}),"可以吗？");
});
