import {webMaterial,webMaterialLinks,withoutAnswerCode} from "../src/domain/web-material";
import {hasReadWebExcerpt,webUrl} from "../src/domain/web-preview";
import type {AnswerReference,WebHit} from "../src/domain/types";
import {SourceReadClaimError} from "./source-read-provenance";

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

function claimsWebFileVerified(text:string,references:AnswerReference[]) {
  const prose=text.replace(/\[[^\]\n]+\]\((https?:\/\/[^\s)]+)\)/g,"$1").replace(/https?:\/\/[^\s。！？，；、）)]+/g," WEB ");
  const onlyWeb=references.every(ref=>ref.kind==="web");
  return prose.split(/(?<=[。！？；])|\n/).some(clause=>{
    const refs=[...clause.matchAll(/〔(\d+)〕/g)].map(m=>references[Number(m[1])-1]);
    if (!clause.includes(" WEB ") && !(refs.length ? refs.some(ref=>ref?.kind==="web") : onlyWeb)) return false;
    const availability=/(?<!未)(?:已经?|实际)(?:测试|核验|核实|验证|确认)[^。！？；\n]{0,30}(?:可(?:正常)?下载|下载成功|可(?:正常)?访问文件)/;
    if (availability.test(clause)) return true;
    const assumedRead=/(?:本轮|此次|这次)\s*(?:已(?:经)?|实际|成功)?\s*(?:下载|读取|读到|取得|获取|解析)(?:了|到)?|已(?:经)?(?:成功|实际)?(?:下载|读取|读到|取得|获取|解析)(?:了|到)?|\b(?:I|we|the platform)\s+(?:have\s+)?(?:actually\s+)?(?:downloaded|read|parsed)\b/gi;
    return [...clause.matchAll(assumedRead)].some(match=>{
      const start=match.index;
      const before=clause.slice(0,start);
      if (/(?:未|没有|尚未|并未|无法|不代表|不能|不等于|能否|是否)(?:在本轮)?\s*$/.test(before)) return false;
      if (!/^(?:本轮|此次|这次)/.test(match[0]) && /(?:论文作者|研究者|研究团队|发布方|用户)(?:此前|曾经|已经)?\s*$/.test(before)) return false;
      const object=clause.slice(start+match[0].length).split(/[，。！？；〔]/,1)[0];
      const precedingObject=before.split(/[，。！？；〔〕]/).at(-1)?.slice(-48) ?? "";
      const fileNoun=/(?:原始(?:数据)?文件|数据文件|(?:NetCDF|GeoTIFF|HDF5?|GRIB)\s*(?:数据)?文件|\b(?:raw data|binary data|netCDF|GeoTIFF|HDF5?|GRIB)\s+files?)/i;
      const descriptor=/元数据|摘要|目录|清单|入口|链接|端点|文件名|说明|metadata|catalog/i;
      return !descriptor.test(object) && (fileNoun.test(object) ||
        (fileNoun.test(precedingObject) && !descriptor.test(precedingObject)));
    });
  });
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
  if (claimsWebFileVerified(withoutAnswerCode(text),answer.references)) {
    throw new SourceReadClaimError("网络材料只记录网页、元数据或文献节选，没有原始数据文件读取回执或下载核验记录。请按有记录的读取层级表述。");
  }
}
