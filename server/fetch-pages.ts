import type {SearchQuery, SearchRun, WebHit} from '../src/domain/types';
import {sourceUrl} from './source-fetch';
import {accessGate} from '../src/domain/read-evidence';

export function publicPage(raw: unknown) {
  if (typeof raw !== 'string') return;
  try {
    const url = sourceUrl(raw);
    if (!url.hostname.includes('.') || /\.(?:localhost|local|internal)$/i.test(url.hostname)) return;
    if ([...url.searchParams.keys()].some(k => /token|signature|credential|api[_-]?key/i.test(k))) return;
    return url.href;
  } catch { return; }
}

const stop = new Set('a and of in for to by with from using the on at or an how which what data dataset datasets records research sources study product products papers access versions variables methods 数据 数据集 研究 资料 来源 检索'.split(' '));
const segmenter = new Intl.Segmenter('zh',{granularity:'word'});
function words(text: string) {
  const parts = text.toLowerCase().normalize('NFKC').match(/[a-z\d]+|[\p{Script=Han}]+/gu) || [];
  const tokens = parts.flatMap(s => /\p{Script=Han}/u.test(s) ? [...segmenter.segment(s)].map(t=>t.segment) : [s]);
  return new Set(tokens.filter(s=>s.length>1 && !stop.has(s)).map(s=>s.endsWith('s') && s.length>4 ? s.slice(0,-1) : s));
}

