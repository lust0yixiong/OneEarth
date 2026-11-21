import {paperNameIdentity} from './paper-name-identity';
type Row=Record<string,unknown>;
const obj=(v:unknown):Row=>v && typeof v==='object' && !Array.isArray(v)?v as Row:{};
const rows=(v:unknown):Row[]=>Array.isArray(v)?v.map(obj):[];
const text=(v:unknown)=>typeof v==='string'?v.trim():'';
const sources=(v:unknown)=>Array.isArray(v)?v.map(text).filter(Boolean):[];
const generic=new Set('the of and from to for a an data dataset datasets global product supplementary information supporting material materials model models method methods study studies analysis test tests experiment experiments measurement measurements records record version'.split(' '));
const terms=(v:string)=>[...new Set((v.toLowerCase().match(/[a-z][a-z0-9_-]*/g)||[]).filter(w=>!generic.has(w)))];
const contains=(haystack:string,term:string)=>new RegExp('(?:^|[^a-z0-9])'+term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=$|[^a-z0-9])','i').test(haystack);
/** A task hit's self-reported matched_facets is not evidence of relevance. */
export function relatedNamedPaperCandidate(name:string,queries:string[],hit:Row){
  const id=paperNameIdentity(name);
  if(id.kind==='unique' && text(hit.ds_key).toLowerCase()==='doi:'+id.doi)return true;
  const titles=[hit.display_name,hit.matched_alias,...(Array.isArray(hit.title_variants)?hit.title_variants:[])].map(text).join(' ');
  const match=(q:string)=>{const words=terms(q);return words.length>0 && words.filter(w=>contains(titles,w)).length>=Math.min(2,words.length);};
  return (id.kind==='none' && match(name)) || queries.some(match);
}

/** Isolate conflicting provider fields locally; never rewrite the upstream metadata. */
export function isolatePaperMetadata(dsKey:string,metadata:Row){
  const fields=obj(metadata.fields),quarantined=new Map<string,string[]>();
  const add=(source:string,reason:string)=>quarantined.set(source,[...(quarantined.get(source)||[]),reason]);
  const values=(key:string)=>rows(obj(fields[key]).values);
  const registryTitles=values('title').filter(v=>sources(v.sources).includes('datacite')).map(v=>text(v.value)).filter(Boolean);
  const expected=paperNameIdentity(dsKey),entityKey=text(obj(metadata.entity).ds_key);
  if(entityKey && entityKey.toLowerCase()!==dsKey.toLowerCase()){
    return {fields:{} as Row,quarantined:[{source:'返回实体',reasons:['元数据实体标识与请求标识不一致，相关字段未采用。']}]};
  }else if(expected.kind==='unique'){
    const fig=expected.doi.match(/^10\.6084\/m9\.figshare\.(\d+)(?:\.v(\d+))?$/);
    for(const v of values('landing'))if(fig && sources(v.sources).includes('figshare')){
      const match=text(v.value).match(/figshare\.com\/articles\/(?:[^/?#]+\/)*?(\d+)(?:\/(\d+))?(?:[/?#]|$)/i);
      if(match && (match[1]!==fig[1] || (fig[2] && match[2] && fig[2]!==match[2])))add('figshare','figshare落地页的文章或版本标识与当前DOI不一致，相关字段未采用。');
    }
    for(const v of values('title'))for(const source of sources(v.sources)){
      if(!['gbif','figshare'].includes(source) || !registryTitles.length)continue;
      const title=text(v.value);
      if(registryTitles.some(t=>t.toLowerCase()===title.toLowerCase()))continue;
      // A named constituent dataset is not the identity of a GBIF download snapshot.
      const snapshot=source==='gbif' && /^10\.15468\/dl\./.test(expected.doi) && registryTitles.some(t=>/^occurrence download$/i.test(t));
      const comparable=registryTitles.filter(t=>terms(t).length>=2);
      const overlap=terms(title).length>0 && comparable.some(t=>terms(t).filter(w=>contains(title,w)).length>=Math.min(2,terms(t).length,terms(title).length));
      if(snapshot || (comparable.length && !overlap))add(source,snapshot?'GBIF具名数据集标题与当前Occurrence Download快照不是同一身份层级，未作为快照元数据采用。':'提供方标题与当前DOI登记的DataCite标题不一致，尚未核实为同一实体，相关字段已隔离。');
    }
  }
  const clean:Row={};
  for(const [key,field] of Object.entries(fields)){
    const kept=rows(obj(field).values).flatMap(v=>{
      const prior=sources(v.sources),valid=prior.filter(s=>!quarantined.has(s));
      return prior.length && !valid.length?[]:[{...v,...(prior.length?{sources:valid}:{})}];
    });
    if(kept.length)clean[key]={...obj(field),values:kept};
  }
  return {fields:clean,quarantined:[...quarantined].map(([source,reasons])=>({source,reasons:[...new Set(reasons)]}))};
}
