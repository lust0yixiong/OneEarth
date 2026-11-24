import {locatorIndexNotice} from "./locator-labels.mjs";
import type {ExactSourceSnapshot} from "./exact-source-snapshot";
import {locateHtmlSource} from "./html-source-locators";
import type {SourceReadLocator} from "../src/domain/source-read-locator";
import {load,type Cheerio,type CheerioAPI} from 'cheerio';
import type {AnyNode} from "domhandler";
import type {WebHit} from '../src/domain/types';
import {fetchSource, type SourceRequest} from './source-fetch';
import {publicPage, usefulPageText} from './fetch-pages';

function sourceAlternates($:CheerioAPI,base:string):NonNullable<WebHit["sourceAlternates"]>{
  const candidates:NonNullable<WebHit["sourceAlternates"]>=[];
  function add(href:string|undefined,mediaType:"application/pdf"|"application/xml",relation:"citation_pdf_url"|"alternate"){
    if(!href||href.length>2000||candidates.length===4)return;
    try{
      const url=publicPage(new URL(href,base).href);
      if(url&&url!==base&&!candidates.some(item=>item.url===url))candidates.push({url,mediaType,relation});
    }catch{/* A malformed declared pointer is not a candidate. */}
  }
  $('meta[name="citation_pdf_url"]').each((_,el)=>add($(el).attr("content"),"application/pdf","citation_pdf_url"));
  $('link[rel~="alternate"][type][href]').each((_,el)=>{
    const type=$(el).attr("type")?.toLowerCase().split(";",1)[0].trim();
    if(type==="application/pdf")add($(el).attr("href"),type,"alternate");
    if(type==="text/xml"||type==="application/xml"||type==="application/jats+xml")
      add($(el).attr("href"),"application/xml","alternate");
  });
  return candidates;
}

/** Public text only: the transport revalidates/pins DNS and every redirect, with no cookies or auth. */
type OriginReadValue = {hits:WebHit[];requestUrl:string;warning:string;cacheStoredAt?:string};
export function readOriginPage(hit:WebHit,address:string,signal:AbortSignal,request?:SourceRequest):
  Promise<OriginReadValue & {hits:(WebHit & {pageExcerpt:string})[]}>;
export function readOriginPage(hit:WebHit,address:string,signal:AbortSignal,request:SourceRequest|undefined,
  locators:SourceReadLocator[]|undefined,snapshot?:ExactSourceSnapshot):Promise<OriginReadValue>;
