import test from "node:test";
import assert from "node:assert/strict";
import {EventSchema} from "@ag-ui/core/schemas";
import {agUiQuestionCheckDefinition,validAgUiQuestionCheck} from "./ag-ui-interrupt";

test("QuestionCheck has its own standard reason and exact three-choice response contract",()=>{
 const id="2048f023-fcd4-4eba-9088-1a57e2e41859",definition=agUiQuestionCheckDefinition(id,"确认研究问题");
 assert.equal(definition.reason,"oneearth.question-check");assert.deepEqual(definition.responseSchema,{oneOf:[
  {type:"object",additionalProperties:false,properties:{choice:{enum:["original","proposed"]}},required:["choice"]},
  {type:"object",additionalProperties:false,properties:{choice:{const:"edited"},dataQuestion:{type:"string",minLength:1,maxLength:4000}},required:["choice","dataQuestion"]},
 ]});
 assert.equal(EventSchema.parse({type:"RUN_FINISHED",threadId:id,runId:id,outcome:{type:"interrupt",interrupts:[definition]}}).type,"RUN_FINISHED");
 for(const value of [null,{}, {originalQuestion:"",proposedQuestion:"valid"},{originalQuestion:"valid",proposedQuestion:"bad\0value"}])assert.equal(validAgUiQuestionCheck(value),false);
 assert.equal(validAgUiQuestionCheck({originalQuestion:"原问题",proposedQuestion:"拟议问题"}),true);
});
