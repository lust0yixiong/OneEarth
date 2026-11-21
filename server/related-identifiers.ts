type Related={relatedIdentifier:string;relatedIdentifierType:string;relationType:string};
const priority=['IsVersionOf','IsIdenticalTo','IsNewVersionOf','IsPreviousVersionOf','IsSupplementTo','IsSupplementedBy','IsDocumentedBy','IsDescribedBy','HasVersion'];
/** A discovery hit is not an exhaustive dependency manifest. Never truncate an identifier itself. */
export function boundedRelatedIdentifiers(records:Related[],maxCount=20,maxBytes=3000){
 const ranked=records.map((record,index)=>({record,index,rank:priority.indexOf(record.relationType)}))
  .sort((a,b)=>(a.rank<0?priority.length:a.rank)-(b.rank<0?priority.length:b.rank)||a.index-b.index);
 const chosen:typeof ranked=[],indices=new Set<number>();let bytes=2;
 const add=(item:typeof ranked[number])=>{
  if(indices.has(item.index)||chosen.length>=maxCount)return false;
  const size=new TextEncoder().encode(JSON.stringify(item.record)).length+1;
  if(bytes+size>maxBytes)return false;
  chosen.push(item);indices.add(item.index);bytes+=size;return true;
 };
 // Prioritize one link per identity/documentation relation when the byte budget permits, before filling a long version list.
 for(const type of priority)for(const item of ranked)if(item.record.relationType===type&&add(item))break;
 for(const item of ranked)add(item);
 const kept=chosen.sort((a,b)=>a.index-b.index).map(x=>x.record),omitted=records.length-kept.length;
 return {relatedIdentifiers:kept,...(omitted?{relatedIdentifiersTotal:records.length,relatedIdentifiersOmitted:omitted}:{} )};
}