export async function readOriginPage(hit:WebHit,address:string,signal:AbortSignal,request?:SourceRequest,locators?:SourceReadLocator[],snapshot?:ExactSourceSnapshot):Promise<OriginReadValue>{
  const url=publicPage(address);
  if(!url || /\.(?:pdf|zip|gz|nc|hdf5?|tiff?)(?:$|\?)/i.test(url))throw Error('原站回退仅支持公开 HTML 或纯文本正文。');
  const xmlPath=/\.xml$/i.test(new URL(url).pathname);
  const allowXml=!!locators||xmlPath;
  signal.throwIfAborted();
  const cached=snapshot?.get();
  const response=cached?.response||await fetchSource(url,signal,request,{textOnly:true,...(allowXml?{allowXml:true}:{}),maxBytes:1_000_000});
  const cacheEvidence=cached?{cacheStoredAt:cached.cacheStoredAt}:{};
  const keep=()=>{if(!cached&&!signal.aborted)snapshot?.keep(response);};
  const type=response.headers['content-type']||'';
  const binaryXml=xmlPath&&/\.xml$/i.test(new URL(response.url).pathname)&&/^(?:application|binary)\/octet-stream(?:;|$)/i.test(type);
  const xml=allowXml&&(/^(?:application|text)\/xml(?:;|$)/i.test(type)||binaryXml);
  if(!xml&&!/^(?:text\/(?:html|plain)|application\/xhtml\+xml)(?:;|$)/i.test(type))throw Error('原站回退未取得 HTML 或纯文本正文。');
  const charset=type.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1] || 'utf-8';
  let body:string;
  try{body=new TextDecoder(charset).decode(response.bytes);}catch{body=new TextDecoder().decode(response.bytes);}
  let text=body, availableLocators:WebHit["availableLocators"], sourceHit=hit;
  if(!/^text\/plain(?:;|$)/i.test(type)){
    if(xml&&(response.truncated||response.bytes.length>1_000_000||/<!ENTITY\b/i.test(body)||
      !/^\s*(?:<\?xml\b|<!DOCTYPE\s+article\b|<article(?:\s|>))/i.test(body)))
      throw Error("未取得有界的有效 JATS 文章。");
    const $=xml?load(body,{xml:true}):load(body);
    if(xml){
      if(!$.root().children("article").length||!$("article > body").length||!$("article > front > article-meta").length)
        throw Error("XML 未识别为 JATS 文章。");
      const dois=[...new Set($('article > front > article-meta > article-id[pub-id-type="doi"]')
        .map((_,node)=>$(node).text().trim()).get().filter(doi=>/^10\.\d{4,9}\/[^\s<>]+$/i.test(doi)))];
      if(dois.length===1)sourceHit={...hit,doi:dois[0]};
    }
    if(/^(just a moment|access denied|attention required|request rejected|robot check|verify you are human|forbidden)\b/i.test($('title').first().text().trim()) || $('#challenge-form,.cf-challenge-running').length)
      throw Error('原站要求验证或限制自动读取，未取得正文。');
    if(!xml){
      const alternates=sourceAlternates($,response.url);
      if(alternates.length)sourceHit={...sourceHit,sourceAlternates:alternates};
    }
    $('script,style,noscript,iframe,svg,nav,header,footer,form,aside,template,button,[hidden],[aria-hidden=true]').remove();
    const main=$(xml?'article,book-part':'main,article,[role="main"]').first();
    const node:Cheerio<AnyNode>=main.length?main:xml?$.root():$('body');
    const located=locateHtmlSource(sourceHit,node,element=>$(element),locators||[],response.truncated);
    availableLocators=located.availableLocators;
    if(locators){
      if(xml||located.pageExcerpt||usefulPageText(node.text(),hit))keep();
      return {hits:[located],requestUrl:response.url,...cacheEvidence,warning:(located.locatorResults?.every(item=>item.status==="found")
        ? "已从指定公开来源提取定位内容。"
        : "部分指定位置没有可核实的正文或数值；未读取链接附件。")+
        (availableLocators?.length?locatorIndexNotice:"")};
    }
    node.find('p,div,section,sec,title,li,pre,br,h1,h2,h3,h4,tr').each((_,el)=>{$(el).append('\n');});
    text=node.text().replace(/[\t\r ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  }
  if(!usefulPageText(text,hit)){
    if(snapshot&&sourceHit.sourceAlternates?.length)return {hits:[sourceHit],requestUrl:response.url,
      warning:"本页未取得可用正文。仅保留页面声明的其他公开格式入口，内容与访问授权仍待核实。"};
    throw Error('原站未取得可用正文，可能只有登录、验证或导航内容。');
  }
  if(locators)return {hits:[{...hit,locatorResults:locators.map(locator=>({...locator,status:"unsupported" as const}))}],
    requestUrl:response.url,...cacheEvidence,warning:"纯文本来源缺少可核验的结构化位置。"};
  const excerpt=text.slice(0,5200);
  keep();
  return {hits:[{...sourceHit,pageExcerpt:excerpt,...(availableLocators?.length?{availableLocators}:{})}],requestUrl:response.url,...cacheEvidence,
    warning:'DeepSeek Fetch 未取得正文，已从公开原站读取文本片段；未读取链接附件。'+(response.truncated||text.length>5200?'正文仅保留有界片段。':'')+
      (availableLocators?.length?locatorIndexNotice:'')};
}
