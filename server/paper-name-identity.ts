/** DOI identity is case-insensitive; version components in its suffix are not removed. */
export type PaperNameIdentity = {kind:"none";dois:[]} | {kind:"unique";dois:[string];doi:string} | {kind:"ambiguous";dois:string[]};
function unquoteDoi(value:string) {
  let prior="";
  while(prior!==value){
    prior=value;value=value.replace(/[.,;:!?]+$/g,"");
    for(const [open,close] of [["(",")"],["[","]"],["{","}"]]){
      if(value.endsWith(close) && value.split(close).length>value.split(open).length)value=value.slice(0,-1);
    }
  }
  return value.toLowerCase();
}
export function paperNameIdentity(name:string):PaperNameIdentity {
  // URL query/fragment parameters are navigation, not part of the DOI identity.
  // Decode the resolver path before scanning, including percent-encoded slashes.
  const text=name.replace(/([;,])(?=https?:\/\/(?:dx\.)?doi\.org\/)/gi,"$1 ").replace(/https?:\/\/(?:dx\.)?doi\.org\/[^\s<>"'`“”‘’，。．！？；：、【】（）《》「」『』]+/gi,raw=>{
    try {return decodeURIComponent(new URL(raw).pathname.slice(1));}catch{return raw;}
  }).replace(/([;,])(?=(?:doi:\s*)?10\.\d{4,9}\/)/gi,"$1 ");
  const matches=[...text.matchAll(/(?<![a-z0-9])10\.\d{4,9}\/[^\s<>"'`“”‘’，。．！？；：、【】（）《》「」『』\u3400-\u9fff]+/gi)];
  const dois=[...new Set(matches.map(m=>unquoteDoi(m[0])).filter(doi=>/^10\.\d{4,9}\/.+/.test(doi)))];
  return !dois.length?{kind:"none",dois:[]}:dois.length===1?{kind:"unique",dois:[dois[0]],doi:dois[0]}:{kind:"ambiguous",dois};
}

/** Preserve a DOI explicitly attached to the model's named dataset, not a paper DOI elsewhere in the question. */
export function explicitDatasetName(question:string,name:string) {
  const identity=paperNameIdentity(question);
  if(identity.kind!=="unique" || !name.trim())return name;
  const lower=question.toLowerCase(),doiAt=lower.indexOf(identity.doi);
  const nameAt=lower.lastIndexOf(name.toLowerCase(),doiAt);
  if(nameAt<0)return name;
  const between=lower.slice(nameAt+name.length,doiAt);
  return /^[\s（(]*(?:doi\s*[:：]?\s*)?$/i.test(between)?identity.doi:name;
}
