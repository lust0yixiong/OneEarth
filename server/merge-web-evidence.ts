import type {SearchRun,WebHit} from "../src/domain/types";

type Origin={engine:SearchRun["engine"];query:string};
type Snippet={quote:string;origins:Origin[];sourceLength:number;partial:boolean};
export type MergedWebHit=WebHit & {
  snippetSources:Array<{start:number;end:number;origins:Origin[];sourceLength:number;partial:boolean}>;
  snippetNotice:string;omittedSnippets:number;omittedOrigins:number;identityConflicts:number;
};
const notice="snippet 是检索摘要或元数据摘要，不能视为已读网页正文，也不能单凭摘要确认论文实际使用。pageExcerpt 才是另行取得的正文节选。省略的摘要不代表不存在。";
const identity=(doi:string|undefined)=>(doi||"").replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,"").replace(/^doi:/i,"").toLowerCase().trim();

/** Merge only exact URLs; preserve complementary literal snippets and their search provenance. */
export function mergeWebEvidence(runs:SearchRun[],budget=24000):MergedWebHit[]{
  const groups=new Map<string,{hit:WebHit;snippets:Snippet[];omitted:number;omittedOrigins:number;conflicts:number}>();
  for(const run of runs){
    if(run.status!=="done")continue;
    for(const hit of run.hits){
      let g=groups.get(hit.url);
      if(!g){g={hit:{...hit},snippets:[],omitted:0,omittedOrigins:0,conflicts:0};groups.set(hit.url,g);}
      else {
        // The same landing page is not sufficient to reconcile two different DOI versions/entities.
        const doiConflict=identity(g.hit.doi)&&identity(hit.doi)&&identity(g.hit.doi)!==identity(hit.doi);
        const versionConflict=g.hit.version?.trim()&&hit.version?.trim()&&g.hit.version.trim()!==hit.version.trim();
        if(doiConflict||versionConflict){g.conflicts++;continue;}
        const prior=g.hit;
        g.hit={...prior,...hit,title:hit.title||prior.title,doi:hit.doi||prior.doi,
          pageExcerpt:hit.pageExcerpt||prior.pageExcerpt};
      }
      const text=hit.snippet?.trim();if(!text)continue;
      const quote=text.slice(0,800),origin={engine:run.engine,query:run.query.slice(0,240)};
      const old=g.snippets.find(s=>s.quote===quote&&s.sourceLength===text.length);
      if(old){
        if(!old.origins.some(o=>o.engine===origin.engine&&o.query===origin.query)){
          if(old.origins.length<3)old.origins.push(origin);else g.omittedOrigins++;
        }
      }else if(g.snippets.length<6)g.snippets.push({quote,origins:[origin],sourceLength:text.length,partial:quote.length<text.length});
      else g.omitted++;
    }
  }
  let remaining=Math.max(0,budget);
  return [...groups.values()].map(g=>{
    let snippet="",omitted=g.omitted;
    const snippetSources:MergedWebHit["snippetSources"]=[];
    for(const s of g.snippets){
      const separator=snippet?"\n\n":"",start=snippet.length+separator.length;
      const source={start,end:start+s.quote.length,origins:s.origins,sourceLength:s.sourceLength,partial:s.partial};
      const cost=separator.length+s.quote.length+JSON.stringify(source).length;
      if(cost>remaining){omitted++;continue;}
      snippet+=separator+s.quote;snippetSources.push(source);remaining-=cost;
    }
    return {...g.hit,snippet,snippetSources,snippetNotice:notice,omittedSnippets:omitted,
      omittedOrigins:g.omittedOrigins,identityConflicts:g.conflicts};
  });
}
