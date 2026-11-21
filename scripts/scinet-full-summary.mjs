import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const out=path.resolve('output/scinet-full-capability-2026-11-14');
const read=(p,f=null)=>fs.readFile(p,'utf8').then(JSON.parse).catch(()=>f);
const esc=x=>String(x??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const manifest=await read(out+'/manifest.json');
const canonicalFamilies=await read(out+'/issue-families.json',[]);
const coordinator=await read(out+'/coordinator-state.json',{});
const phase=coordinator.phase||{number:1,minId:1,maxId:706};
const exclusions=await read(out+'/instrument-exclusions.json',[]);
const spaces=['','shard-1','shard-2','shard-3'];
const records=new Map(),duplicates=[],running=[],reviews=[];
for(const space of spaces){
 const dir=path.join(out,space),status=await read(dir+'/progress.json');
 for(const [id,run] of Object.entries(status?.running||{}))running.push({id,space,...run});
 const review=await read(dir+'/reviewed-issues.json',[]);
 const reviewed=Array.isArray(review)?review:['issues','reviewed','productDefects','capabilityGaps','externalSourceFailures','unreasonableInputConditions','notConfirmed','rejectedCandidates'].flatMap(k=>Array.isArray(review[k])?review[k].map(i=>({...i,reviewBucket:k})):[]);
 reviews.push(...reviewed.map(i=>({...i,space,detail:i.detail||i.judgment||i.limits||i.expected,nature:i.nature||(i.classification?.startsWith('external')||i.reviewBucket==='externalSourceFailures'?'external':i.classification?.startsWith('input')||i.reviewBucket==='unreasonableInputConditions'?'input':i.classification?.startsWith('capability')||i.reviewBucket==='capabilityGaps'?'capability':i.reviewBucket==='productDefects'?'product':'uncertain')})));
 for(const name of await fs.readdir(dir).catch(()=>[])){
  if(!/^SN-\d{4}$/.test(name))continue;
  const complete=await read(path.join(dir,name,'complete.json'));
  const progress=complete||await read(path.join(dir,name,'progress.json'));if(!progress)continue;
  const row={...progress,ended:!!complete,folder:path.posix.join(space,name)};
  if(exclusions.some(e=>e.folder===row.folder&&e.started===row.started))continue;
  if(records.has(name)){duplicates.push({id:name,paths:[records.get(name).folder,row.folder]});if(!complete)continue;}
  records.set(name,row);
 }
}
const rows=[...records.values()].sort((a,b)=>a.id.localeCompare(b.id));
const ended=rows.filter(r=>r.ended),completed=ended.filter(r=>['completed','clarification-limit'].includes(r.status)),errors=ended.filter(r=>r.status==='execution-error');
const issues=rows.flatMap(r=>(r.issues||[]).map(i=>({...i,conversation:r.folder+'/conversation.html',raw:r.folder+'/turn-'+i.turn+'/response.json.gz'})));
const views=await read(out+'/conversation-views.json',{});
for(const r of ended){
 const checked=reviews.filter(i=>i.taskId===r.id||i.tasks?.includes(r.id));
 const grouped=canonicalFamilies.filter(i=>i.tasks?.includes(r.id));
 const viewKey='view-v5:'+r.finished+createHash('sha256').update(JSON.stringify({checked,grouped})).digest('hex');
 if(views[r.folder]===viewKey)continue;
 const turns=[];
 for(const t of r.turns||[]){
  const shot='turn-'+t.n+'/globe.png',hasShot=await fs.access(path.join(out,r.folder,shot)).then(()=>true).catch(()=>false);
  const hasGlobe=await fs.access(path.join(out,r.folder,'turn-'+t.n+'/globe-state.json')).then(()=>true).catch(()=>false);
  const refs=(t.references||[]).map((ref,i)=>`<li>${ref.url?`<a href="${esc(ref.url)}">${esc(ref.title)}</a>`:esc(ref.title)} <small>${esc(ref.source||ref.referenceType||ref.kind)}${ref.id?' · '+esc(ref.id):''}</small></li>`).join('');
  turns.push(`<section><h2>第 ${t.n} 轮 · ${t.clarification?'OneEarth 主动追问':'答复'} · ${Math.round((t.elapsedMs||0)/1000)} 秒 · ${esc(t.productVersion||'baseline-v1')}</h2><div class="user">${esc(t.question)}</div><details open><summary>答复文字记录（实际界面排版见截图）</summary><pre>${esc(t.message||t.body||t.error)}</pre></details>${hasShot?`<figure><a href="${shot}"><img loading="lazy" src="${shot}" alt="${r.id} 第${t.n}轮球上联动截图"></a><figcaption>实际球上联动截图 · 点击查看原图</figcaption></figure>`:''}<details><summary>本轮引用 ${t.references?.length||0} 条</summary><ol>${refs}</ol></details><p><a href="turn-${t.n}/summary.json">对话与状态</a>${hasGlobe?` · <a href="turn-${t.n}/globe-state.json">本轮悬停、速览与定位完整状态</a>`:''} · <a href="turn-${t.n}/request.json">实际请求</a> · <a href="turn-${t.n}/response.json.gz">完整响应压缩记录</a></p></section>`);
 }
 await fs.writeFile(path.join(out,r.folder,'review.html'),`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${r.id} · OneEarth 能力探查</title><style>body{font:16px/1.8 system-ui;max-width:1180px;margin:32px auto;padding:0 20px;color:#193f35;background:#f5f8f6}section{background:white;border:1px solid #dae5de;border-radius:14px;padding:24px;margin:24px 0}.user{background:#e5efe8;border-radius:12px;padding:18px;white-space:pre-wrap}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}summary{cursor:pointer;margin:18px 0;color:#3e6b57}img{max-width:100%;border:1px solid #ddd;border-radius:10px}figure{margin:20px 0}figcaption,small{color:#6f8176;font-size:13px}a{color:#1b7760}</style><a href="${'../'.repeat(r.folder.split('/').length)}report.html">全部706题进度</a><h1>${r.id} · ${esc(r.domain)}</h1><p>实际流程状态：${esc(r.status)}。流程结束不代表能力合格；问题和来源故障分别记录。</p>${turns.join('')}${r.failedAttempts?.length?`<section><h2>失败与重试记录</h2>${r.failedAttempts.map(a=>`<p>第${a.n}轮 · ${esc(a.error)} · <a href="${esc(a.archive)}/response.json.gz">原始失败响应</a> · <a href="${esc(a.archive)}/request.json">原始请求</a></p>`).join('')}</section>`:''}<section><h2>自动标注的问题线索（须结合汇总中的复核结论）</h2><pre>${esc(JSON.stringify(r.issues,null,2))}</pre><h2>题表条件检查</h2><pre>${esc(JSON.stringify(r.inputIssues,null,2))}</pre></section></html>`);
 const viewPath=path.join(out,r.folder,'review.html');
 const text=await fs.readFile(viewPath,'utf8');
 const reviewMarkup=`<section><h2>复核结论</h2><p>原始模型线索可能被否定或归并，以下结论优先。</p>${grouped.map(i=>`<h3>${esc(i.id+' · '+i.title)}</h3><p>${esc(i.detail)}</p><small>${esc(i.status+' · '+i.nature)}</small>${i.repair?`<p>修复进展：${esc(i.repair.version)} · ${esc(i.repair.status)}</p>`:''}`).join('')}${checked.map(i=>`<details><summary>${esc(i.title||i.id||i.classification)} · ${esc(i.status||i.reviewBucket)}</summary><pre>${esc(JSON.stringify(i,null,2))}</pre></details>`).join('')||(!grouped.length?'<p>本题尚无已提交的二次证据复核记录。</p>':'')}</section>`;
 await fs.writeFile(viewPath,text.replace('<section><h2>自动标注的问题线索',reviewMarkup+'<section><h2>自动标注的问题线索'));
 views[r.folder]=viewKey;
}
await fs.writeFile(out+'/conversation-views.json.'+process.pid,JSON.stringify(views));await fs.rename(out+'/conversation-views.json.'+process.pid,out+'/conversation-views.json');
const sourceHealth={};
for(const row of rows)for(const turn of row.turns||[])for(const s of turn.sourceStatus||[]){const t=sourceHealth[s.engine]||={done:0,failed:0,hits:0,errors:{}};t[s.status]=(t[s.status]||0)+1;t.hits+=s.hits||0;if(s.error)t.errors[s.error]=(t.errors[s.error]||0)+1;}
const audits=await read(out+'/turn-audits.json',{}),toolHealth={};
for(const row of rows)for(const turn of row.turns||[]){
 const key=row.folder+'/turn-'+turn.n;
 if(!audits[key] || audits[key].deliveryId!==turn.deliveryId)try{
  const raw=JSON.parse(gunzipSync(await fs.readFile(path.join(out,key,'response.json.gz'))).toString()),r=raw.result;
  audits[key]={taskId:row.id,turn:turn.n,deliveryId:turn.deliveryId,clarification:!!r?.clarification,error:raw.error,executorDiagnostic:raw.executorDiagnostic,elapsedMs:turn.elapsedMs,tools:r?.runTrace?.calls?.map(c=>({name:c.name,kind:c.kind,status:c.status,error:c.error}))||raw.runTrace?.calls?.map(c=>({name:c.name,kind:c.kind,status:c.status,error:c.error})),citedAssets:r?.answerNotes?.sources?.length||0,citedWeb:r?.answerNotes?.references?.filter(r=>r.kind==='web').length||0,readPages:r?.answerNotes?.webSources?.filter(h=>h.pageExcerpt)?.length||0};
 }catch{}
 for(const call of audits[key]?.tools||[]){const t=toolHealth[call.kind+' · '+call.name]||={done:0,failed:0,partial:0,errors:{}};t[call.status]=(t[call.status]||0)+1;if(call.error)t.errors[call.error]=(t.errors[call.error]||0)+1;}
}
await fs.writeFile(out+'/turn-audits.json.'+process.pid,JSON.stringify(audits,null,2));await fs.rename(out+'/turn-audits.json.'+process.pid,out+'/turn-audits.json');
const signatures=[];
for(const r of rows)for(const t of r.turns||[]){
 const m=t.workspace?.mapResult,a=audits[r.folder+'/turn-'+t.n];
 if(a?.tools?.some(c=>c.name==='resolve_dataset'&&c.status==='failed'&&c.error?.includes('该 DOI 不在库内')))
  signatures.push({family:'F05',taskId:r.id,turn:t.n,status:'matching-error-signature',evidence:r.folder+'/turn-'+t.n+'/response.json.gz'});
 if(a&&!a.clarification&&a.citedAssets===0&&m?.answerId===t.deliveryId&&m.ids?.length&&t.body?.includes('球上编号对应正文引用'))
  signatures.push({family:'F02',taskId:r.id,turn:t.n,status:'observable-consistency-candidate',mapIdCount:m.ids.length,citedAssets:0,deliveryId:t.deliveryId,evidence:r.folder+'/turn-'+t.n+'/summary.json'});
}
for(const r of rows){const g=r.globe;if(g?.inspector?.some(s=>/官方元数据标注全球范围|官方边界框/.test(s))&&g.hover?.locationNote?.some(s=>/尚无已核实的坐标或覆盖范围/.test(s))&&g.flyLabel===null)
 signatures.push({family:'F03',taskId:r.id,status:'observable-consistency-candidate',assetId:g.assetId,evidence:r.folder+'/'+(r.ended?'complete':'progress')+'.json#globe'});}
await fs.writeFile(out+'/behavior-signatures.json',JSON.stringify(signatures,null,2));
const times=rows.flatMap(r=>(r.turns||[]).map(t=>t.elapsedMs).filter(Number.isFinite)).sort((a,b)=>a-b);
const productVersions={};for(const row of rows)for(const turn of row.turns||[]){const v=turn.productVersion||'baseline-v1';productVersions[v]=(productVersions[v]||0)+1;}
const summary={productVersions,updated:new Date().toISOString(),total:706,started:records.size,completed:completed.length,ended:ended.length,executionErrors:errors.length,unresolved:ended.length-completed.length-errors.length,remaining:706-completed.length,turns:rows.reduce((n,r)=>n+(r.turns?.length||0),0),candidateIssues:issues.length,reviewedIssues:reviews.length,running,duplicates,sourceHealth,toolHealth,responseTimeSeconds:{samples:times.length,median:Math.round((times[Math.floor(times.length*.5)]||0)/1000),p90:Math.round((times[Math.floor(times.length*.9)]||0)/1000),max:Math.round((times.at(-1)||0)/1000)},counts:{}};
summary.executionFailureAttempts=rows.reduce((n,r)=>n+(r.failedAttempts?.length||0)+(r.status==='execution-error'?1:0),0);
summary.completedDialogues=ended.filter(r=>r.status==='completed').length;summary.clarificationLimited=ended.filter(r=>r.status==='clarification-limit').length;
const phaseRows=rows.filter(r=>Number(r.id.slice(3))>=phase.minId&&Number(r.id.slice(3))<=phase.maxId);
summary.phase={...phase,total:phase.maxId-phase.minId+1,started:phaseRows.length,ended:phaseRows.filter(r=>r.ended).length,completed:phaseRows.filter(r=>r.ended&&['completed','clarification-limit'].includes(r.status)).length,completedDialogues:phaseRows.filter(r=>r.ended&&r.status==='completed').length,executionErrors:phaseRows.filter(r=>r.ended&&r.status==='execution-error').length};
for(const r of rows){const target=summary.counts[r.domain]||={started:0,completed:0};target.started++;if(['completed','clarification-limit'].includes(r.status)&&r.ended)target.completed++;}
await fs.writeFile(out+'/aggregate-progress.json',JSON.stringify(summary,null,2));
await fs.writeFile(out+'/all-issues.json',JSON.stringify({updated:summary.updated,reviewed:reviews,candidates:issues},null,2));
await fs.writeFile(out+'/coverage.json',JSON.stringify(manifest.tasks.map(t=>({id:t.id,domain:t.domain,first:t.first,status:records.get(t.id)?.status||'not-started',tested:['completed','clarification-limit'].includes(records.get(t.id)?.status)&&records.get(t.id)?.ended||false,conversationCompleted:records.get(t.id)?.status==='completed'&&records.get(t.id)?.ended||false,conversation:records.get(t.id)?.ended?records.get(t.id)?.folder+'/conversation.html':undefined})),null,2));
const families=canonicalFamilies.length?canonicalFamilies:reviews;
const phaseReviewPublished=await fs.access(out+'/phase-1-review.html').then(()=>true).catch(()=>false);
const optimizationPublished=await fs.access(out+'/../scinet-optimization-2026-11-14/review.html').then(()=>true).catch(()=>false);
const cards=families.map(i=>`<article><b>${esc(i.id||i.title||i.classification)} · ${esc(i.priority||'记录')}</b><p>${esc(i.title)}</p><p>${esc(i.detail||i.quote||i.evidence)}</p>${i.repair?`<p><b>修复进展：</b>${esc(i.repair.version)} · ${esc(i.repair.status)}</p>`:''}${i.preparedRepair?`<p><b>准备中的修复：</b>${esc(i.preparedRepair.state)}</p>`:''}<small>${esc(i.nature)} · ${esc(i.status)} · ${(i.tasks||[i.taskId]).filter(Boolean).map(id=>records.get(id)?.ended?`<a href="${records.get(id).folder}/review.html">${esc(id)}</a>`:esc(id)).join('、')}</small></article>`).join('');
const html=`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>OneEarth 706 题 · 问题发现</title><style>body{font:15px/1.65 system-ui;margin:32px;color:#193e34;background:#f5f8f7}h1{font-size:28px}.stats{display:flex;gap:16px;flex-wrap:wrap}.stats div,article{padding:16px 24px;background:white;border:1px solid #dae5df;border-radius:10px}.stats strong{font-size:26px;display:block}table{border-collapse:collapse;background:white;width:100%;font-size:14px}td,th{padding:12px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}td:nth-child(3){max-width:480px}input{padding:12px;width:min(700px,90%);margin:20px 0;border:1px solid #becdc3;border-radius:8px}a{color:#1b7760}.note{color:#65786f}.issues{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}summary{cursor:pointer}</style><h1>OneEarth 706 题能力探查 · 第 ${summary.phase.number} 阶段</h1><p>本阶段题号 ${String(summary.phase.minId).padStart(4,'0')}—${String(summary.phase.maxId).padStart(4,'0')}；完成后先复盘，再安排后续阶段。</p><p class="note">用自然首问、主动追问与连续对话发现问题，不生成验收分数。全部题号均保留逐题覆盖状态；没有完成的不会记为完成。</p><div class="stats"><div><strong>${summary.phase.completed} / ${summary.phase.total}</strong>本阶段完成能力探查（含澄清卡住）</div><div><strong>${summary.turns}</strong>真实输入轮次</div><div><strong>${issues.length}</strong>候选问题线索</div><div><strong>${reviews.length}</strong>已复核记录</div></div><p>更新时间 ${summary.updated} · 运行中 ${running.map(r=>r.id+'（第'+r.turn+'轮）').join('、')||'无'} · 执行错误 ${errors.length} · 本阶段未完整结束 ${summary.phase.total-summary.phase.completed} · 全量累计完成 ${summary.completed}/706，尚未完整结束 ${summary.remaining} · 历史执行失败尝试 ${summary.executionFailureAttempts}</p><p><a href="coverage.json">706 题逐题覆盖记录</a> · <a href="all-issues.json">问题与证据索引</a> · <a href="aggregate-progress.json">运行及来源状态</a></p><p>逐轮产品版本：${esc(JSON.stringify(productVersions))}。保留旧版结果，修复后的问题继续在新版探查，不将混合版本当成固定版本评分。</p>${phaseReviewPublished?'<p><a href="phase-1-review.html">查看首批200题完整复盘</a></p>':''}${optimizationPublished?'<p><a href="../scinet-optimization-2026-11-14/review.html">查看复盘后修复与当前部署进展</a></p>':''}<h2>已复核的问题</h2><div class="issues">${cards||'<p>尚未有复核记录。</p>'}</div><h2>实际对话</h2><input placeholder="按题号、领域、问题或候选缺陷筛选" oninput="document.querySelectorAll('tbody tr').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(this.value.toLowerCase()))"><table><thead><tr><th>任务</th><th>领域</th><th>自然首问</th><th>轮次 / 状态</th><th>问题线索</th><th>证据</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.id}</td><td>${esc(r.domain)}</td><td>${esc(r.first)}</td><td>${r.turns.length} / ${esc(r.status)}</td><td>${(r.issues||[]).map(i=>esc(i.category+'：'+i.title)).join('<br>')}</td><td>${r.ended?`<a href="${r.folder}/review.html">对话与来源</a>`:'执行中'}</td></tr>`).join('')}</tbody></table><details><summary>来源工具状态（故障不自动等于产品缺陷）</summary><pre>${esc(JSON.stringify(sourceHealth,null,2))}</pre></details></html>`;
await fs.writeFile(out+'/report.html',html);
console.log(JSON.stringify({completed:summary.completed,total:706,turns:summary.turns,candidates:issues.length,reviewed:reviews.length,running:running.map(r=>r.id),duplicates}));
