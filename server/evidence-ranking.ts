/** Rank retrieval candidates, never their truth. No model output or source fact is invented here. */
const segmenter=new Intl.Segmenter("zh",{granularity:"word"});
const stop=new Set("a an and are as at be by can could data dataset datasets do does for from how in is it its of on or research study studies that the their these this to using was were what which with you your analysis method methods model models result results source sources information material materials find field record records 研究 数据 数据集 资料 来源 方法 哪些 怎么 如何 什么 这个 刚才 继续 是否 需要 能否 可以 进行 分析 相关 本轮 原始 说明".split(" "));
const norm=(s:string)=>s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}_.-]+/gu," ").trim();
export function relevanceTerms(text:string){
  const n=norm(text),english=n.match(/[a-z][a-z0-9_.-]+/g)||[];
  const chinese=[...segmenter.segment(n)].filter(x=>x.isWordLike&&/\p{Script=Han}/u.test(x.segment)).map(x=>x.segment);
  return [...new Set([...english,...chinese].filter(t=>t.length>1&&!stop.has(t)))];
}
export interface EvidenceRank {score:number;matchedTerms:string[];matchedPhrases:string[];pinned:boolean}
export function rankEvidence<T>(items:T[],queries:string[],title:(item:T)=>string,body:(item:T)=>string,pinned:(item:T)=>boolean=()=>false){
  const terms=relevanceTerms(queries.join(" ")).slice(0,100);
  const phrases=[...new Set(queries.map(norm).filter(q=>q.length>=5&&q.length<=100&&relevanceTerms(q).length>=2))].slice(0,30);
  const docs=items.map((item,index)=>({item,index,title:norm(title(item)),body:norm(body(item)).slice(0,60000)}));
  const includes=(text:string,term:string)=>{
    if(!/[a-z]/i.test(term))return text.includes(term);
    const exact=new RegExp("(?:^|[^a-z0-9])"+term.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"(?=$|[^a-z0-9])","i");
    if(exact.test(text))return true;
    // Conservative long-word morphology: photography/photographs and
    // ethnography/ethnographic share a long stem, unlike photogrammetry.
    return /^[a-z]{10,}$/.test(term)&&new RegExp("(?:^|[^a-z])"+term.slice(0,-2)+"[a-z]{0,5}(?=$|[^a-z])","i").test(text);
  };
  const weights=new Map(terms.map(t=>[t,1+Math.log((docs.length+1)/(1+docs.filter(d=>includes(d.title+" "+d.body,t)).length))]));
  return docs.map(d=>{
    const matchedTerms=terms.filter(t=>includes(d.title+" "+d.body,t));
    const matchedPhrases=phrases.filter(p=>d.title.includes(p)||d.body.includes(p));
    const score=matchedTerms.reduce((n,t)=>n+weights.get(t)!*(includes(d.title,t)?3:0.6),0)+
      matchedPhrases.reduce((n,p)=>n+(d.title.includes(p)?9:3),0);
    const rank:EvidenceRank={score,matchedTerms,matchedPhrases,pinned:pinned(d.item)};
    return {...d,rank};
  }).sort((a,b)=>Number(b.rank.pinned)-Number(a.rank.pinned)||b.rank.score-a.rank.score||a.index-b.index);
}
