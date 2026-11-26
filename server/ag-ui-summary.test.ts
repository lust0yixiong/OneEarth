import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {completeAgUiSummary} from "./ag-ui-persistence";
import {ProviderReasoningObserver,providerReasoningArchive,providerReasoningLimits} from "./provider-reasoning";
import {isNativeAgUiSummaryId} from "../src/domain/native-agui-summary";
import {EventSchema} from "@ag-ui/core/schemas";

const summary=(id:string)=>({id:id+":attempt:0:0",revision:2,kind:"summary",text:"这是供应商明确提供的公开摘要。",complete:true});
const frame=(type:string,sequence_number:number,extra:Record<string,unknown>={},name=type)=>Buffer.from("event: "+name+"\ndata: "+JSON.stringify({type,sequence_number,item_id:"fixture",output_index:0,summary_index:0,content_index:0,...extra})+"\n\n");
test("only a complete, bounded, same-task public summary passes the original safety filter",()=>{
 const id=randomUUID(),good=summary(id);assert.deepEqual(completeAgUiSummary(id,good),good);
 for(const bad of [null,[],{...good,id:randomUUID()+":attempt"},{...good,kind:"deepseek-thinking"},{...good,kind:"opaque"},{...good,kind:"private"},{...good,complete:false},{...good,complete:"true"},{...good,truncated:true},{...good,truncated:"false"},{...good,revision:0},{...good,revision:25},{...good,revision:1.5},{...good,text:" "},{...good,text:"x".repeat(providerReasoningLimits.textBytes+1)},{...good,private:true},{...good,encryptedValue:"OPAQUE_NOT_PUBLIC"},{...good,rawEvent:{type:"private"}},{...good,id:id+":"+"x".repeat(200)}])assert.equal(completeAgUiSummary(id,bad),undefined);
 const clean=completeAgUiSummary(id,{...good,text:"摘要参考 https://example.org/a?id=2&amp;amp;sig=CONTROLLED_SIGNATURE，Authorization: Bearer CONTROLLED_BEARER /private/var/fixture/report.pdf"});assert.ok(clean);assert.doesNotMatch(clean.text,/CONTROLLED_|sig=|\/private\/var/);assert.match(clean.text,/摘要参考/);
});
test("opaque items and wrong event markers cannot create a typed public summary",()=>{
 const id=randomUUID(),accepted:any[]=[],archive=providerReasoningArchive(id,[],value=>accepted.push(value)),observer=new ProviderReasoningObserver(id+":attempt",value=>archive.accept(value));
 observer.feed(frame("response.output_item.added",0,{item:{type:"reasoning",summary:[{text:"NESTED_PRIVATE_NOT_SELECTED"}],content:[{text:"PRIVATE_NOT_SELECTED"}],encrypted_content:"OPAQUE_NOT_SELECTED"}}));
 observer.feed(frame("response.reasoning_summary_text.done",1,{text:"WRONG_MARKER_NOT_SELECTED"},"response.reasoning_text.done"));
 observer.feed(frame("response.reasoning_summary_part.done",2,{part:{type:"opaque",text:"OPAQUE_PART_NOT_SELECTED"},text:"PRIVATE_FALLBACK_NOT_SELECTED"}));
 observer.feed(frame("response.reasoning_summary_part.done",3,{text:"MISSING_PART_NOT_SELECTED"}));assert.deepEqual(accepted,[]);
 observer.feed(frame("response.reasoning_text.done",4,{text:"RAW_THINKING_NOT_PUBLIC"}));assert.equal(accepted.length,1);assert.equal(completeAgUiSummary(id,accepted[0]),undefined);
 observer.feed(frame("response.reasoning_summary_text.delta",5,{delta:"明确的公开摘要。"}));assert.equal(completeAgUiSummary(id,accepted.at(-1)),undefined);
 observer.feed(frame("response.reasoning_summary_text.done",6,{text:"明确的公开摘要。"}));assert.equal(completeAgUiSummary(id,accepted.at(-1))?.text,"明确的公开摘要。");observer.close();
 const partValues:any[]=[],partObserver=new ProviderReasoningObserver(id+":part",value=>partValues.push(value));partObserver.feed(frame("response.reasoning_summary_part.done",0,{part:{type:"summary_text",text:"合法摘要分段。"},text:"PRIVATE_OUTER_TEXT_NOT_SELECTED"}));assert.equal(completeAgUiSummary(id,partValues[0])?.text,"合法摘要分段。");partObserver.close();
 const messageId="oneearth:summary:"+id+":"+"a".repeat(24);assert.equal(isNativeAgUiSummaryId(id,messageId),true);
 for(const event of [{type:"REASONING_START",messageId},{type:"REASONING_MESSAGE_START",messageId,role:"reasoning"},{type:"REASONING_MESSAGE_CONTENT",messageId,delta:"明确的公开摘要。"},{type:"REASONING_MESSAGE_END",messageId},{type:"REASONING_END",messageId}])assert.equal(EventSchema.parse(event).type,event.type);
});
