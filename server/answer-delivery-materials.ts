import {validPaperRecord,type PaperRecord} from "../src/domain/paper-record";
import type {AnswerReference,SearchRun,WebHit} from "../src/domain/types";
import {hasReadWebExcerpt,webUrl} from "../src/domain/web-preview";
import {webDocumentType} from "../src/domain/citation-types";
import {modelSafeText} from "./model-context-safety";
import {assertPublicAnswerSafe} from "./public-answer-stream";
import {readSourceIdentity} from "./source-read-comparison";
import type {CurrentAssertionReading} from "./runtime-assertion-evidence";

type Material={reference:AnswerReference;quotes:string[];webSource?:WebHit};
const maxMaterials=8;
const readEngines:ReadonlySet<SearchRun["engine"]>=new Set(["原站读取","PDF 原文","DeepSeek Fetch"]);
const nonempty=(value:unknown):value is string=>typeof value==="string"&&!!value.trim();
function usageRows(record:PaperRecord){
 if(!validPaperRecord(record)||record.catalogSummary||record.assertionCatalogKind==="metadata-only"||
  record.need.datasetId&&record.need.datasetId!==record.dsKey)return [];
 return (record.need.tabs.find(tab=>tab.kind==="table"&&tab.label==="论文用法（本页）")?.rows||[])
  .flatMap(([title,usage,variables,context,paperId,datasetId])=>
   nonempty(title)&&nonempty(paperId)&&nonempty(datasetId)?[{title,paperId,datasetId,described:[usage,variables,context].some(nonempty)}]:[]);
}
const referenceKey=(ref:AnswerReference)=>ref.kind==="asset"?"asset:"+ref.id:"web:"+ref.url;
const safeTitle=(title:string)=>modelSafeText(title.replace(/\s+/gu," ").trim()).slice(0,300);

/** This inventory comes from the original receipts, independently of what fit
 * into the prompt. Material cards never add numbered citations or claims. */
export function verifiedDeliveryMaterials(retrieved:PaperRecord[],papers:PaperRecord[],readings:CurrentAssertionReading[],
 searches:SearchRun[],allowedWeb:WebHit[]){
 const materials=new Map<string,Material>();
 const add=(material:Material)=>{
  const key=referenceKey(material.reference);
  const existing=materials.get(key);
  if(existing){existing.quotes.push(...material.quotes);return;}
  try{assertPublicAnswerSafe(JSON.stringify(material.reference));}
  catch{return;}
  materials.set(key,material);
 };
 const addPaper=(record:PaperRecord,quotes:string[])=>{
  const title=safeTitle(record.need.product);
  if(title)add({reference:{kind:"asset",id:record.id,title,source:"文献资料",sourceChannel:"assertion"},quotes});
 };
 for(const record of retrieved){
  const uses=usageRows(record).filter(row=>row.described);
  if(uses.length)addPaper(record,record.need.tabs.flatMap(tab=>tab.kind==="text"&&nonempty(tab.quote)&&
   uses.some(row=>tab.label.replace(/^原文\s*[·:]\s*/u,"").trim()===row.title.trim())?[tab.quote]:[]));
 }
 const byId=new Map(papers.map(paper=>[paper.id,paper]));
 for(const reading of readings){
  const record=byId.get(reading.id);
  if(!record||!Number.isFinite(Date.parse(reading.readAt)))continue;
  const identities=usageRows(record);
  const quotes=reading.evidence.papers.flatMap(paper=>identities.some(row=>row.paperId===paper.paperId&&row.datasetId===paper.datasetId)?
   paper.quotes.filter(quote=>nonempty(quote.blockId)&&nonempty(quote.quote)).map(quote=>quote.quote):[]);
  if(quotes.length)addPaper(record,quotes);
 }
 const allowedUrls=new Set(allowedWeb.map(hit=>hit.url));
 for(const run of searches){
  if(run.status!=="done"||run.cacheStoredAt||!readEngines.has(run.engine))continue;
  for(const hit of run.hits){
   if(!allowedUrls.has(hit.url)||hit.previousRead||hit.readBy==="user"||!hasReadWebExcerpt(hit)||
    !webUrl(hit.url)||hit.url.length>2048||modelSafeText(hit.url)!==hit.url)continue;
   const title=safeTitle(hit.title);
   if(title)add({reference:{kind:"web",url:hit.url,title,sourceChannel:"web",referenceType:webDocumentType(hit)},quotes:[hit.pageExcerpt],webSource:hit});
  }
 }
 return {
  has:(reference:AnswerReference)=>materials.has(referenceKey(reference)),
  hasQuote:(reference:AnswerReference,quote:string|undefined)=>!!quote&&
   !!materials.get(referenceKey(reference))?.quotes.some(text=>modelSafeText(text).includes(quote)),
  select(preferred:AnswerReference[]){
   const chosen=new Map<string,Material>();
   const append=(material:Material)=>{
    const {reference,webSource}=material;
    const key=reference.kind==="asset"?referenceKey(reference):"web:"+readSourceIdentity(reference.url,webSource?.stage);
    if(chosen.size<maxMaterials&&!chosen.has(key))chosen.set(key,material);
   };
   for(const reference of preferred){
    const material=materials.get(referenceKey(reference));
    if(material)append(material);
   }
   for(const material of materials.values())append(material);
   return [...chosen.values()];
  },
 };
}