// Short documents can be useful, but a consent or navigation-only response is not source evidence.
export function usefulPageText(text:string, hit:WebHit) {
  const plain=text.replace(/\s+/g,' ').trim();
  if (!plain) return false;
  if (accessGate(text)) return false;
  if (plain.length<1600 && /^(?:#{1,4} )?(?:(?:just a moment|verify (?:you are|you're) human|access denied|checking your browser)\b|请完成安全验证)/i.test(plain)) return false;
  if (plain.length>=240) return true;
  const body=words(plain),title=words(hit.title);
  return [...title].some(term=>body.has(term));
}

// These URLs identify the work for selection. Each citation retains its own original DOI and version.
function doiOf(hit: WebHit) {
  if(hit.doi)return hit.doi.toLowerCase();
  try{
    const url=new URL(hit.url),decoded=decodeURIComponent(url.href);
    const path=decoded.match(/(?:doi\.org\/|\/doi\/(?:abs\/|full\/|pdf(?:direct)?\/)?)(10\.\d{4,9}\/[^?#]+)/i)?.[1];
    if(path)return path.toLowerCase();
    for(const key of ["doi","rft_id"]){
      const value=url.searchParams.get(key)?.replace(/^info:doi\//i,"");
      if(value&&/^10\.\d{4,9}\/[^\s?#]+$/i.test(value))return value.toLowerCase();
    }
  }catch{/* Invalid encodings cannot establish a shared DOI identity. */}
  return '';
}
function normalizedPage(raw: string) {
  const url=new URL(raw);
  for(const key of [...url.searchParams.keys()]) if (/^(utm_|__cf_chl_|from_hint$|ref_src$)/i.test(key)) url.searchParams.delete(key);
  return url.href;
}
function workTitle(title:string) {
  const text=title.toLowerCase().normalize('NFKC').split(/ \| | - (?:sciencedirect|springer|wiley)/)[0];
  const parts=text.split(/\s+[-–—]\s+/);
  const name=parts.length===2 && parts[0]===parts[1]?parts[0]:text;
  return name.replace(/^\[?pdf\]?\s+/,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}
export interface FetchPage {hit:WebHit; urls:string[]}
export interface FetchFocus {targets:WebHit[];strict?:boolean;excludeUrls?:string[]}
function placeText(value:string){
  return value.normalize("NFKC").toLowerCase().replace(/['’]/g,"").replace(/[^\p{L}\p{N}]+/gu," ").trim();
}
export function pagesToRead(runs: SearchRun[], queries: SearchQuery[],focus?:FetchFocus,regionHints:string[]=[]): FetchPage[] {
  const places=[...new Set(regionHints.map(placeText).filter(name=>name.length>=2))];
  function mentionsPlace(value:string){
    const text=" "+placeText(value)+" ";
    return places.some(name=>text.includes(/\p{Script=Han}/u.test(name)?name:" "+name+" "));
  }
  const facets=queries.map(q=>words(q.web));
  const datasetTerms=queries.map(q=>words(q.dataset));
  const placeTerms=new Set([...regionHints,...places].flatMap(name=>[...words(name)]));
  const topicalTerms=new Set([...facets,...datasetTerms].flatMap(terms=>[...terms]).filter(term=>!placeTerms.has(term)));
  const ranked=[];
  const excluded=new Set((focus?.excludeUrls||[]).map(normalizedPage));
  const matches=(hit:WebHit,target:WebHit)=>doiOf(target)?doiOf(hit)===doiOf(target)
    :[hit.url,hit.landingUrl].filter(Boolean).some(url=>url===target.url||url===target.landingUrl);
  const targets=(focus?.targets||[]).map(target=>{
    const known=runs.flatMap(r=>r.hits).find(hit=>matches(hit,target));
    return known?{...target,...known,referenceType:target.referenceType}:target;
  });
  // Target hints enter the read queue, never the list of successfully retrieved evidence.
  for (const run of [...runs,{engine:"target",hits:targets}]) for (const [index,hit] of run.hits.entries()) {
    if([hit.url,hit.landingUrl].some(url=>url&&excluded.has(normalizedPage(url))))continue;
    const focused=targets.some(target=>matches(hit,target));
    if(focus?.strict&&!focused)continue;
    const doi=doiOf(hit);
    const relation=hit.relatedIdentifiers?.find(r=>r.relationType==='IsVersionOf' && r.relatedIdentifierType.toLowerCase()==='doi');
    const parent=relation?.relatedIdentifier.toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\/|^doi:/,'');
    const figshare=doi.match(/^(10\.6084\/m9\.figshare\.\d+)\.v\d+$/);
    const mendeley=doi.match(/^(10\.17632\/[\da-z]+)\.\d+$/);
    const version=!!(parent || figshare || mendeley);
    const concept=hit.relatedIdentifiers?.some(r=>r.relationType==='HasVersion') || false;
    const zenodo=doi.match(/^10\.5281\/zenodo\.(\d+)$/);
    const record=zenodo && !concept ? 'https://zenodo.org/records/'+zenodo[1] : undefined;
    const publisher=publicPage(hit.landingUrl),citation=publicPage(hit.url);
    const addresses=record?[record,citation,publisher]:[publisher,citation];
    const urls=[...new Set(addresses.filter((s):s is string=>!!s).map(normalizedPage))];
    if(!urls.length) continue;
    const title=words(hit.title),summary=words(hit.snippet),terms=new Set([...title,...summary]);
    const titleKey=workTitle(hit.title);
    const truncated=/(?:\.\.\.|…)\s*$/.test(hit.title);
    const key=focused?(doi||urls[0]):parent || figshare?.[1] || mendeley?.[1] || doi || urls[0];
    const versionRank=version?2:concept?0:1;
    ranked.push({hit,urls,key,title,titleKey,truncated,terms,versionRank,index,engine:run.engine,focused});
  }
  const weights=new Map<string,number>();
  const unique=[...new Map(ranked.map(item=>[item.key,item])).values()];
  for (const facet of [...facets,...datasetTerms]) for (const term of facet) if (!weights.has(term)) {
    const frequency=unique.filter(item=>item.terms.has(term)).length;
    weights.set(term,1+Math.log((unique.length+1)/(frequency+1)));
  }
  const candidates=ranked.map(item=>{
    function coverage(facet:Set<string>){
      let matched=0,total=0;
      for(const term of facet){const weight=weights.get(term)!;total+=weight;
        if(item.terms.has(term))matched+=weight*(item.title.has(term)?1:0.45);
      }
      return total?matched/total:0;
    }
    const scores=facets.map((facet,i)=>coverage(facet)+.6*coverage(datasetTerms[i]));
    const relevance=Math.max(0,...scores);
    const recordBoost=item.hit.doi || /\/(?:datasets?|products?|records|griddap)\/[^/?#]+/i.test(item.urls[0]) ? 0.10 : 0;
    const breadth=scores.reduce((sum,value)=>sum+value,0)/Math.max(1,scores.length);
    const score=(relevance+.5*breadth)*(1+recordBoost)+(relevance>0 ? .02/(item.index+1) : 0);
    const sourceBonus=item.engine==='DataCite' && relevance>=.15 ? .10/(item.index+1) : 0;
    // A place name helps prioritize reading a topical result. It does not establish coverage.
    const regionBonus=places.length && [...item.terms].some(term=>topicalTerms.has(term))
      ? mentionsPlace(item.hit.title) ? .3 : mentionsPlace(item.hit.snippet) ? .2 : 0
      : 0;
    return {...item,scores,score:score+sourceBonus+regionBonus+(item.focused?4:0)};
  }).filter(item=>item.score>0);
  // Group concept/version DOIs, publisher links and repeated landing pages before spending a read.
  const groups=new Map<string,typeof candidates[number]>();
  for(const item of candidates){
    const prev=groups.get(item.key);
    if (!prev || item.versionRank>prev.versionRank ||
      (item.versionRank===prev.versionRank && item.score>prev.score)) groups.set(item.key,item);
  }
  const remaining=[...groups.values()];
  const covered=new Set<number>(),seen=new Set<string>();
  const titles:Array<{key:string;doi:string;truncated:boolean}>=[];
  const priority=(item:typeof remaining[number])=>item.score+.45*Math.max(0,...item.scores.map((s,i)=>covered.has(i)?0:s));
  const pages:FetchPage[]=[];
  while(remaining.length){
    // Reward a strong match for a facet not yet represented, without reserving slots for weak hits.
    remaining.sort((a,b)=>priority(b)-priority(a));
    const item=remaining.shift()!;
    const doi=doiOf(item.hit);
    if(item.urls.some(url=>seen.has(url))) continue;
    // Identical titles can describe different, independently identified data products.
    const duplicate=titles.some(previous=>{
      if(doi && previous.doi && previous.doi!==doi) return false;
      if(item.titleKey===previous.key) return true;
      return (item.truncated && item.titleKey.length>=45 && previous.key.startsWith(item.titleKey+" ")) ||
        (previous.truncated && previous.key.length>=45 && item.titleKey.startsWith(previous.key+" "));
    });
    if(duplicate) continue;
    if(item.title.size>=5) titles.push({key:item.titleKey,doi,truncated:item.truncated});
    item.urls.forEach(url=>seen.add(url));
    covered.add(item.scores.indexOf(Math.max(...item.scores)));
    pages.push({hit:item.hit,urls:item.urls});
  }
  return pages;
}
