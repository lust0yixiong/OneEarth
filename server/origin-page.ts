import {load} from 'cheerio';
import type {WebHit} from '../src/domain/types';
import {fetchSource, type SourceRequest} from './source-fetch';
import {publicPage, usefulPageText} from './fetch-pages';

/** Public text only: the transport revalidates/pins DNS and every redirect, with no cookies or auth. */
export async function readOriginPage(hit:WebHit,address:string,signal:AbortSignal,request?:SourceRequest){
  const url=publicPage(address);
  if(!url || /\.(?:pdf|zip|gz|nc|hdf5?|tiff?)(?:$|\?)/i.test(url))throw Error('原站回退仅支持公开 HTML 或纯文本正文。');
  const response=await fetchSource(url,signal,request,{textOnly:true,maxBytes:1_000_000});
  const type=response.headers['content-type']||'';
  if(!/^(?:text\/(?:html|plain)|application\/xhtml\+xml)(?:;|$)/i.test(type))throw Error('原站回退未取得 HTML 或纯文本正文。');
  const charset=type.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1] || 'utf-8';
  let body:string;
  try{body=new TextDecoder(charset).decode(response.bytes);}catch{body=new TextDecoder().decode(response.bytes);}
  let text=body;
  if(!/^text\/plain(?:;|$)/i.test(type)){
    const $=load(body);
    if(/^(just a moment|access denied|attention required|request rejected|robot check|verify you are human|forbidden)\b/i.test($('title').first().text().trim()) || $('#challenge-form,.cf-challenge-running').length)
      throw Error('原站要求验证或限制自动读取，未取得正文。');
    $('script,style,noscript,iframe,svg,nav,header,footer,form,aside,template,button,[hidden],[aria-hidden=true]').remove();
    const main=$('main,article,[role="main"]').first();
    const node=main.length?main:$('body');
    node.find('p,div,section,li,pre,br,h1,h2,h3,h4,tr').each((_,el)=>{$(el).append('\n');});
    text=node.text().replace(/[\t\r ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  }
  if(!usefulPageText(text,hit))throw Error('原站未取得可用正文，可能只有登录、验证或导航内容。');
  const excerpt=text.slice(0,5200);
  return {hits:[{...hit,pageExcerpt:excerpt}],requestUrl:response.url,
    warning:'DeepSeek Fetch 未取得正文，已从公开原站读取文本片段；未读取链接附件。'+(response.truncated||text.length>5200?'正文仅保留有界片段。':'')};
}
