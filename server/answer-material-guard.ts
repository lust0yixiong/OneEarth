import {webMaterial,webMaterialLinks,withoutAnswerCode} from "../src/domain/web-material";
import {hasReadWebExcerpt,webUrl} from "../src/domain/web-preview";
import type {AnswerReference,WebHit} from "../src/domain/types";
import {SourceReadClaimError} from "./source-read-provenance";
import {modelSafeText,assertModelContextSafe} from "./model-context-safety";

type MaterialAnswer={message:string;limitation:string;followUp:string;references:AnswerReference[]};
type AccessKind="data-service"|"file-access";

// Omit the entire parameterized address from newly projected model material.
export function publicMaterialUrl(raw:string) {
  const url=webUrl(raw);
  return url && !/[?#]/.test(url.href) ? url.href : undefined;
}

export function materialAccessEvidence(web:WebHit[], entityUrls:string[]) {
  const links=new Map<string,Set<AccessKind>>();
  const add=(raw:string,declared?:AccessKind)=>{
    const url=webUrl(raw);
    if (!url) return;
    const type=webMaterial(url.href)?.kind ?? declared;
    if ((type!=="data-service" && type!=="file-access") || (declared && declared!==type)) return;
    const roles=links.get(url.href) ?? new Set<AccessKind>();
    roles.add(type);
    links.set(url.href,roles);
  };
  for (const url of entityUrls) add(url,"file-access");
  for (const hit of web) {
    add(hit.url);
    if (!hasReadWebExcerpt(hit)) continue;
    // Publishers may explicitly advertise file URLs without a dedicated
    // service pathname. Use the label in the acquired material, not a suffix.
    for (const link of webMaterialLinks(hit.pageExcerpt))
      if (link.claimed && !link.conflict) add(link.url,link.claimed);
    for (const match of hit.pageExcerpt.matchAll(/https?:\/\/[^\s<>"'）)\]]+/g)) {
      add(match[0].replace(/[。；，]+$/,""));
    }
  }
  return links;
}

type ClaimField="message"|"limitation"|"followUp";

/** Only the offending, sanitized local clause is sent to a correction model. */
export class WebFileClaimError extends SourceReadClaimError {
  readonly claim:{field:ClaimField;clause:string};
  constructor(field:ClaimField,clause:string,at=0){
    super("网络材料只记录网页、元数据或文献节选，没有原始数据文件读取回执或下载核验记录。请按有记录的读取层级表述。");
    this.name="WebFileClaimError";
    let safe=modelSafeText(clause);try{assertModelContextSafe(safe);}catch{safe="本句含不能安全投影的内容，请核对本字段中的文件读取或下载声明。";at=0;}
    const characters=Array.from(safe);
    const focus=Array.from(modelSafeText(clause.slice(0,at))).length;
    const start=Math.max(0,Math.min(focus-96,characters.length-318));
    const end=Math.min(characters.length,start+318);
    this.claim={field,clause:(start?"…":"")+characters.slice(start,end).join("")+(end<characters.length?"…":"")};
  }
}

/** Scope the disclaimer/condition to this predicate, not to another table cell
 * or a preceding comma-separated assertion. Unclear cases stay guarded. */
function notAsserted(clause:string,at:number){
  const before=clause.slice(0,at).split(/[，,]/u).at(-1)!.trim();
  const turn="(?:(?:在)?(?:本轮|此次|这次|本次)\\s*)?";
  const denied=new RegExp("(?:未|没有|尚未|并未|并非|无法|不能|不代表|不等于|能否|是否|不应|不该|不可)(?:据此)?(?:声称|说|表明|证明|推断|认定|确认|认为)?\\s*"+turn+"$");
  const unsupported=new RegExp("(?:没有|尚无|未有|缺少)[^，,。！？；\\n]{0,16}(?:证据|回执|记录|依据)(?:可以|能够|足以)?(?:证明|支持|表明|确认|说明)?\\s*"+turn+"$");
  const condition=before.split(/[:：]/u).at(-1)!.trim();
  return denied.test(before)||unsupported.test(before)||
    /^(?:如果|假如|假设|倘若|若(?!干)|一旦|仅当|除非)/u.test(condition)||
    /^只有/u.test(condition)&&/(?:才|方可|方能)/u.test(clause.slice(at))||
    /^(?:if|unless|provided that)\b/i.test(condition)||
    /(?:才(?:能|可)(?:说|声称|认为)|不能(?:就|据此)?(?:说|声称|认为))\s*(?:本轮|此次|这次|本次)?\s*$/u.test(before);
}

function claimsWebFileVerified(text:string,references:AnswerReference[]) {
  const prose=modelSafeText(text).replace(/\[[^\]\n]+\]\((https?:\/\/[^\s)]+)\)/g,"$1").replace(/https?:\/\/[^\s。！？，；、）)]+/g," WEB ");
  const onlyWeb=references.every(ref=>ref.kind==="web");
  for(const row of prose.split(/(?<=[。！？；])|(?<=[.!?;])(?=\s|$)|\n/u)){
    const refs=[...row.matchAll(/〔(\d+)〕/g)].map(m=>references[Number(m[1])-1]);
    if(!row.includes(" WEB ")&&!(refs.length?refs.some(ref=>ref?.kind==="web"):onlyWeb))continue;
    const cells=row.split(/(?<!\\)\|/u);
    for(const [index,clause] of cells.entries()){
      const availability=/(?<!未)(?:已经?|实际)(?:测试|核验|核实|验证|确认)/g;
      for(const match of clause.matchAll(availability)){
        if(/^[^。！？；\n]{0,30}(?:可(?:正常)?下载|下载成功|可(?:正常)?访问文件)/u.test(clause.slice(match.index+match[0].length))&&
          !notAsserted(clause,match.index))return {clause,at:match.index};
      }
      const assumedRead=/(?:本轮|此次|这次)\s*(?:已(?:经)?|实际|成功)?\s*(?:下载|读取|读到|取得|获取|解析)(?:了|到)?|已(?:经)?(?:成功|实际)?(?:下载|读取|读到|取得|获取|解析)(?:了|到)?|\b(?:I|we|the platform)\s+(?:have\s+)?(?:actually\s+)?(?:downloaded|read|parsed)\b/gi;
      for(const match of clause.matchAll(assumedRead)){
        const before=clause.slice(0,match.index);
        if(notAsserted(clause,match.index))continue;
        if(!/^(?:本轮|此次|这次)/.test(match[0])&&/(?:论文作者|研究者|研究团队|发布方|用户)(?:此前|曾经|已经)?\s*$/.test(before))continue;
        const object=clause.slice(match.index+match[0].length).split(/[，,。！？；〔]/u,1)[0];
        const localPrefix=before.split(/[，,。！？；〔〕]/u).at(-1)||"";
        const precedingObject=(cells.slice(0,index).join("|")+localPrefix).slice(-48);
        const fileNoun=/(?:原始(?:数据)?文件|数据文件|(?:NetCDF|GeoTIFF|HDF5?|GRIB)\s*(?:数据)?文件|\b(?:raw data|binary data|netCDF|GeoTIFF|HDF5?|GRIB)\s+files?)/i;
        const descriptor=/元数据|摘要|目录|清单|入口|链接|端点|文件名|说明|metadata|catalog/i;
        const documentObject=/^\s*(?:《[^》\n]{1,160}》(?:中|内)(?:的)?(?:资料|内容|文字|段落|表|图|章节|公式)|(?:论文|文献|文章|PDF|原文|正文)(?:中的|中的第|中|的)?(?:表|图|公式|章节|段落|节选|片段|文字|正文)|(?:table|figure|equation|section|paragraph)\s*\d)/iu;
        if(!descriptor.test(object)&&fileNoun.test(object))return {clause,at:match.index};
        if(!descriptor.test(object)&&fileNoun.test(precedingObject)&&!descriptor.test(precedingObject)&&!documentObject.test(object)){
          const context=index?precedingObject+" | ":"";
          return {clause:context+clause,at:context.length+match.index};
        }
      }
    }
  }
}

/** The web reading pipeline supplies text/PDF windows, not raw science data receipts. */
export function validateAnswerMaterialClaims(answer:MaterialAnswer, access:ReadonlyMap<string,ReadonlySet<AccessKind>>) {
  const text=[answer.message,answer.limitation,answer.followUp].join("\n");
  for (const link of webMaterialLinks(text)) {
    if (link.conflict) {
      throw new SourceReadClaimError("链接 "+link.url+" 指向"+link.material!.label+"，请按实际类型标注入口，保留原出处。");
    }
    if (link.claimed && !access.get(webUrl(link.url)?.href ?? "")?.has(link.claimed)) {
      throw new SourceReadClaimError("材料未确认所称的数据入口 "+link.url+"。只报告材料明确列出的访问端点；不能从文件名或 URL 结构猜测。请保留确有依据的目录或元数据出处。");
    }
  }
  for(const field of ["message","limitation","followUp"] as const){
    const claim=claimsWebFileVerified(withoutAnswerCode(answer[field]),answer.references);
    if(claim)throw new WebFileClaimError(field,claim.clause,claim.at);
  }
}
