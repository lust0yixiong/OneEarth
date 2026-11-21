// Real deployed UI conversations. No source fixtures or source database mutations.
// Run from the project root with `node --import tsx scripts/scinet-full-capability.mjs`.
// Resumes unfinished IDs; SCINET_LIMIT limits new cases, not the 706-case manifest.
import fs from 'node:fs/promises';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';
import {readActiveWorkspace} from './read-active-workspace.mjs';

const root=process.cwd(),out=process.env.SCINET_OUT || path.join(root,'output/scinet-full-capability-2026-11-14');
const parentOut=path.join(root,'output/scinet-full-capability-2026-11-14');
const base=process.env.ONEEARTH_URL || 'http://127.0.0.1:5274';
const testModel=process.env.SCINET_MODEL || '';
if(testModel && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(testModel))throw Error('Invalid test model');
const input=process.env.SCINET_INPUT || await fs.access(parentOut+'/source-workbook.json').then(()=>parentOut+'/source-workbook.json').catch(()=>'/tmp/oe-scinet-user-workbook.json');
const now=()=>new Date().toISOString(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const write=async(file,value)=>{await fs.writeFile(file+'.tmp',JSON.stringify(value,null,2));await fs.rename(file+'.tmp',file);};
const read=async(file,fallback=null)=>fs.readFile(file,'utf8').then(JSON.parse).catch(()=>fallback);
await fs.mkdir(out,{recursive:true});
const workbook=await read(input),sheet=workbook.find(s=>s.name==='全量改写');
const jobs=sheet.rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k.replace(/\d+$/,''),v])))
  .filter(r=>/^SN-\d{4}$/.test(r.A)).map(r=>({id:r.A,mode:r.B,domain:r.C,first:r.D,latent:r.E,boundary:r.F,checks:r.G,failures:r.H,original:r.I,activity:r.J,core:r.N}));
