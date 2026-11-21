import {parse} from "csv-parse/sync";
import type {SearchQuery,WebHit} from "../src/domain/types";
import {fetchSource,type SourceRequest} from "./source-fetch";

const manifestLimit=256*1024,indexLimit=128*1024;
/** Only public, explicitly identified Zenodo records; never infer a record from a bare number/title. */
export function zenodoRecordId(hit:WebHit){
  const doi=hit.doi?.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,"").replace(/^doi:/i,"");
  const fromDoi=doi?.match(/^10\.5281\/zenodo\.(\d+)$/i)?.[1];
  let fromUrl:string|undefined;
  try{const u=new URL(hit.url);if(u.protocol!=="https:"||u.username||u.password||u.port)return;
    if(u.hostname==="zenodo.org")fromUrl=u.pathname.match(/^\/(?:records?|api\/records)\/(\d+)\/?$/)?.[1];
    else if(u.hostname==="doi.org")fromUrl=u.pathname.match(/^\/10\.5281\/zenodo\.(\d+)$/i)?.[1];
  }catch{return;}
  if(fromDoi&&fromUrl&&fromDoi!==fromUrl)return;
  return fromDoi||fromUrl;
}
/** An explicit user/search-plan identifier does not depend on successful general search or page ranking. */
export function explicitArchiveTarget(queries:SearchQuery[]):WebHit|undefined{
  const text=queries.map(q=>q.web+" "+q.dataset).join("\n");
  const id=text.match(/\b10\.5281\/zenodo\.(\d+)\b/i)?.[1]||text.match(/https:\/\/zenodo\.org\/(?:records?|api\/records)\/(\d+)\b/i)?.[1];
  if(!id)return;
  return {title:"指定 Zenodo 记录 "+id,url:"https://zenodo.org/records/"+id,doi:"10.5281/zenodo."+id,snippet:"指定归档标识；内容待实际读取。",referenceType:"data"};
}
export type PriorArchiveTarget={url:string;title:string;excerpt:string};
export function priorArchiveTarget(question:string,targets:PriorArchiveTarget[]=[]):WebHit|undefined{
  if(!/(?:你(?:刚才)?提到|此前|前面|刚才|上述|这份|该(?:份)?资料|这个(?:数据|例子)|the (?:previous|same|above)|you (?:mentioned|cited))/i.test(question))return;
  if(/(?:换(?:一份|一个|到|成|个话题)|改看|转向|不再(?:看|用)|不要(?:看|用|沿用)(?:刚才|此前|这|该)|new topic|instead|switch)/i.test(question))return;
  const unique=new Map<string,WebHit>();
  for(const target of targets){
    const candidate:WebHit={title:target.title,url:target.url,snippet:"此前实际读取资料的明确指代；附件内容待本轮核对。",referenceType:"data"};
    const id=zenodoRecordId(candidate);if(id)unique.set(id,candidate);
  }
  return unique.size===1?[...unique.values()][0]:undefined;
}
type FileEntry={key:string;size:number};
function object(value:unknown):Record<string,unknown>{return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function doiId(value:unknown){return typeof value==='string'?value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').match(/^10\.5281\/zenodo\.(\d+)$/i)?.[1]:undefined;}
function identifier(value:unknown){return /^(?:[1-9]\d*)$/.test(String(value))?String(value):undefined;}
export type ArchiveReadOptions={question?:string;fileName?:string};
/** A concept may resolve only when both official concept identifiers agree; a pinned record never moves. */
function archiveIdentity(data:Record<string,unknown>,requested:string,hit:WebHit){
  const resolved=identifier(data.id),metadata=object(data.metadata);
  const doiValues=[data.doi,metadata.doi,object(object(data.pids).doi).identifier].filter(v=>v!==undefined&&v!==null&&v!=='');
  if(!resolved||doiValues.some(v=>doiId(v)!==resolved))throw Error('归档 API 返回的版本记录与 DOI 不一致，未继续读取附件。');
  const concept=identifier(data.conceptrecid),conceptDoi=doiId(data.conceptdoi);
  if((data.conceptrecid&&!concept)||(data.conceptdoi&&!conceptDoi)||(concept&&conceptDoi&&concept!==conceptDoi))throw Error('归档概念 DOI 与概念记录不一致。');
  if(resolved!==requested && !(concept===requested&&conceptDoi===requested&&doiValues.length))
    throw Error('归档 API 返回的版本记录与指定记录不一致，未继续读取附件。');
  const version=typeof metadata.version==='string'?metadata.version:undefined;
  if(hit.version && hit.version!==version)throw Error('归档 API 返回的版本标签与指定版本不一致，未继续读取附件。');
  return {requestedRecord:requested,resolvedRecord:resolved,recordDoi:'10.5281/zenodo.'+resolved,conceptRecord:concept,conceptDoi:conceptDoi?'10.5281/zenodo.'+conceptDoi:undefined,version,resolution:resolved===requested?'exact-record':'concept-to-version'};
}
function indexFile(f:FileEntry){return /\.(csv|tsv)$/i.test(f.key)&&/(?:metadata|index|manifest|sample|specimen|attribute|schema|dictionary|元数据|索引|字段)/i.test(f.key);}
function guideFile(f:FileEntry){return /\.(?:txt|md|markdown)$/i.test(f.key)&&/(?:readme|read.me|description|guide|schema|dictionary|说明|字段|索引)/i.test(f.key);}

export type ArchiveReadResult={hits:WebHit[];requestUrl:string;warning:string;identity?:ReturnType<typeof archiveIdentity>;manifest?:{files:FileEntry[];totalFiles:number;complete:boolean;omittedInvalidEntries:number};attachmentTargets?:WebHit[]};

/** Read the complete bounded manifest and at most one small text/index file. Targets are NOT read evidence. */
export async function readArchiveIndex(hit:WebHit,signal:AbortSignal,request?:SourceRequest,options:ArchiveReadOptions={}):Promise<ArchiveReadResult>{
  const id=zenodoRecordId(hit);if(!id)throw Error('未取得一致的公开 Zenodo 记录标识。');
  const requestedApi='https://zenodo.org/api/records/'+id;
  const manifest=await fetchSource(requestedApi,signal,request,{maxBytes:manifestLimit});
  if(manifest.truncated||manifest.bytes.length>manifestLimit)throw Error('归档文件清单超过本轮读取上限。');
  if(!/^application\/(?:json|[^;]+\+json)(?:;|$)/i.test(manifest.headers['content-type']||''))throw Error('归档 API 未返回 JSON 文件清单。');
  const data=object(JSON.parse(manifest.bytes.toString('utf8'))),identity=archiveIdentity(data,id,hit);
  const api='https://zenodo.org/api/records/'+identity.resolvedRecord;
  const container=object(data.files),entries=Array.isArray(data.files)?data.files:Object.values(object(container.entries));
  if(!Array.isArray(data.files)&&!container.entries)throw Error('归档 API 未提供可核对的文件清单。');
  const files=entries.map(object).filter(f=>typeof f.key==='string'&&f.key.length<=240&&typeof f.size==='number'&&Number.isSafeInteger(f.size)&&f.size>=0)
    .map(f=>({key:f.key as string,size:f.size as number}));
  const omittedInvalidEntries=entries.length-files.length;
  const total=typeof container.count==='number'?container.count:typeof container.total==='number'?container.total:entries.length;
  const complete=!object(container.links).next&&!container.next&&total===entries.length&&omittedInvalidEntries===0;
  const title=String(object(data.metadata).title||hit.title).slice(0,360),question=options.question||'';
  const explicit=files.filter(f=>options.fileName?f.key===options.fileName:question.toLowerCase().includes(f.key.toLowerCase()));
  const selected=files.filter(f=>f.size>0&&f.size<=indexLimit&&(/\.(csv|tsv)$/i.test(f.key)||/\.(txt|md|markdown)$/i.test(f.key)))
    .filter(f=>explicit.includes(f)||indexFile(f)||guideFile(f))
    .sort((a,b)=>Number(explicit.includes(b))-Number(explicit.includes(a))||Number(guideFile(b))-Number(guideFile(a))||Number(/raw.*metadata/i.test(b.key))-Number(/raw.*metadata/i.test(a.key))||a.size-b.size)[0];
  const fileUrl=(f:FileEntry)=>api+'/files/'+encodeURIComponent(f.key)+'/content';
  const attachmentTargets:WebHit[]=explicit.filter(f=>/\.pdf$/i.test(f.key)).slice(0,1).map(f=>({title:title+' · '+f.key,url:fileUrl(f),doi:identity.recordDoi,version:identity.version,snippet:'仅由官方归档清单确认的指定 PDF 文件；内容尚未读取。',referenceType:'data'}));
  // Filename evidence is existence evidence, independently bounded from detailed metadata and file content.
  const requestedYears=new Set<string>();
  for(const m of question.matchAll(/\b((?:1|2)\d{3})\s*年?\s*[—–~至到-]\s*((?:1|2)\d{3})/g)){
    const start=Number(m[1]),end=Number(m[2]);
    if(end>=start&&end-start<=40)for(let year=start;year<=end;year++)requestedYears.add(String(year));
  }
  for(const year of question.match(/\b(?:1|2)\d{3}\b/g)||[])requestedYears.add(year);
  const fileTerms=[...new Set((question.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g)||[]))].slice(0,24);
  const rank=(f:FileEntry)=>Number(explicit.includes(f))*1000+[...requestedYears].filter(y=>f.key.includes(y)).length*100+fileTerms.filter(t=>f.key.toLowerCase().includes(t)).length;
  const rankedFiles=files.map((f,index)=>({f,index})).sort((a,b)=>rank(b.f)-rank(a.f)||a.index-b.index).map(x=>x.f);
  const fileNames:string[]=[];let nameChars=2;
  for(const f of rankedFiles){const chars=Buffer.byteLength(JSON.stringify(f.key),'utf8')+1;if(fileNames.length>=80||nameChars+chars>12*1024)continue;fileNames.push(f.key);nameChars+=chars;}
  const fileIndexComplete=complete&&fileNames.length===files.length;
  const omittedNames=Math.max(0,total-fileNames.length);
  const visible=[...new Map([...rankedFiles.slice(0,8),...explicit.slice(0,2),...(selected?[selected]:[])].map(f=>[f.key,f])).values()];
  const manifestSummary={...identity,files:visible,totalFiles:total,listedFiles:files.length,manifestComplete:complete,omittedFromExcerpt:files.length-visible.length,omittedInvalidEntries,selectedIndex:selected||null};
  const manifestHit:WebHit={manifestIndex:{names:fileNames,sourceTotal:total,namesComplete:fileIndexComplete,contentsRead:false},title:title+' · 官方文件清单',url:api,doi:identity.recordDoi,version:identity.version,snippet:'已实际读取官方 API 文件清单；文件存在不等于内容已核实。',pageExcerpt:'实际读取官方归档 API 文件清单；文件名仅证明存在，不代表内容已读。索引可能截断，只有末尾fileIndexComplete=true且omittedNames=0才可判断名称是否未列。\n'+JSON.stringify({resolvedRecord:identity.resolvedRecord,fileNames,fileIndexComplete,omittedNames,totalFiles:total})+'\n[详细条目摘要]\n'+JSON.stringify(manifestSummary)+'\nmanifestComplete仅表示API清单完整；详细条目摘要仍可能省略，不可由摘要未见断言文件不存在。未读取压缩包、原始图像或其他文件。',referenceType:'data'};
  const base={requestUrl:requestedApi,identity,manifest:{files,totalFiles:total,complete,omittedInvalidEntries},attachmentTargets};
  if(!selected)return {...base,hits:[manifestHit],warning:'已读取文件清单；未发现符合本轮128KiB上限的明确小型说明/字段索引，未下载大型附件。'};
  try{
    const file=await fetchSource(fileUrl(selected),signal,request,{maxBytes:indexLimit});
    if(file.truncated||file.bytes.length>indexLimit)throw Error('索引文件超过本轮128KiB读取上限。');
    if(!/^(?:text\/(?:plain|markdown|csv|tab-separated-values)|application\/(?:csv|octet-stream))(?:;|$)/i.test(file.headers['content-type']||''))throw Error('索引入口未返回CSV/TSV或说明文本。');
    if(file.bytes.includes(0))throw Error('索引包含二进制字节，未作为文本解析。');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(file.bytes);
    if(/^\s*(?:<!doctype html|<html|<body)\b/i.test(text))throw Error('索引入口返回了HTML页面，未作为文件正文。');
    let excerpt:string;
    if(/\.(?:txt|md|markdown)$/i.test(selected.key)){
      if(!text.trim())throw Error('说明文件无可读取文本。');
      excerpt='实际读取官方归档说明文件。\n'+JSON.stringify({...identity,file:selected.key,bytesRead:file.bytes.length,characters:text.length,excerptCharacters:Math.min(text.length,10000),contentTruncated:text.length>10000})+'\n[文件正文开始]\n'+text.slice(0,10000)+'\n[文件正文结束]\n仅此说明文件内容已读；提到的其他附件未因此成为已读证据。';
    }else{
      const rows=parse(text,{bom:true,delimiter:/\.tsv$/i.test(selected.key)?'\t':',',to:4,max_record_size:16000,skip_empty_lines:true}) as string[][];
      if(rows.length<2||rows[0].length<2||rows.some(r=>r.length!==rows[0].length))throw Error('索引未取得一致的表头与数据行。');
      const columns=rows[0].slice(0,16),sample=rows.slice(1).map(row=>row.slice(0,16).map(v=>v.slice(0,180)));
      const clippedCells=rows.slice(0,4).reduce((n,row)=>n+row.slice(0,16).filter(v=>v.length>180).length,0);
      const record={...identity,archiveRecord:identity.resolvedRecord,file:selected.key,bytesRead:file.bytes.length,columns:columns.map(v=>v.slice(0,180)),rows:sample,rowNumbers:sample.map((_,i)=>i+2),omittedColumns:Math.max(0,rows[0].length-columns.length),clippedCells};
      while(JSON.stringify(record).length>10000&&record.rows.length){record.rows.pop();record.rowNumbers.pop();}
      excerpt='实际读取公开CSV/TSV索引，以下为原文件表头和最多前三条数据记录（记录序号含表头；不是物理行号）。\n'+JSON.stringify(record)+'\n索引字段仅按原值报告；文件名不是实体样品唯一标识。未打开DM3/图像或压缩包，不能据索引声称已验证图像内容、嵌入标尺或制样批次。';
    }
    return {...base,hits:[manifestHit,{title:title+' · '+selected.key,url:fileUrl(selected),doi:identity.recordDoi,version:identity.version,snippet:'已实际读取小型说明文件或索引的有界内容。',pageExcerpt:excerpt,referenceType:'data' as const}],warning:'归档读取仅含官方清单与一个小型说明/索引；未下载大压缩包或打开原图。'};
  }catch(error){signal.throwIfAborted();return {...base,hits:[manifestHit],warning:'已读取文件清单；索引读取未完成：'+(error instanceof Error?error.message:'读取失败')};}
}
