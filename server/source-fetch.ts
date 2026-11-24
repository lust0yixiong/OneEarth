import {lookup} from "node:dns/promises";
import {BlockList,isIP} from "node:net";
import {Agent as HttpAgent, request as httpRequest} from "node:http";
import {Agent as HttpsAgent, request as httpsRequest} from "node:https";
import {createBrotliDecompress,createGunzip,createInflate} from "node:zlib";
import {validateFetchUrl} from "./upstream/harness-fetch-policy";
import {SourceReadError} from "./source-read-error";

const blocked=new BlockList(),globalV6=new BlockList();
for(const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const)blocked.addSubnet(ip,bits,'ipv4');
globalV6.addSubnet('2000::',3,'ipv6');
for(const [ip,bits] of [['2001:db8::',32],['2001::',32],['2002::',16],['2001:10::',28]] as const)blocked.addSubnet(ip,bits,'ipv6');
export function publicSourceAddress(address:string){
  const family=isIP(address);return family===4?!blocked.check(address,'ipv4'):family===6 && globalV6.check(address,'ipv6') && !blocked.check(address,'ipv6');
}
export function sourceUrl(raw:string){
  const url=validateFetchUrl(raw);url.hash='';
  if(url.port && !['80','443'].includes(url.port))throw new SourceReadError('只读取标准 HTTP(S) 端口的公开来源。','WEB_BLOCKED_URL');
  const host=url.hostname.replace(/^\[|\]$/g,'');
  if(isIP(host) && !publicSourceAddress(host))throw new SourceReadError('只读取公开来源地址。','WEB_BLOCKED_URL');
  return url;
}
export interface SourceResponse {url:string;status:number;headers:Record<string,string>;bytes:Buffer;truncated:boolean}
export type SourceFetchOptions={range?:string;ifRange?:string;textOnly?:boolean;allowXml?:boolean;maxBytes?:number};
export type SourceRequest=(url:URL,signal:AbortSignal,options?:SourceFetchOptions)=>Promise<SourceResponse>;
// Reuse validated public connections between byte ranges on the same origin.
const pool = {keepAlive:true, maxSockets:8, maxFreeSockets:4, maxTotalSockets:32};
const httpAgent = new HttpAgent(pool);
const httpsAgent = new HttpsAgent(pool);
export const requestSource:SourceRequest=async(url,signal,options={})=>{
  const host=url.hostname.replace(/^\[|\]$/g,'');
  let abortLookup:()=>void=()=>{};
  const resolved=await (async()=>{
    if(isIP(host))return [{address:host,family:isIP(host)}];
    try{return await Promise.race([lookup(host,{all:true}),new Promise<never>((_resolve,reject)=>{abortLookup=()=>reject(signal.reason);signal.addEventListener('abort',abortLookup,{once:true});})]);}
    finally{signal.removeEventListener('abort',abortLookup);}
  })();
  signal.throwIfAborted();
  if(!resolved.length || resolved.some(a=>!publicSourceAddress(a.address)))throw new SourceReadError('来源地址未通过公开网络校验。','WEB_BLOCKED_URL');
  const target=resolved.find(a=>a.family===4) || resolved[0];
  return new Promise((resolve,reject)=>{
    const req=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{method:'GET',agent:url.protocol==='https:'?httpsAgent:httpAgent,signal,
      lookup:(_host,options,callback)=>options.all?callback(null,[target]):callback(null,target.address,target.family),
      headers:{'user-agent':'OneEarth/0.1 (public source reader)','accept':'application/pdf,text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2','accept-encoding':'identity',...(options.range?{range:options.range}:{}),...(options.ifRange?{'if-range':options.ifRange}:{})}},res=>{
      const headers=Object.fromEntries(Object.entries(res.headers).map(([k,v])=>[k,Array.isArray(v)?v.join(', '):v||'']));
      const result={url:url.href,status:res.statusCode||0,headers};
      if(result.status<200 || result.status>=300){res.destroy();resolve({...result,bytes:Buffer.alloc(0),truncated:false});return;}
      const type=headers['content-type']||'';
      const xmlType=options.allowXml&&(/^(?:application|text)\/xml(?:;|$)/i.test(type)||
        (/\.xml$/i.test(url.pathname)&&/^(?:application|binary)\/octet-stream(?:;|$)/i.test(type)));
      if(options.textOnly && !/^(?:text\/(?:html|plain)|application\/xhtml\+xml)(?:;|$)/i.test(type) && !xmlType){
        res.destroy();
        if(options.allowXml&&/^application\/pdf(?:;|$)/i.test(type))
          reject(new SourceReadError('原站回退未取得 HTML 或纯文本正文。','WEB_SOURCE_IS_PDF'));
        else reject(new SourceReadError('原站回退仅支持公开 HTML 或纯文本正文。','WEB_UNSUPPORTED_TEXT'));
        return;
      }
      const limit=Math.min(/text\/|html|xml|json/i.test(type)?3_000_000:64_000_000,options.maxBytes??Infinity);
      if(Number(headers['content-length'])>limit && /pdf/i.test(type)){res.destroy();reject(new SourceReadError('PDF 超过本次读取的大小限制，可打开原文件查看。','WEB_FETCH_TOO_LARGE'));return;}
      const encoding=headers['content-encoding'];
      const body=encoding==='gzip'?res.pipe(createGunzip()):encoding==='br'?res.pipe(createBrotliDecompress()):encoding==='deflate'?res.pipe(createInflate()):res;
      const chunks:Buffer[]=[];let size=0,finished=false;
      body.on('data',(chunk:Buffer)=>{
        if(finished)return;size+=chunk.length;
        if(size>limit){
          finished=true;res.destroy();if(body!==res)body.destroy();
          if(/text\/|html|xml|json/i.test(type))resolve({...result,bytes:Buffer.concat(chunks),truncated:true});
          else reject(new SourceReadError('来源文件超过预览大小限制。','WEB_FETCH_TOO_LARGE'));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      body.on('end',()=>{if(!finished){finished=true;resolve({...result,bytes:Buffer.concat(chunks),truncated:false});}});
      body.on('error',error=>{if(!finished){finished=true;reject(error);}});
      res.on('error',error=>{if(!finished){finished=true;reject(error);}});
    });
    req.on('error',reject);req.end();
  });
};
/** Every redirect is a new validated, pinned connection; DOI redirects may change public origins. */
export async function fetchSource(raw:string,signal:AbortSignal,request:SourceRequest=requestSource,options:SourceFetchOptions={}){
  let url=sourceUrl(raw);
  for(let hops=0;hops<=5;hops++){
    signal.throwIfAborted();const response=await request(url,signal,options);
    if([301,302,303,307,308].includes(response.status)){
      if(hops===5 || !response.headers.location)throw new SourceReadError('来源跳转次数过多或缺少目标地址。','WEB_REDIRECT_BLOCKED');
      url=sourceUrl(new URL(response.headers.location,url).href);continue;
    }
    if(response.status<200 || response.status>=300)throw new SourceReadError('来源站点返回 HTTP '+response.status+'。','SOURCE_HTTP_'+response.status);
    return response;
  }
  throw new SourceReadError('来源跳转未完成。','WEB_REDIRECT_BLOCKED');
}