if(jobs.length!==706 || new Set(jobs.map(j=>j.id)).size!==706)throw Error('Expected exactly 706 unique tasks');
const baselineFiles=['server/data-search.ts','server/chat-executor.ts','server/scientific-answer.ts','server/earthnano.ts','server/web-search.ts','src/domain/research-question.ts'];
const files=[...baselineFiles,'src/domain/store.tsx','server/index.ts','src/domain/reference-memory.ts','server/source-identity.ts','src/domain/lineage.ts','src/components/DatasetLineage.tsx','src/components/AnswerMapContext.tsx','server/evidence-excerpts.ts','server/executor-failure.ts','server/datacite-search.ts','server/related-identifiers.ts','src/domain/types.ts','src/domain/results.ts','server/coverage-router.ts','server/archive-index.ts','server/paper-metadata-identity.ts','src/domain/chat-model.ts','src/domain/haina-space.ts','src/components/DatasetInspector.tsx','server/assertion-relations.ts','src/domain/assertion-relations.ts','src/domain/paper-record.ts','server/paper-name-identity.ts','server/web-complement.ts','server/fetch-pages.ts'];
files.push('server/plan-adaptation.ts','server/evidence-ranking.ts','server/verified-calculation.ts','server/read-pdf-page.ts','server/pdf-ranges.ts','server/read-pdf-worker.mjs','server/source-preview.ts','src/domain/read-evidence.ts','src/domain/answer-map.ts','src/components/AnswerContent.tsx','src/domain/answer-blocks.ts','src/styles/research-chat.css','package.json','package-lock.json');
const hashes=Object.fromEntries(await Promise.all(files.map(async f=>[f,await fs.readFile(path.join(root,f)).then(b=>createHash('sha256').update(b).digest('hex')).catch(e=>{if(e.code==='ENOENT')return null;throw e;})])));
const manifest=await read(out+'/manifest.json');
if(!manifest)await write(out+'/manifest.json',{created:now(),base,input,testModel:testModel||null,protocol:'每个任务使用 D 列原文首问；按需回应关键追问；有实质答复后继续一轮自然追问；最多六个输入轮次，转换一律先选按原问题继续；真实部署端点、真实来源，无响应桩。模型辅助标注只记为待核问题，不能替代人工复核。',hashes,tasks:jobs});
if(manifest && (manifest.testModel||'')!==testModel)throw Error('Test model changed within the same output directory');
const previousVersion=await read(out+'/current-version.json');
const baselineMatches=!manifest||Object.entries(manifest.hashes).every(([f,h])=>hashes[f]===h);
const sameVersion=previousVersion&&JSON.stringify(previousVersion.hashes)===JSON.stringify(hashes);
if(!(sameVersion||(!previousVersion&&baselineMatches))&&process.env.SCINET_ALLOW_VERSION_CHANGE!=='1')throw Error('Product changed: drain running requests, record deployment, and explicitly allow a version transition');
const productVersion=sameVersion?previousVersion:{label:process.env.SCINET_PRODUCT_LABEL||(!previousVersion&&baselineMatches?'baseline-v1':'unlabeled-transition'),registeredAt:now(),hashes,transitionReason:process.env.SCINET_VERSION_REASON||null};
if(!sameVersion){
 const versions=await read(out+'/version-history.json',[]);
 if(!versions.length&&manifest&&!baselineMatches)versions.push({label:'baseline-v1',registeredAt:manifest.created,hashes:manifest.hashes});
 versions.push(productVersion);await write(out+'/version-history.json',versions);await write(out+'/current-version.json',productVersion);
}
const state={started:now(),total:706,completed:0,running:{},failed:0,turns:0,candidates:0};
let cursor=0,launched=0,infraFailures=0,halt=false,reporting=Promise.resolve();
const limit=Number(process.env.SCINET_LIMIT)||Infinity;
const maxRetries=Number(process.env.SCINET_MAX_RETRIES||2);
if(!Number.isInteger(maxRetries)||maxRetries<0||maxRetries>5)throw Error('Invalid retry limit');
state.retryLimit=maxRetries;
const only=process.env.SCINET_IDS?.split(',');
const shard=process.env.SCINET_SHARD===undefined?null:Number(process.env.SCINET_SHARD);
const maxId=Number(process.env.SCINET_MAX_ID||706),minId=Number(process.env.SCINET_MIN_ID||1);
if(!Number.isInteger(maxId)||!Number.isInteger(minId)||minId<1||maxId>706||minId>maxId)throw Error('Invalid phase range');
state.phase={minId,maxId};
const queue=(only?jobs.filter(j=>only.includes(j.id)):jobs).filter(j=>Number(j.id.slice(3))>=minId&&Number(j.id.slice(3))<=maxId).filter(j=>shard===null || (Number(j.id.slice(3))-1)%3===shard);
const selectedIds=new Set(queue.map(j=>j.id));state.rangeTotal=queue.length;
const completed=new Map();
for(const j of jobs){const done=await read(out+'/'+j.id+'/complete.json') || (out!==parentOut&&process.env.SCINET_INDEPENDENT_RUN!=='1'?await read(parentOut+'/'+j.id+'/complete.json'):null);if(done)completed.set(j.id,done);}
async function report(){reporting=reporting.then(async()=>{
 const records=[...completed.values()].filter(r=>selectedIds.has(r.id));state.completed=records.length;state.failed=records.filter(r=>r.status!=='completed').length;
 state.turns=records.reduce((n,r)=>n+r.turns.length,0);state.candidates=records.reduce((n,r)=>n+(r.issues?.length||0),0);state.updated=now();
 await write(out+'/progress.json',state);
 await write(out+'/issues.json',records.flatMap(r=>(r.issues||[]).map(i=>({...i,conversation:r.id+'/conversation.html',evidence:r.id+'/turn-'+i.turn+'/response.json.gz'}))));
 await write(out+'/input-issues.json',records.filter(r=>r.inputIssues?.length).map(r=>({id:r.id,first:r.first,latent:r.latent,issues:r.inputIssues})));
 const esc=x=>String(x??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 const rows=records.sort((a,b)=>a.id.localeCompare(b.id)).map(r=>`<tr><td>${r.id}</td><td>${esc(r.domain)}</td><td>${esc(r.first)}</td><td>${r.turns.length}</td><td>${esc(r.status)}</td><td>${(r.issues||[]).map(i=>esc(i.category+': '+i.title)).join('<br>')}</td><td><a href="${r.id}/conversation.html">对话与证据</a></td></tr>`).join('');
 await fs.writeFile(out+'/report.html',`<!doctype html><meta charset="utf-8"><title>OneEarth ${minId}—${maxId} 题能力探查</title><style>body{font:15px system-ui;margin:32px;color:#193e34;background:#f5f8f7}table{border-collapse:collapse;background:white;width:100%}td,th{padding:12px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}input{padding:12px;width:70%}a{color:#1b7760}.note{color:#65786f}</style><h1>OneEarth ${minId}—${maxId} 题能力探查</h1><p>已结束 ${state.completed}/${state.rangeTotal} · 正常完成 ${state.completed-state.failed} · 需重试 ${state.failed} · 已记录输入轮次 ${state.turns} · 待核问题线索 ${state.candidates}</p><p class="note">更新 ${state.updated}。不是验收分数；没有资料、权限边界、来源超时与产品缺陷分别记录。模型标注的线索尚需复核。正在执行：${Object.keys(state.running).join('、')||'无'}。</p><input placeholder="筛选任务、领域、问题" oninput="document.querySelectorAll('tbody tr').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(this.value.toLowerCase()))"><table><thead><tr><th>任务</th><th>领域</th><th>首问</th><th>轮次</th><th>执行情况</th><th>待核问题</th><th>记录</th></tr></thead><tbody>${rows}</tbody></table>`);
 });return reporting;}
async function control(){while(true){const c=await read(out+'/control.json',{});if(c.stop){halt=true;return false;}if(!c.pause)return !halt;await sleep(2000);}}
const actorInstructions=`你是 OneEarth 能力探查中的模拟真实用户兼证据检查员。只输出 JSON。UI快照的mapText包含历史所有轮次，不能仅因多个文本统计不同就断言当前结果矛盾；优先使用currentMapText、同一资料的hover/inspector和canvas.answerId核对。
题表 D 是必须保留的自然首问，E 是可选潜在测试条件，F 是边界追问素材，G/H 是检查点而不是给 OneEarth 的指令。不要把 E/F 整段背给 OneEarth。模拟用户不知道所有专业字段的真实对话，回答简短自然，一次只回应助手实际问到的一两点。若 E 的年份/地区明显与原任务冲突（古气候年代、地质、外星、全球等），不要使用它，记录 inputIssues。没有用户指定就不要从助手推荐结果反推为用户需求。不要把科学问题一律变成找数据，不替用户新增因果、算法、分辨率、地点或下载要求。
若 OneEarth 正在 clarification，按已有首问和合理的潜在条件回应它；条件未知就明确暂不限或不知道，先答可答的部分。相同问题已回复过还在反复追问则记录候选问题，仍用自然回复。首次得到实质答复后，要再进行一轮连续追问：优先回应末尾 followUp 中真正重要的一两点；否则根据刚才答复选择一个具体来源/结论/缺口追问或修改一个适用条件，用 F 边界素材可以但必须说得像用户。不要所有任务都套用“先核对资料不计算”。若已完成实质答复后的追问并获得答复，next=null。
问题检查必须克制且有证据：输出的问题全部只是候选，必须提供原文 quote 和简短 expected，区分 理解偏移/过度改写、无效追问、连续对话、来源依据、虚假执行、球上联动、可读性、工具失败、测试输入。来源零命中不等于产品缺陷，诚实说没下载或不能实验不等于失败，真实外部403/404与超时是来源故障。仅凭缺少 URL 不能断定杜撰；地图元数据不足不能断定没高亮。检查是否将方法文献画成观测点、未定位资料伪造点、全球覆盖伪装实测、忽略用户条件、引用不支持声称、凭 R2 改网格/相机、丢失历史。不要把一切可改进之处都记为缺陷。可记录明确外部故障 category=来源故障，nature=external。工具失败需要给出实际失败操作及错误；不能把已成功的空结果标为失败。
文化/经济地理、访谈、档案、政策、民族志问题可以涉及文本、语境、形成过程和抽样，不能强制转成数值栅格或找数任务。潜在测试条件只有在助手真正追问且符合原研究意图时才使用，研究区或2020—2023不是每题的默认条件。助手给的案例地点不是用户已经选定的研究区。
返回 {next:简短中文用户回复或null, reason:此回复为何符合用户原意, inputIssues:[题表不合理之处], issues:[{category,title,quote,expected,nature:"product"|"external"|"input"|"uncertain",confidence:"high"|"medium"}]}。只依据所给记录，不假装已经独立验证所有网页。`;
async function decide(job,record,last){
 const ui=last.ui&&{assetId:last.ui.assetId,assetCitations:last.ui.assetCitations,webCitations:last.ui.webCitations,flyLabel:last.ui.flyLabel,error:last.ui.error,inspector:last.ui.inspector,
  snapshots:Object.fromEntries(['before','hover','click','fly'].filter(k=>last.ui[k]).map(k=>{const s=last.ui[k],w=s.workspace;return [k,{...s,workspace:w&&{camera:w.camera,selection:w.selection,filters:w.filters,gridSystem:w.gridSystem,mapResult:w.mapResult&&{title:w.mapResult.title,answerId:w.mapResult.answerId,ids:w.mapResult.ids?.slice(0,12),idCount:w.mapResult.ids?.length,selection:w.mapResult.selection}}}];}))};
 const evidence={job,conversation:record.turns.map(t=>({user:t.question,assistant:t.message?.slice(0,8500),clarification:t.clarification,questionCheck:t.questionCheck})),postAnswerFollowupSent:record.followupSent,ui,
 references:last.result.answerNotes?.references,
 webEvidence:last.result.answerNotes?.webSources?.slice(0,18).map(h=>({title:h.title,url:h.url,doi:h.doi,snippet:h.snippet?.slice(0,900),pageExcerpt:h.pageExcerpt?.slice(0,3500),previousRead:h.previousRead,readAt:h.readAt})),
 datasetEvidence:last.result.paperRecords?.filter(p=>last.result.modelIds?.includes(p.id)).slice(0,8).map(p=>({id:p.id,title:p.need?.product,url:p.need?.url,detail:p.need?.detail,profile:p.need?.profile,studyContext:p.studyContext,points:p.points,
 researchQuestions:p.researchQuestions?.slice(0,3),
 researchPaths:p.researchPaths?.slice(0,1).map(path=>({...path,members:path.members.slice(0,6),steps:path.steps.slice(0,6).map(step=>({...step,purpose:step.purpose.slice(0,160),method:step.method.slice(0,350)}))})),
 evidenceLinks:p.evidenceLinks?.slice(0,2),tabs:p.need?.tabs?.slice(0,4).map(t=>({label:t.label,columns:t.columns,rows:t.rows?.slice(0,2).map(r=>r.map(c=>String(c).slice(0,800))),quote:t.quote?.slice(0,1800)}))})),
 searches:last.result.answerNotes?.searches?.map(s=>({engine:s.engine,query:s.query,status:s.status,total:s.total,error:s.error,warning:s.warning,hits:s.hits?.slice(0,3).map(h=>({title:h.title,url:h.url,doi:h.doi,snippet:h.snippet?.slice(0,600)}))})),context:last.result.conversationContext,followUp:last.result.answerNotes?.followUp,sourceTrace:last.result.runTrace?.calls?.map(c=>({name:c.name,status:c.status,error:c.error,output:c.output?.slice(0,900)}))};
 for(let attempt=0;attempt<2;attempt++)try{
  const raw=await new Promise((resolve,reject)=>{
   const child=spawn('codex',['exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','-s','read-only','--disable','shell_tool','--disable','unified_exec','--disable','plugins','--disable','multi_agent','-c','model_reasoning_effort="medium"','-'],{cwd:'/tmp',stdio:'pipe',timeout:110000,killSignal:'SIGKILL'});
   let stdout='',stderr='';child.stdin.on('error',()=>{});child.on('error',reject);
   child.stdout.on('data',b=>{stdout+=b;if(stdout.length>150000)child.kill('SIGKILL');});child.stderr.on('data',b=>{stderr=(stderr+b).slice(-500);});
   child.on('close',code=>code===0?resolve(stdout.trim()):reject(Error('Test actor failed '+code+' '+stderr)));child.stdin.end(actorInstructions+'\n'+JSON.stringify(evidence));
  });
  const value=JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,''));
  if(value.next!==null && (typeof value.next!=='string'||value.next.length>900))throw Error('Invalid user reply');
  await fs.writeFile(last.path+'/review-'+attempt+'.txt',raw);return value;
 }catch(e){last.actorError=e.message;}
 return {next:last.result.clarification?'具体范围和时段暂时不限定，请先按原问题说明目前能够判断的部分。':record.followupSent?null:'刚才的判断最关键的依据是哪一项？哪些已有直接证据，哪些还不能确定？',reason:'模拟用户工具失败，使用公开的保守回复，不补造条件',inputIssues:[],issues:[]};
}
async function mirror(req,id,dir){
 await write(dir+'/request.json',{deliveryId:id,payload:req});
 let lastError;
 for(let attempt=0;attempt<3;attempt++)try{
  const response=await fetch(base+'/api/chat',{method:'POST',headers:{'content-type':'application/json',accept:'application/x-ndjson','x-oneearth-delivery':id},body:JSON.stringify(req),signal:AbortSignal.timeout(330000)});
  if(!response.ok)throw Error('Delivery attach HTTP '+response.status+': '+(await response.text()).slice(0,300));
  if(!response.headers.get('content-type')?.includes('application/x-ndjson')){const v=await response.json();return v.result||v.error?v:{result:v};}
  const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();let pending='',terminal;
  try{while(true){const {value,done}=await reader.read();pending+=value||'';const lines=pending.split('\n');pending=lines.pop();for(const line of lines){if(!line.trim())continue;const e=JSON.parse(line);if(e.result||e.error){terminal=e;break;}}if(terminal)return terminal;if(done)throw Error('No terminal event');}}finally{await reader.cancel().catch(()=>{});}
 }catch(e){lastError=e;await sleep(1500);}
 throw lastError;
}
const compact=w=>w&&({caseId:w.caseId,camera:w.camera,selection:w.selection,filters:w.filters,gridSystem:w.gridSystem,mapResult:w.mapResult,answerId:w.answerId});
async function snapshot(p){return {workspace:compact(await p.evaluate(readActiveWorkspace)),canvas:await p.locator('canvas[data-painted]').evaluateAll(es=>es.map(e=>({...e.dataset}))),mapText:await p.locator('.answer-map-context').allTextContents(),currentMapText:await p.locator('.message.assistant').last().locator('.answer-map-context').allTextContents(),locationNote:await p.locator('.answer-location-note').allTextContents()};}
async function globe(p,dir){const ui={};try{
 await p.getByRole('button',{name:'数据地球',exact:true}).click();await p.locator('canvas[data-painted]').waitFor();ui.before=await snapshot(p);
 const last=p.locator('.message.assistant').last(),cite=last.locator('button.answer-citation[data-asset-id]').first();
 ui.assetCitations=await last.locator('button.answer-citation[data-asset-id]').count();ui.webCitations=await last.locator('a.answer-citation').count();
 const activate=last.locator('.answer-map-context').getByRole('button',{name:'在球上查看',exact:true});if(await activate.count())await activate.first().click();
 if(await cite.count()){
  await cite.scrollIntoViewIfNeeded();await cite.hover();await sleep(180);ui.hover=await snapshot(p);ui.assetId=await cite.getAttribute('data-asset-id');
  await cite.click();await sleep(250);ui.inspector=await p.locator('.overview-inspector').allTextContents();ui.click=await snapshot(p);
  const close=p.getByLabel('关闭数据速览',{exact:true});if(await close.count())await close.click();
  const fly=last.getByRole('button',{name:/^(定位资料网格|定位覆盖范围|查看全球覆盖|查看官方空间范围|查看官方全球范围)$/}).first();
  if(await fly.count()){ui.flyLabel=await fly.innerText();await fly.click();await p.waitForFunction(()=>document.querySelector('canvas[data-painted]')?.dataset.flying!=='true',null,{timeout:18000});ui.fly=await snapshot(p);}else ui.flyLabel=null;
 }
 await p.screenshot({path:dir+'/globe.png'});
 }catch(e){ui.error=e.message;}return ui;}
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-unsafe-swiftshader']});
async function task(job,worker){
 const dir=out+'/'+job.id;await fs.mkdir(dir,{recursive:true});
 let record=await read(dir+'/progress.json');
 if(!record)record={...job,started:now(),status:'running',turns:[],issues:[],inputIssues:[],runtimeErrors:[],followupSent:false};
 if(record.status==='execution-error' && record.turns.at(-1)?.error){
  const failed=record.turns.at(-1),attempt=(record.failedAttempts?.length||0)+1;
  const archive='failed-attempts/attempt-'+attempt;await fs.mkdir(dir+'/failed-attempts',{recursive:true});
  await fs.rename(dir+'/turn-'+failed.n,dir+'/'+archive);
  const oldComplete=await read(dir+'/complete.json');if(oldComplete)await write(dir+'/'+archive+'/failed-conversation.json',oldComplete);
  await fs.rm(dir+'/complete.json',{force:true});completed.delete(job.id);
  record.failedAttempts=[...(record.failedAttempts||[]),{...failed,archive}];record.turns.pop();
  record.retryFailed={question:failed.question,kind:failed.kind,deliveryId:failed.deliveryId};record.next=failed.question;
  record.protocolFinished=false;delete record.error;delete record.pending;
 }
 record.instrumentRuns=[...(record.instrumentRuns||[]),{version:3,started:now(),reasoningEffort:'medium',productVersion:productVersion.label}];record.status='running';
 const storage=await fs.access(dir+'/browser-state.json').then(()=>dir+'/browser-state.json').catch(()=>undefined);
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',storageState:storage});
 if(record.sessionId)await ctx.addInitScript(sid=>{if(location.pathname==='/')history.replaceState({...history.state,oneearthSession:sid,oneearthPath:location.pathname+location.search},'');},record.sessionId);
 if(testModel)await ctx.addInitScript(model=>localStorage.setItem('oneearth.chat-model.v1',JSON.stringify({executor:'codex',model})),testModel);
 const p=await ctx.newPage();p.setDefaultTimeout(18000);p.on('pageerror',e=>record.runtimeErrors.push(e.message));
 const save=async()=>{const sid=await p.evaluate(()=>history.state?.oneearthSession).catch(()=>null);if(typeof sid==='string'&&sid&&(!record.sessionId||record.sessionId===sid))record.sessionId=sid;await write(dir+'/progress.json',record);if(sid&&sid===record.sessionId)await ctx.storageState({path:dir+'/browser-state.json',indexedDB:true});};
 async function ask(question,kind,pending){
  const n=record.turns.length+1,td=dir+'/turn-'+n;await fs.mkdir(td,{recursive:true});
  state.running[job.id]={worker,turn:n,kind,started:now()};await report();console.log('ASK',job.id,n,kind,question);
  let req,id,started=now(),turnVersion=productVersion.label;
  if(pending){({payload:req,deliveryId:id}=pending);started=pending.started||started;turnVersion=pending.productVersion||'baseline-v1';}
  else{
   let res;
   if(record.retryFailed){
    if(question!==record.retryFailed.question)throw Error('Instrumentation: retry question differs from failed original');
    const original=p.locator('.message.assistant.failed[data-message-id="'+record.retryFailed.deliveryId+'"]');
    await original.waitFor();
    const wait=p.waitForResponse(r=>r.url().endsWith('/api/chat')&&r.request().method()==='POST',{timeout:45000});
    await original.getByRole('button',{name:'重试',exact:true}).click();res=await wait;
    if(res.request().postDataJSON().query!==question)throw Error('Instrumentation: retry did not preserve question');
   }else{
    await p.getByLabel('向 OneEarth 提问',{exact:true}).fill(question);
    const wait=p.waitForResponse(r=>r.url().endsWith('/api/chat')&&r.request().method()==='POST',{timeout:45000});
    await p.getByRole('button',{name:'发送消息',exact:true}).click();res=await wait;
   }
   req=res.request().postDataJSON();id=res.request().headers()['x-oneearth-delivery'];
   record.pending={question,kind,payload:req,deliveryId:id,started,productVersion:turnVersion};delete record.retryFailed;await save();
  }
  if(testModel && req.config?.model!==testModel)throw Error('Requested model differs from test assignment');
  if(!id)throw Error('Missing delivery ID');
  let terminal=await mirror(req,id,td),questionCheck;
  await p.locator('.message.assistant[data-message-id="'+id+'"]').waitFor({timeout:30000});
  if(terminal.result?.questionCheck){
   questionCheck=terminal.result.questionCheck;
   const wait=p.waitForResponse(r=>r.url().endsWith('/api/chat')&&r.request().method()==='POST',{timeout:45000});
   await p.getByRole('button',{name:'按原问题继续',exact:true}).click();const res=await wait;
   await fs.writeFile(td+'/pre-confirmation.json.gz',gzipSync(JSON.stringify(terminal)));
   req=res.request().postDataJSON();id=res.request().headers()['x-oneearth-delivery'];
   record.pending={question,kind,payload:req,deliveryId:id,started,questionCheck,productVersion:turnVersion};await save();
   terminal=await mirror(req,id,td);await p.locator('.message.assistant[data-message-id="'+id+'"]').waitFor({timeout:30000});
  }
  await sleep(350);
  await fs.writeFile(td+'/response.json.gz',gzipSync(JSON.stringify(terminal)));
  const result=terminal.result||{},row={n,question,kind,productVersion:turnVersion,started,finished:now(),deliveryId:id,message:result.message||'',clarification:!!result.clarification,questionCheck:questionCheck||pending?.questionCheck,error:terminal.error,code:terminal.code,executorDiagnostic:terminal.executorDiagnostic,elapsedMs:Date.now()-Date.parse(started),references:result.answerNotes?.references,sourceStatus:result.answerNotes?.searches?.map(s=>({engine:s.engine,status:s.status,hits:s.hits?.length,error:s.error})),workspace:compact(await p.evaluate(readActiveWorkspace))};
  row.body=await p.locator('.message.assistant[data-message-id="'+id+'"]').innerText().catch(()=>'');
  record.turns.push(row);delete record.pending;await write(td+'/summary.json',row);await save();
  console.log('DONE',job.id,n,row.error|| (row.clarification?'clarification':'answer'),Math.round(row.elapsedMs/1000));
  if(terminal.error)throw Error('Product request failed: '+terminal.error);
  if(!terminal.result)throw Error('No product result');
  return {result,row,path:td};
 }
 try{
  await p.goto(base+'/?view=chat',{waitUntil:'domcontentloaded'});await p.getByLabel('向 OneEarth 提问',{exact:true}).waitFor();
  if(record.turns.length){
   await p.waitForFunction(sid=>history.state?.oneearthSession===sid && document.querySelectorAll('.message.user').length>0,record.sessionId,{timeout:20000});
   const restored=await p.locator('.message.user').allTextContents();
   if(!restored.some(t=>t.includes(record.first)))throw Error('Instrumentation: restored session does not contain the original first question');
  }
  let question=record.pending?.question||record.next||job.first,kind=record.pending?.kind||record.retryFailed?.kind|| (record.turns.length?'continuation':'natural-first');
  while(record.turns.length<6 && await control()){
   const last=await ask(question,kind,record.pending);
   if(!last.result.clarification){record.substantiveAnswers=(record.substantiveAnswers||0)+1;last.ui=await globe(p,last.path);record.globe=last.ui;await write(last.path+'/globe-state.json',last.ui);}
   const decision=await decide(job,record,last);record.inputIssues=[...new Set([...record.inputIssues,...(decision.inputIssues||[])])];
   for(const issue of decision.issues||[])if(!record.issues.some(i=>i.title===issue.title))record.issues.push({...issue,taskId:job.id,turn:record.turns.length,status:'candidate-model-tagged'});
   last.row.review=decision;await write(last.path+'/summary.json',last.row);
   if(record.followupSent && !last.result.clarification){record.protocolFinished=true;record.next=null;await save();break;}
   if(!last.result.clarification){record.followupSent=true;kind='natural-followup';}else kind='answer-oneearth-question';
   if(!decision.next && !record.protocolFinished)decision.next=last.result.clarification?'具体条件暂时不限定，请先按原问题回答能判断的部分。':'刚才这项判断有哪些直接证据，又有哪些限制？';
   question=decision.next;record.next=question;await save();
  }
  record.status=record.protocolFinished?'completed':halt?'interrupted':'clarification-limit';
  if(record.status==='clarification-limit')record.issues.push({category:'无效追问',title:'六轮输入后仍未形成有实质答复的连续对话',quote:record.turns.at(-1)?.message,expected:'按已知条件回答可答部分；未知条件明确保留',nature:'uncertain',confidence:'medium',taskId:job.id,status:'candidate-model-tagged'});
 }catch(e){record.status='execution-error';record.error=e.message;infraFailures++;console.log('TASK_ERROR',job.id,e.message);}
 finally{
  record.finished=now();await save().catch(()=>{});
  const esc=x=>String(x??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  await fs.writeFile(dir+'/conversation.html',`<!doctype html><meta charset="utf-8"><title>${job.id}</title><style>body{font:16px/1.8 system-ui;margin:36px auto;max-width:1100px;color:#183c32}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f7f4;padding:20px}.user{background:#e5efe9}img{max-width:100%}summary{cursor:pointer}</style><a href="../report.html">全部任务</a><h1>${job.id} · ${esc(job.domain)}</h1><p>${esc(record.status)} · ${record.started} — ${record.finished}</p>${record.turns.map(t=>`<h2>第 ${t.n} 轮 · ${esc(t.kind)} · ${esc(t.productVersion||'baseline-v1')}</h2><pre class="user">${esc(t.question)}</pre><pre>${esc(t.body||t.message||t.error)}</pre><details><summary>结构化记录与来源</summary><pre>${esc(JSON.stringify(t,null,2))}</pre><a href="turn-${t.n}/response.json.gz">完整返回数据 gzip</a></details>`).join('')}<h2>待核问题线索</h2><pre>${esc(JSON.stringify(record.issues,null,2))}</pre><h2>球上交互</h2><pre>${esc(JSON.stringify(record.globe,null,2))}</pre>`);
  if(record.status!=='interrupted'){await write(dir+'/complete.json',record);completed.set(job.id,record);}
  delete state.running[job.id];await report();await ctx.close();console.log('TASK_END',job.id,record.status,'ended='+[...completed.keys()].filter(id=>selectedIds.has(id)).length+'/'+queue.length);
 }
}
async function worker(n){while(cursor<queue.length && launched<limit && await control()){
 const job=queue[cursor++];if(!job)break;const old=completed.get(job.id);if(old&&old.status!=='execution-error')continue;
 if(old?.status==='execution-error'&&(process.env.SCINET_RETRY_ERRORS!=='1'||(old.failedAttempts?.length||0)>=maxRetries))continue;
 launched++;await task(job,n);
 if(infraFailures>=6){halt=true;await write(out+'/control.json',{pause:true,reason:'六个执行错误，需要排查，未执行任务不能计为完成。'});}
}}
try{await report();await Promise.all(Array.from({length:Number(process.env.SCINET_WORKERS)||3},(_,i)=>worker(i+1)));}finally{await browser.close();state.stopped=now();await report();}
console.log('BATCH_END',JSON.stringify(state));
