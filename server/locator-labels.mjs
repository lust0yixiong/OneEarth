// Match visible object identifiers without treating "Table 20" as "Table 2".
const id='((?:[a-z]{1,4}[.-]?)?\\d+(?:[.\\-]\\d+)*[a-z]?|[ivxlcdm]+(?:-[a-z])?|[a-z])';
const prefixes={
  table:'(?:(?:supplementary |supplemental )?table|tbl\\.?|tab\\.?|附表|补充表|表)',
  figure:'(?:(?:supplementary |supplemental )?figure|fig\\.?|附图|图)',
  equation:'(?:equation|eq\\.?|公式|式)',section:'(?:section|sec\\.?|章节|节)',
};
const marker=(kind)=>new RegExp('^'+prefixes[kind]+
  '(?:[\\s_:.#-]+|(?=[a-z]?\\d|[a-z]-\\d)|(?<=[表图式节]))\\(?'+id+
  '\\)?(?=$|[\\s.:,：、)\\-–—])','i');
export const documentText=value=>value.replace(/\s+/g," ").trim();
export const locatorText=value=>value.normalize('NFKC').replace(/[‐‑−]/g,'-').replace(/\s+/g,' ').trim();
export const hasLocatorMarker=(kind,value)=>!!prefixes[kind]&&marker(kind).test(locatorText(value));
export function locatorIdentifier(kind,value,reference=false){
  const text=locatorText(value);
  if(!prefixes[kind])return;
  const marked=marker(kind).exec(text)?.[1];
  if(marked)return marked.toLowerCase();
  const plain=(kind==='section'&&reference?new RegExp('^'+id+'(?=$|\\s|\\.(?!\\d))','i'):
    new RegExp('^\\(?'+id+'\\)?\\.?$','i')).exec(text)?.[1];
  return plain?.toLowerCase();
}
export function matchesLocatorLabel(kind,value,label,...anchors){
  const requested=locatorIdentifier(kind,value);
  if(requested)return [label,...anchors].some(candidate=>locatorIdentifier(kind,candidate,true)===requested);
  const sought=locatorText(value).toLowerCase(), text=locatorText(label).toLowerCase();
  return text===sought||(kind==='section'&&text.replace(/^(?:\d+(?:\.\d+)*|[ivxlcdm]+(?:-[a-z])?)\.?\s+/,'')===sought);
}

export const locatorIndexNotice="位置索引仅列出已识别的有界样本；未列出不表示原文没有该位置。";

/** @template {{kind:string;value:string}} T @param {T[]} entries @returns {T[]} */
export function boundedLocatorIndex(entries){
  const kinds=["table","section","equation","figure","page"];
  const groups=kinds.map(kind=>{
    const unique=new Map();
    for(const entry of entries)if(entry.kind===kind&&!unique.has(entry.value))unique.set(entry.value,entry);
    return [...unique.values()];
  });
  const allotments=groups.map(()=>0);
  // Keep each structure represented. Extra turns preserve numeric table and equation labels.
  const turns=[0,1,2,3,4,0,2],limit=Math.min(20,groups.reduce((total,group)=>total+group.length,0));
  let reserved=0;
  while(reserved<limit){
    for(const index of turns){
      if(reserved===limit)break;
      if(allotments[index]<groups[index].length){allotments[index]++;reserved++;}
    }
  }
  // Sample the entire sequence within each type, including later sections and formulas.
  const represented=groups.map((group,index)=>Array.from({length:allotments[index]},(_,i)=>
    group[allotments[index]<2?0:Math.round(i*(group.length-1)/(allotments[index]-1))]));
  const selected=[];
  for(let i=0;selected.length<limit;i++)
    for(const group of represented)if(i<group.length)selected.push(group[i]);
  return selected;
}

export function excerptLocatorIndex(text){
  const entries=[];
  for(const line of text.split("\n")){
    const heading=line.match(/^\s*#{1,6}\s+(.{1,160})\s*$/);
    const label=locatorText(heading?.[1]||line.replace(/^\s*\*\*|\*\*\s*$/g,""));
    if(!label||label.length>240)continue;
    const kind=["table","figure","equation"].find(kind=>/^[\p{L}]/u.test(label)&&locatorIdentifier(kind,label,true));
    if(kind)entries.push({kind,value:locatorIdentifier(kind,label,true),label});
    else if(heading)entries.push({kind:"section",value:locatorIdentifier("section",label,true)||label.slice(0,120),label});
  }
  return boundedLocatorIndex(entries);
}
