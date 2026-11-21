import {readPdfSnapshot} from './pdf-ranges';
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {fetchSource,type SourceRequest} from './source-fetch';
import type {WebHit} from '../src/domain/types';

const chunkSize=32768;
const byteBudget=4*1024*1024;
export async function readPdfPage(hit:WebHit,url:string,parent:AbortSignal,request?:SourceRequest,query='',focusQuestion=query){
  const controller=new AbortController();
  const signal=AbortSignal.any([parent,controller.signal,AbortSignal.timeout(14000)]);
  let first=await fetchSource(url,signal,request,{range:'bytes=0-'+(chunkSize-1),maxBytes:byteBudget});
  const range=first.headers['content-range']?.match(/^bytes 0-(\d+)\/(\d+)$/);
  let size=first.status===200?first.bytes.length:Number(range?.[2]);
  if(first.truncated || !Number.isSafeInteger(size) || size<=0 || size>256_000_000 ||
    first.bytes.subarray(0,5).toString()!=='%PDF-' || (first.status!==200 && (first.status!==206 || Number(range?.[1])!==first.bytes.length-1 || first.bytes.length>size)))
    throw Error('原站未返回可分段核对的 PDF。');
  let validator:string|undefined=first.headers.etag || first.headers['last-modified'];
  if(size>first.bytes.length&&(!validator||/^W\//i.test(validator))){
    // Discard the probe entirely. Never stitch it to a subsequent unvalidated response.
    first=await readPdfSnapshot(first.url,signal,request,byteBudget-first.bytes.length);
    size=first.bytes.length;
    validator=undefined;
  }
  const fingerprint=size===first.bytes.length?'sha256:'+createHash('sha256').update(first.bytes).digest('hex'):undefined;
  const targetPages=[...query.matchAll(/(?:第\s*(\d+)\s*页|\bpages?\s*(\d+))/gi)].map(m=>Number(m[1]||m[2])).filter(n=>Number.isSafeInteger(n)&&n>0).slice(0,4);
  let used=first.bytes.length;
  signal.throwIfAborted();
  const stop=new Set('the and for with from this that have been were what which how why can could would should then than into using used paper study data model models through its our are was'.split(' '));
  const tokenize=(text:string)=>[...new Set(text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g)||[])].filter(t=>!stop.has(t)).slice(0,32);
  const terms=tokenize(query),focusTerms=tokenize(focusQuestion),titleTerms=tokenize(hit.title);
  const worker=new Worker(new URL('./read-pdf-worker.mjs',import.meta.url),{execArgv:[],workerData:{size,chunkSize,first:new Uint8Array(first.bytes),terms,focusTerms,titleTerms,targetPages,outlineQuery:(focusQuestion+" "+query).slice(0,6000)},resourceLimits:{maxOldGenerationSizeMb:128}});
  try{
    const excerpt=await new Promise<string>((resolve,reject)=>{
      let partial='';
      signal.addEventListener('abort',()=>partial && !parent.aborted?resolve(partial):reject(signal.reason),{once:true});
      worker.once('error',reject);
      worker.once('exit',()=>reject(Error('PDF 文本读取已结束。')));
      worker.on('message',async msg=>{
        try{
          if(msg.partial){partial=msg.partial;return;}
          if(msg.error)throw Error(msg.error);
          if(typeof msg.excerpt==='string'){resolve(msg.excerpt);return;}
          const [begin,end]=msg.range;
          if(!Number.isSafeInteger(begin)||!Number.isSafeInteger(end)||begin<0||begin>=end||end>size||(used+=end-begin)>byteBudget)
            throw Error('PDF 页读取达到本轮字节上限。');
          const part=await fetchSource(first.url,signal,request,{range:'bytes='+begin+'-'+(end-1),ifRange:validator,maxBytes:end-begin});
          if(part.status!==206 || part.truncated || part.headers['content-range']!=='bytes '+begin+'-'+(end-1)+'/'+size || (part.headers.etag||part.headers['last-modified'])!==validator || part.bytes.length!==end-begin)
            throw Error('原站 PDF 分段内容或版本已变化。');
          worker.postMessage({begin,bytes:new Uint8Array(part.bytes)});
        }catch(error){reject(error);}
      });
    });
    return {hits:[{...hit,pageExcerpt:excerpt+'\n[读取范围] 仅摘录上述页面的有界文本；不代表全文已核实。'+(fingerprint?' 单响应内容指纹 '+fingerprint:' 分段版本标记 '+validator)}],requestUrl:first.url,warning:'已读取原站 PDF 的部分页面，页码按文件顺序标注；字节快照完整不表示全部页面已读。'};
  }finally{controller.abort();await worker.terminate();}
}
