// Exact saved follow-up replays against the real deployment, separately labelled
// from the 20 natural user conversations. No source or model response stubs.
import fs from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {randomUUID,createHash} from 'node:crypto';
const out=process.env.RECHECK_OUT||'output/product-fixes-2026-11-15/api-rechecks-v3',base=process.env.ONEEARTH_URL||'http://127.0.0.1:5274';
const previous='output/product-fixes-2026-11-15/regression-20';
const ids=(process.env.RECHECK_IDS||'SN-0340,SN-0379,SN-0440,SN-0452,SN-0461,SN-0462').split(',');
const write=async(p,v)=>fs.writeFile(p,JSON.stringify(v,null,2));
await fs.mkdir(out,{recursive:true});
const hashes={};for(const f of ['server/chat-executor.ts','server/scientific-answer.ts','server/archive-index.ts','server/read-pdf-page.ts','server/read-pdf-worker.mjs','server/answer-evidence-check.ts','server/review-answer-evidence.ts','server/index.ts','server/web-search.ts','src/domain/store.tsx','src/domain/types.ts','src/domain/read-evidence.ts','src/domain/assertion-evidence-memory.ts'])hashes[f]=createHash('sha256').update(await fs.readFile(f)).digest('hex');
await write(out+'/manifest.json',{started:new Date().toISOString(),base,mode:'real deployed API replay of saved user follow-ups, not another natural actor batch',model:'gpt-6-luna',hashes,ids,extra:'CONTROL-CALC and one follow-up consuming the actual newly returned assertion memory'});
const records=[];
async function send(id,payload,confirmationDepth=0){
 const dir=out+'/'+id;await fs.mkdir(dir,{recursive:true});
 const deliveryId=randomUUID(),started=Date.now();await write(dir+'/request.json',{deliveryId,payload});
 const res=await fetch(base+'/api/chat',{method:'POST',headers:{'content-type':'application/json',accept:'application/x-ndjson','x-oneearth-delivery':deliveryId},body:JSON.stringify(payload),signal:AbortSignal.timeout(420000)});
 let terminal;
 if(!res.ok)throw Error('HTTP '+res.status+': '+(await res.text()).slice(0,240));
 if(res.headers.get('content-type')?.includes('application/x-ndjson')){
  const reader=res.body.pipeThrough(new TextDecoderStream()).getReader();let pending='';
  try{while(true){const {value,done}=await reader.read();pending+=value||'';const lines=pending.split('\n');pending=lines.pop();for(const line of lines){if(!line.trim())continue;const event=JSON.parse(line);if(event.result||event.error)terminal=event;}if(terminal||done)break;}}finally{await reader.cancel().catch(()=>{});}
 }else {const v=await res.json();terminal=v.result||v.error?v:{result:v};}
 if(!terminal)throw Error('No terminal event');
 await fs.writeFile(dir+'/response.json.gz',gzipSync(JSON.stringify(terminal)));
 const r=terminal.result,record={id,finished:new Date().toISOString(),elapsedMs:Date.now()-started,deliveryId,error:terminal.error,code:terminal.code,query:payload.query,message:r?.message,limitation:r?.answerNotes?.limitation,followUp:r?.answerNotes?.followUp,
  assertionBlocks:r?.conversationAssertionEvidence?.map(e=>({assetId:e.assetId,block:e.block,stage:e.stage})),
  reviewCalls:r?.runTrace?.calls?.filter(c=>['answer-source-review','answer-source-repair','calculation-plan'].includes(c.id)||c.name==='受控数值核算'),
  readonlyMcp:r?.runTrace?.calls?.filter(c=>c.kind==='MCP').map(c=>c.name)};
 await write(dir+'/summary.json',record);records.push(record);console.log(id,terminal.error||'answer',Math.round(record.elapsedMs/1000));
 if(r?.questionCheck){
  if(confirmationDepth>=1)throw Error('Repeated conversion confirmation after choosing the original question');
  await write(dir+'/confirmation.json',{choice:'original',originalQuestion:payload.query});
  return send(id+'-confirmed',{...payload,questionDecision:{checkMessageId:deliveryId,originalQuestion:payload.query,dataQuestion:payload.query,choice:'original'}},confirmationDepth+1);
 }
 return {result:r,payload,deliveryId};
}
let cursor=0;
await Promise.all(Array.from({length:3},async()=>{while(cursor<ids.length){const id=ids[cursor++];try{
 let {payload}=JSON.parse(await fs.readFile(previous+'/'+(id==='CONTROL-CALC'?'SN-0347':id)+'/turn-2/request.json','utf8'));
 if(id==='CONTROL-CALC')payload={...payload,history:[],context:{...payload.context,candidateIds:[],candidateVersions:{},inCandidateScope:false,selection:null},query:'请核算一个明确的合成示例：4000 psi，采用换算因子 1 psi = 0.0068948 MPa，结果是多少？保留计算式，并明确这只是数学示例，不是实测或经验关系验证。'};
 const sent=await send(id,payload);
 if(id==='SN-0462'&&sent.result&&!sent.result.clarification){
  const r=sent.result;const history=[...payload.history,{role:'user',text:payload.query},{role:'assistant',text:r.message.slice(0,1600),assetIds:r.modelIds,conversationContext:r.conversationContext,researchIntent:r.researchIntent,conversationEvidence:r.conversationEvidence,conversationAssertionEvidence:r.conversationAssertionEvidence,conversationReferences:r.answerNotes?.references}].slice(-8);
  await send('SN-0462-memory-followup',{...payload,query:'这段 Daurala 会议笔记属于亲眼观察，还是根据在场者的报告记录？请保留原句和来源段号。',history,context:{...payload.context,filters:r.filters||payload.context.filters,candidateIds:r.modelIds||[],candidateVersions:{}}});
 }
 }catch(e){const record={id,error:String(e),finished:new Date().toISOString()};records.push(record);await fs.mkdir(out+'/'+id,{recursive:true});await write(out+'/'+id+'/runner-error.json',record);console.log('ERROR',id,String(e));}}}));
if(!process.env.RECHECK_SKIP_CONTROL&&!ids.includes('CONTROL-CALC')){
 const {payload}=JSON.parse(await fs.readFile(previous+'/SN-0347/turn-2/request.json','utf8'));
 await send('CONTROL-CALC',{...payload,history:[],context:{...payload.context,candidateIds:[],candidateVersions:{},inCandidateScope:false,selection:null},query:'请核算一个明确的合成示例：4000 psi，采用换算因子 1 psi = 0.0068948 MPa，结果是多少？保留计算式，并明确这只是数学示例，不是实测或经验关系验证。'}).catch(e=>records.push({id:'CONTROL-CALC',error:String(e)}));
}
await write(out+'/summary.json',{finished:new Date().toISOString(),mode:'actual API rechecks',records});console.log('RECHECKS_END',records.length);
