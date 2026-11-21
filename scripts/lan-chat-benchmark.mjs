// Real retrieval + unchanged deployment model/tools. Four existing natural questions,
// including two dependent follow-ups. Does not attach a delivery or edit source databases.
import fs from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
const base=process.env.ONEEARTH_URL||'http://127.0.0.1:5274';
const out=process.env.PERF_OUT||'output/lan-performance-2026-11-15/baseline-chat';
const n=Number(process.env.PERF_SAMPLES||3);
await fs.mkdir(out,{recursive:true});
const fixtures=JSON.parse(await fs.readFile('scripts/fixtures/research-acceptance.json','utf8'));
const saved=JSON.parse(await fs.readFile('output/product-fixes-2026-11-15/regression-20/SN-0347/turn-2/request.json','utf8')).payload;
const tools=await fetch(base+'/api/models/deepseek/tools').then(r=>r.json());
const context={...saved.context,candidateIds:[],candidateVersions:{},inCandidateScope:false};
const records=[];
await fs.writeFile(out+'/conditions.json',JSON.stringify({started:new Date().toISOString(),base,n,config:saved.config,deepseekTools:tools.defaults,concurrency:1,questions:['Q02','Q09'],measurement:'HTTP headers, first real tool start/result, findings, terminal validated answer. No token streaming exists in baseline executor.'},null,2));
for(let sample=1;sample<=n;sample++)for(const id of ['Q02','Q09']){
  let history=[];
  for(const [turn,query] of [[1,fixtures[id].paraphrase],[2,fixtures[id].probe]]){
    const key=`${id}-${sample}-${turn}`,started=performance.now(),events=[],callStarts=new Map(),durations=[];
    const payload={...saved,config:saved.config,deepseekTools:tools.defaults,context,history,query};
    const row={key,id,sample,turn,query,started:new Date().toISOString()};
    let pending='',terminal,bytes=0;const decoder=new TextDecoder();
    try{
      const response=await fetch(base+'/api/chat',{method:'POST',headers:{'content-type':'application/json',accept:'application/x-ndjson'},body:JSON.stringify(payload),signal:AbortSignal.timeout(420000)});
      row.headersMs=performance.now()-started;row.httpStatus=response.status;
      if(!response.ok)throw Error(await response.text());
      for await(const chunk of response.body){
        bytes+=chunk.length;pending+=decoder.decode(chunk,{stream:true});
        const lines=pending.split('\n');pending=lines.pop();
        for(const line of lines){if(!line.trim())continue;
          const e=JSON.parse(line),ms=performance.now()-started;events.push({ms,...e});
          if(e.call){
            if(e.call.status==='running'){
              if(!callStarts.has(e.call.id))callStarts.set(e.call.id,ms);
              if(e.call.id.startsWith('source-')&&row.firstRetrievalMs===undefined)row.firstRetrievalMs=ms;
            }else{
              durations.push({id:e.call.id,name:e.call.name,status:e.call.status,startMs:callStarts.get(e.call.id),endMs:ms,durationMs:callStarts.has(e.call.id)?ms-callStarts.get(e.call.id):null});
              if(e.call.id.startsWith('source-')&&row.firstRetrievalResultMs===undefined)row.firstRetrievalResultMs=ms;
            }
          }
          if(e.finding&&row.firstFindingMs===undefined)row.firstFindingMs=ms;
          if(e.metric)durations.push(e.metric);
          if(e.result||e.error)terminal=e;
        }
      }
      const r=terminal?.result;
      Object.assign(row,{totalMs:performance.now()-started,bytes,durations,error:terminal?.error,answerChars:r?.message?.length,clarification:r?.clarification,questionCheck:r?.questionCheck,sourceCounts:r?.answerNotes?{literature:r.answerNotes.sources.length,web:r.answerNotes.webSources.length}:undefined});
      if(r){history=[...history,{role:'user',text:query},{role:'assistant',text:r.message.slice(0,1600),assetIds:r.modelIds,conversationContext:r.conversationContext,researchIntent:r.researchIntent,conversationEvidence:r.conversationEvidence,conversationAssertionEvidence:r.conversationAssertionEvidence,conversationReferences:r.answerNotes?.references}].slice(-8);}
      await fs.writeFile(out+'/'+key+'.json.gz',gzipSync(JSON.stringify({payload,events})));
    }catch(e){Object.assign(row,{totalMs:performance.now()-started,error:String(e),durations,bytes});}
    records.push(row);await fs.writeFile(out+'/results.json',JSON.stringify(records,null,2));console.log(key,JSON.stringify(row));
  }
}
