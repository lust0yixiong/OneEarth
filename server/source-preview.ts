import { pdfChunkSize, pdfRangeReader, readPdfSnapshot, type RemotePdf } from "./pdf-ranges";
import {Router} from 'express';
import {load} from 'cheerio';
import {Readability} from '@mozilla/readability';
import JSDOMParser from '@mozilla/readability/JSDOMParser.js';
import {mkdir,readdir,rename,rm,stat,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fetchSource,sourceUrl,type SourceRequest,type SourceResponse} from './source-fetch';
import {SourceReadError} from './source-read-error';
import {classifyContentType,decoderForCharset,parseCharset} from './upstream/harness-fetch-policy';
import type {SourcePreview} from '../src/domain/source-preview';

function completeRange(response: SourceResponse) {
  return response.headers['content-range'] === 'bytes 0-' + (response.bytes.length - 1) + '/' + response.bytes.length;
}

function isMarkdown(response: SourceResponse) {
  const mime = (response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (['text/markdown', 'text/x-markdown', 'application/markdown'].includes(mime)) return true;
  if (mime && !['text/plain', 'application/octet-stream'].includes(mime)) return false;
  const disposition = response.headers['content-disposition'] || '';
  const filename = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^;"']+)/i)?.[1]?.trim();
  const markdownName = /\.(md|markdown|mdown|mkd)$/i;
  return (markdownName.test(new URL(response.url).pathname) || markdownName.test(filename || ''))
    && !response.bytes.includes(0) && !/^\s*<(?:!doctype|html)\b/i.test(response.bytes.subarray(0,256).toString());
}

function sourceText(response:SourceResponse){
  const header=response.headers['content-type']||'';
  const meta=response.bytes.subarray(0,4096).toString('latin1').match(/<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i)?.[1];
  return decoderForCharset(parseCharset(header)||meta).decode(response.bytes);
}
const clean=(value:string)=>value.replace(/\s+/g,' ').trim();
function link(raw:string|undefined,base:string){try{return sourceUrl(new URL(raw||'',base).href).href;}catch{return null;}}
export function extractSourceHtml(html:string,url:string){
  const $=load(html),title=clean($('title').first().text()) || new URL(url).hostname;
  if(/^(just a moment|access denied|attention required|request rejected|robot check|verify you are human|forbidden)\b/i.test(title) || $('#challenge-form,.cf-challenge-running').length)
    throw new SourceReadError('来源站点要求验证或限制自动读取。','SOURCE_ACCESS_RESTRICTED');
  const pdfLinks:{title:string;url:string}[]=[],links:{title:string;url:string}[]=[];
  function addPdf(raw:string|undefined,label:string){const target=link(raw,url);if(target && !pdfLinks.some(v=>v.url===target))pdfLinks.push({title:clean(label).slice(0,160)||'PDF 原文',url:target});}
  $('meta').each((_i,el)=>{if(($(el).attr('name')||'').toLowerCase()==='citation_pdf_url')addPdf($(el).attr('content'),'PDF 原文');});
  $('a[href],link[type="application/pdf"]').each((_i,el)=>{
    const target=link($(el).attr('href'),url);
    if(target && (/\.pdf(?:$|[?#])/i.test(target)||$(el).attr('type')==='application/pdf'))addPdf(target,$(el).text()||'PDF 原文');
  });
  const description=$('meta[name=description],meta[property="og:description"]').first().attr('content');
  $('script,style,noscript,nav,header,footer,aside,form,template,iframe,button,[hidden],[aria-hidden=true]').remove();
  let content='',label='网页正文摘录';
  try{
    const document=new JSDOMParser().parse($.xml(),url);
    const article=new Readability(document,{charThreshold:120,maxElemsToParse:20000}).parse();
    if(article?.content && (article.length||0)>=120)content=article.content;
  }catch{/* Small catalogue pages can be readable without satisfying article heuristics. */}
  if(!content){
    const root=$('article,main,[role=main],#content,#main-content').first();
    content=root.length?$.html(root):$('body').html()||'';
  }
  const article=load(content);
  let paragraphs=article('p,h1,h2,h3,h4,li,pre,blockquote').toArray()
    .filter(el=>!article(el).parents('li,pre,blockquote').length)
    .map(el=>clean(article(el).text())).filter(text=>text.length>2);
  paragraphs=[...new Set(paragraphs)];
  if(!paragraphs.length){const text=clean(article.text());if(text.length>=40)paragraphs=[text];}
  if(!paragraphs.length && description){paragraphs=[clean(description)];label='发布方页面摘要';}
  article('a[href]').each((_i,el)=>{
    const raw=article(el).attr('href');if(!raw||raw.startsWith('#'))return;
    const target=link(raw,url),text=clean(article(el).text());
    if(target && target!==url && text.length>2 && !links.some(v=>v.url===target))links.push({title:text.slice(0,160),url:target});
  });
  return {title,paragraphs:paragraphs.slice(0,200).map(p=>p.slice(0,5000)),label,
    truncated:paragraphs.length>200 || paragraphs.some(p=>p.length>5000),pdfLinks:pdfLinks.slice(0,8),links:links.slice(0,16)};
}
function canEmbed(response:SourceResponse){
  const frame=(response.headers['x-frame-options']||'').toLowerCase(),policy=response.headers['content-security-policy']||'';
  return !/deny|sameorigin/.test(frame) && !/frame-ancestors\b/i.test(policy);
}
function previewTarget(url:string) {
  const target=new URL(url);
  if(target.hostname==='github.com' && /^\/[^/]+\/[^/]+\/blob\/.+\.(md|markdown)$/i.test(target.pathname)){
    target.hostname='raw.githubusercontent.com';
    target.pathname=target.pathname.replace(/^(\/[^/]+\/[^/]+)\/blob\//,'$1/');
    target.search='';
  }
  return target;
}
export function sourcePreview(directory:string,options:{request?:SourceRequest;timeoutMs?:number}={}){
  const router=Router(),cache=new Map<string,{at:number;value:SourcePreview}>(),pending=new Map<string,Promise<SourcePreview>>();
  type Opening={url:string;disposition:'preview'|'external'};
  const checks=new Map<string,{at:number;value:Opening}>(),checking=new Map<string,Promise<Opening>>();
  let checkActive=0;
  const checkQueue:(()=>void)[]=[];
  async function check(url:string):Promise<Opening>{
    const saved=checks.get(url);
    if(saved && Date.now()-saved.at<600000)return saved.value;
    if(checking.has(url))return checking.get(url)!;
    const task=(async()=>{
      if(checkActive>=3)await new Promise<void>(resolve=>checkQueue.push(resolve));
      checkActive++;
      let disposition:Opening['disposition']='external';
      try{
        const signal=AbortSignal.timeout(Math.min(options.timeoutMs??6000,6000)),target=previewTarget(url).href;
        const response=await fetchSource(target,signal,options.request,{range:'bytes=0-2047',maxBytes:4*1024*1024}).catch(error=>{
          if(error instanceof SourceReadError && error.code==='SOURCE_HTTP_416')return fetchSource(target,signal,options.request,{maxBytes:4*1024*1024});
          throw error;
        });
        if(response.bytes.subarray(0,1024).includes(Buffer.from('%PDF-')) || isMarkdown(response))disposition='preview';
        else if(classifyContentType(response.headers['content-type']||null)==='html' && canEmbed(response)){
          extractSourceHtml(sourceText(response),response.url);
          disposition='preview';
        }
        const value={url,disposition};
        checks.set(url,{at:Date.now(),value});
        if(checks.size>256)checks.delete(checks.keys().next().value!);
        return value;
      }catch(error){
        const value:Opening={url,disposition:'external'};
        // Determinate upstream refusals can be reused, network outages get another chance.
        if(error instanceof SourceReadError){checks.set(url,{at:Date.now(),value});if(checks.size>256)checks.delete(checks.keys().next().value!);}
        return value;
      }finally{checkActive--;checkQueue.shift()?.();checking.delete(url);}
    })();
    checking.set(url,task);
    return task;
  }
  const remotePdfs = new Map<string, RemotePdf>();
  const readRange = pdfRangeReader(options.request);
  let active=0;const queue:(()=>void)[]=[];
  async function prune(){
    const files=await readdir(directory).catch(()=>[]);
    const rows=await Promise.all(files.filter(f=>/^[a-f0-9]{64}\.pdf$/.test(f)).map(async file=>({file,...await stat(path.join(directory,file))})));
    let size=rows.reduce((n,r)=>n+r.size,0);
    for(const row of rows.sort((a,b)=>a.mtimeMs-b.mtimeMs))if(size>256_000_000 || Date.now()-row.mtimeMs>3600000){
      await rm(path.join(directory,row.file),{force:true});size-=row.size;
      for(const [key,item] of cache)if(item.value.kind==='pdf'&&item.value.fileUrl.endsWith(row.file))cache.delete(key);
    }
  }
  async function read(raw:string,refresh=false):Promise<SourcePreview>{
    const url=sourceUrl(raw).href,known=cache.get(url);
    if(!refresh && known && Date.now()-known.at<600000)return known.value;
    if(pending.has(url))return pending.get(url)!;
    const task=(async()=>{
      if(active>=2)await new Promise<void>(resolve=>queue.push(resolve));active++;
      try{
        const signal=AbortSignal.timeout(options.timeoutMs??30000);
        const target = previewTarget(url);
        const probeSize = /\.pdf$/i.test(target.pathname) ? 8192 : pdfChunkSize;
        const probe = {range: "bytes=0-" + (probeSize - 1),maxBytes:4*1024*1024};
        let response = await fetchSource(target.href, AbortSignal.any([signal, AbortSignal.timeout(12000)]), options.request, probe)
          .catch(error => {
            if (error instanceof SourceReadError && error.code === 'SOURCE_HTTP_416' && !signal.aborted)
              return fetchSource(target.href, signal, options.request,{maxBytes:4*1024*1024});
            if (error instanceof SourceReadError || signal.aborted) throw error;
            return fetchSource(target.href, signal, options.request, probe);
          });
        const isPdf=response.bytes.subarray(0,1024).includes(Buffer.from("%PDF-"));
        if(response.status===206 && !isPdf && !completeRange(response))response=await fetchSource(target.href,signal,options.request);
        let common={originalUrl:url,url:response.url,title:new URL(response.url).pathname.split('/').at(-1)||new URL(response.url).hostname,
          fetchedAt:new Date().toISOString(),bytes:response.bytes.length};
        let value:SourcePreview,cacheByUrl=true;
        if(response.bytes.subarray(0,1024).includes(Buffer.from('%PDF-'))){
          if(response.truncated)throw new SourceReadError('来源返回的 PDF 不完整，可打开原文件查看。','WEB_FETCH_TOO_LARGE');
          let range=response.headers['content-range']?.match(/^bytes 0-(\d+)\/(\d+)$/);
          let size=response.status===206?Number(range?.[2]):response.bytes.length;
          if(!Number.isSafeInteger(size)||size<=0||(response.status===206&&(!range||Number(range[1])+1!==response.bytes.length||size<response.bytes.length)))
            throw new SourceReadError('PDF 分段内容不完整，请重新读取。','SOURCE_INVALID_RANGE');
          if(size>64_000_000)throw new SourceReadError('PDF 超过 64 MB，可打开原文件查看。','WEB_FETCH_TOO_LARGE');
          let validator=response.headers.etag||response.headers['last-modified']||'';
          if(response.status===206&&size>response.bytes.length&&(!validator||/^W\//i.test(validator))){
            // The probe is only discovery. Discard it; no unvalidated bytes cross responses.
            response=await readPdfSnapshot(response.url,signal,options.request,4*1024*1024-response.bytes.length);
            size=response.bytes.length;range=null;
            validator=response.headers.etag||response.headers['last-modified']||'';
            common={...common,url:response.url,title:new URL(response.url).pathname.split('/').at(-1)||new URL(response.url).hostname,bytes:size};
          }
          cacheByUrl=!!validator&&!/^W\//i.test(validator);
          if(!cacheByUrl&&size>4*1024*1024)throw new SourceReadError('无版本标记的 PDF 超过本轮4MiB单响应快照上限。','WEB_FETCH_TOO_LARGE');
          const remote=response.status===206&&range&&size>response.bytes.length;
          // A complete snapshot is addressed by its bytes, never an unversioned URL.
          const name=(remote?createHash('sha256').update(JSON.stringify({url:response.url,validator,size})):createHash('sha256').update(response.bytes)).digest('hex')+'.pdf';
          if(remote){
            remotePdfs.set(name,{url:response.url,size,validator,at:Date.now(),first:response.bytes});
            while(remotePdfs.size>128)remotePdfs.delete(remotePdfs.keys().next().value!);
            value={...common,bytes:size,kind:'pdf',range:true,fileUrl:'/api/source-preview/files/'+name};
          }else{
          await mkdir(directory,{recursive:true});
          const temporary=path.join(directory,name+'.'+randomUUID());
          try{await writeFile(temporary,response.bytes);await rename(temporary,path.join(directory,name));}finally{await rm(temporary,{force:true});}
          value={...common,kind:'pdf',fileUrl:'/api/source-preview/files/'+name};
          await prune();
          }
        } else if (isMarkdown(response)) {
          const body = sourceText(response);
          value = {...common, kind: 'markdown', body: body.slice(0, 150000), truncated: response.truncated || body.length > 150000};
        }else{
          const kind=classifyContentType(response.headers['content-type']||null);
          if(!kind)throw new SourceReadError('此入口没有返回可预览的网页或 PDF。','WEB_UNSUPPORTED_CONTENT_TYPE');
          const text=sourceText(response);
          const extracted=kind==='html'?extractSourceHtml(text,response.url):{title:common.title,paragraphs:[text.slice(0,150000)],label:'来源文本',truncated:text.length>150000,links:[],pdfLinks:[]};
          value={...common,...extracted,kind:'html',truncated:response.truncated||extracted.truncated,canEmbed:canEmbed(response)};
        }
        // Without a strong validator, reopening rechecks the source; immutable file URLs remain usable.
        if(cacheByUrl){cache.set(url,{at:Date.now(),value});while(cache.size>128)cache.delete(cache.keys().next().value!);}else cache.delete(url);
        return value;
      }finally{active--;queue.shift()?.();}
    })();
    pending.set(url,task);try{return await task;}finally{pending.delete(url);}
  }
  router.post('/check',async(req,res)=>{
    if(!req.is('application/json') || typeof req.body?.url!=='string'){res.status(400).json({error:'请提供有效的公开来源地址。'});return;}
    let url:string;
    try{url=sourceUrl(req.body.url).href;}catch{res.status(400).json({error:'来源地址无效。'});return;}
    res.set('Cache-Control','no-store').json(await check(url));
  });
  router.post('/',async(req,res)=>{
    if(!req.is('application/json') || typeof req.body?.url!=='string'){res.status(400).json({error:'请提供有效的公开来源地址。'});return;}
    try{res.set('Cache-Control','no-store').json(await read(req.body.url,req.body.refresh===true));}
    catch(error){
      const code=error instanceof SourceReadError?error.code:(error as Error).name==='TimeoutError'||(error as Error).name==='AbortError'?'WEB_FETCH_TIMEOUT':'SOURCE_NETWORK_ERROR';
      const message=error instanceof SourceReadError?error.message:code==='WEB_FETCH_TIMEOUT'?'来源读取超时，请重试或打开原网页。':'无法连接来源站点，请重试或打开原网页。';
      res.status(code==='WEB_BLOCKED_URL'||code==='WEB_INVALID_URL'?400:502).json({error:message,code});
    }
  });
  router.get('/files/:name',async(req,res)=>{
    if(!/^[a-f0-9]{64}\.pdf$/.test(req.params.name)){res.sendStatus(404);return;}
    const remote=remotePdfs.get(req.params.name);
    if(remote){
      if(Date.now()-remote.at>3600000){remotePdfs.delete(req.params.name);res.status(410).json({error:'PDF 预览已过期，请重新读取来源。'});return;}
      const range=req.headers.range?.match(/^bytes=(\d+)-(\d+)$/),start=Number(range?.[1]),end=Number(range?.[2]);
      if(!range || end<start || start<0 || end>=remote.size || end-start>=4_194_304){res.set('Content-Range','bytes */'+remote.size).sendStatus(416);return;}
      const controller=new AbortController(),cancel=()=>controller.abort();res.on('close',cancel);
      try{
        const bytes = await readRange(req.params.name, remote, start, end, controller.signal);
        if(!res.destroyed)res.status(206).set({'Content-Type':'application/pdf','X-Content-Type-Options':'nosniff','Content-Range':'bytes '+start+'-'+end+'/'+remote.size,'Accept-Ranges':'bytes','Cache-Control':'private, max-age=600'}).send(bytes);
      }catch(error){if(!res.destroyed)res.status(502).json({error:error instanceof SourceReadError?error.message:'PDF 分段读取失败，请重试。'});}
      finally{res.off('close',cancel);}
      return;
    }
    const filename=path.resolve(directory,req.params.name);
    try{await stat(filename);}catch{res.status(410).json({error:'PDF 预览缓存已过期，请重新读取来源。'});return;}
    res.set({'Content-Type':'application/pdf','X-Content-Type-Options':'nosniff','Cache-Control':'private, max-age=600','Content-Disposition':'inline; filename="OneEarth-source.pdf"'});
    res.sendFile(filename,{dotfiles:"allow"},error=>{if(error&&!res.headersSent)res.sendStatus(404);});
  });
  return router;
}
