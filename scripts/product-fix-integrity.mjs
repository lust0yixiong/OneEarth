// Audit the real-user regression artifacts without making product/source requests.
import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';

const out=process.env.SCINET_OUT||'output/product-fixes-2026-11-15/regression-20';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const manifest=await read(path.join(out,'manifest.json'));
const version=await read(path.join(out,'current-version.json'));
const selected=(process.env.SCINET_IDS||'SN-0306,SN-0310,SN-0328,SN-0340,SN-0347,SN-0348,SN-0379,SN-0399,SN-0421,SN-0424,SN-0436,SN-0440,SN-0451,SN-0452,SN-0455,SN-0461,SN-0462,SN-0463,SN-0482,SN-0489').split(',');
const allowed=new Set(['resolve_dataset','find_dataset_by_task','search_dataset_usage','get_dataset_metadata','get_evidence','search_recipes']);
const errors=[],records=[],tools=new Set();let inputTurns=0,archivedFailures=0,confirmations=0;
for(const id of selected){
 try{
  const record=await read(path.join(out,id,'complete.json'));
  const job=manifest.tasks.find(j=>j.id===id);
  if(record.status!=='completed')errors.push(id+': '+record.status);
  if(record.first!==job.first||record.turns[0]?.question!==job.first)errors.push(id+': first question changed');
  if(!record.protocolFinished||!record.followupSent||!record.turns.some(t=>t.kind==='natural-followup'))errors.push(id+': continuation incomplete');
  inputTurns+=record.turns.length;
  archivedFailures+=(record.failedAttempts||[]).length;
  for(const turn of record.turns){
   const dir=path.join(out,id,'turn-'+turn.n);
   const request=await read(dir+'/request.json');
   const terminal=JSON.parse(gunzipSync(await fs.readFile(dir+'/response.json.gz')));
   if(terminal.error||!terminal.result)errors.push(id+'/'+turn.n+': no successful result');
   if(request.payload.query!==turn.question)errors.push(id+'/'+turn.n+': recorded question differs from sent request');
   if(request.payload.config?.model!==manifest.testModel)errors.push(id+'/'+turn.n+': model differs');
   if(request.deliveryId!==turn.deliveryId)errors.push(id+'/'+turn.n+': delivery differs');
   if(turn.questionCheck)confirmations++;
   for(const call of terminal.result?.runTrace?.calls||[])if(call.kind==='MCP'){
    tools.add(call.name);if(!allowed.has(call.name))errors.push(id+'/'+turn.n+': unexpected upstream tool '+call.name);
   }
  }
  records.push({id,status:record.status,inputTurns:record.turns.length,archivedFailures:(record.failedAttempts||[]).length,productVersions:[...new Set(record.turns.map(t=>t.productVersion))]});
 }catch(e){errors.push(id+': '+e.message);}
}
for(const [file,expected]of Object.entries(version.hashes)){
 const actual=await fs.readFile(file).then(b=>createHash('sha256').update(b).digest('hex')).catch(()=>null);
 if(actual!==expected)errors.push('Source changed after version registration: '+file);
}
const audit={checkedAt:new Date().toISOString(),scope:'Execution integrity only; semantic quality is separately reviewed against complete evidence.',selected:records.length,expected:selected.length,inputTurns,archivedFailures,confirmations,model:manifest.testModel,currentVersion:version.label,readonlyMcpTools:[...tools].sort(),records,errors,ok:errors.length===0};
await fs.writeFile(path.join(out,'integrity.json'),JSON.stringify(audit,null,2));
console.log(JSON.stringify(audit,null,2));if(errors.length)process.exitCode=1;
