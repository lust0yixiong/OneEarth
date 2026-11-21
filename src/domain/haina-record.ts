import type {CatalogCardInfo} from "./types";

export interface HainaRecord {
  id:number; name:string; description:string; provider:string; source:string; version:string;
  license:string; access:string; labels:{group:string;name:string}[]; card:CatalogCardInfo;
  updateTime?:string; createTime?:string; dataAddress?:string; storageType?:string;
  sourceIdentifier?:string; licenseUrl?:string; sourceUrl?:string;
}
export interface HainaCatalog {
  synced:string; records:HainaRecord[]; total:number; endpoint:string; areaId:string;
}
const text=(v:unknown)=>typeof v==="string"?v.trim():"";
function link(v:unknown){try{const u=new URL(text(v));return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password?u.href:undefined;}catch{return undefined;}}
export function hainaRecord(raw:Record<string,unknown>,thumbnailUrl?:string):HainaRecord {
  const id=Number(raw.id),name=text(raw.name);
  if(!Number.isSafeInteger(id)||id<=0||!name)throw Error("海纳返回的条目缺少有效 ID 或名称。");
  const labels=(Array.isArray(raw.labelList)?raw.labelList:[]).filter(l=>l&&typeof l==="object") as Record<string,unknown>[];
  return {id,name,description:text(raw.description),provider:text(raw.provider),source:text(raw.source),version:text(raw.version),
    license:text(raw.licenseName),access:text(raw.authorizationType),
    labels:labels.filter(l=>["1007","1017"].includes(String(l.topLabelId))).map(l=>({group:String(l.topLabelId),name:text(l.labelNameCn)||text(l.labelNameEn)})),
    card:{thumbnailUrl,tags:[...new Set(labels.map(l=>text(l.labelNameCn)||text(l.labelNameEn)).filter(Boolean))],
      size:text(raw.fileSizeReadableText)&&raw.fileSizeReadableText!=="未知"?text(raw.fileSizeReadableText):undefined,
      favorites:Number.isSafeInteger(raw.collectCount)?Number(raw.collectCount):undefined},
    updateTime:text(raw.updateTime)||undefined,createTime:text(raw.createTime)||undefined,
    dataAddress:text(raw.dataAddress)||undefined,storageType:text(raw.type)||undefined,
    sourceIdentifier:text(raw.textId)||undefined,licenseUrl:link(raw.licenseUrl),sourceUrl:link(raw.dataSourceUrl)};
}
export function validHainaRecord(r:unknown):r is HainaRecord {
  if(!r||typeof r!=="object")return false;
  const v=r as HainaRecord;
  return Number.isSafeInteger(v.id)&&v.id>0&&typeof v.name==="string"&&!!v.name.trim()&&
    [v.description,v.provider,v.source,v.version,v.license,v.access].every(s=>typeof s==="string")&&
    Array.isArray(v.labels)&&v.labels.every(l=>l&&typeof l.group==="string"&&typeof l.name==="string")&&
    !!v.card&&Array.isArray(v.card.tags)&&v.card.tags.every(s=>typeof s==="string");
}
export function validHainaCatalog(v:unknown):v is HainaCatalog {
  if(!v||typeof v!=="object")return false;
  const c=v as HainaCatalog;
  return typeof c.synced==="string"&&Number.isFinite(Date.parse(c.synced))&&typeof c.endpoint==="string"&&typeof c.areaId==="string"&&
    Array.isArray(c.records)&&c.records.every(validHainaRecord)&&c.total===c.records.length&&new Set(c.records.map(r=>r.id)).size===c.total;
}
