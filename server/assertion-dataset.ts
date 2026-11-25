import { createHash } from "node:crypto";
import type { AssertionDatasetRow, OfficialAssertionMetadata } from "./assertion-postgres";
import { normalizePaperSpace } from "./earthnano";
import type { AssertionCatalogKind, PaperRecord } from "../src/domain/paper-record";
import { rectangle } from "../src/domain/geo-rectangle";
import {publicPage} from "./fetch-pages";
import type { Coordinate, EvidenceTab, SourceProfile } from "../src/domain/types";

function values(raw:string|null):any[] {try{const parsed=JSON.parse(raw||"[]");return Array.isArray(parsed)?parsed.filter(value=>value&&typeof value==="object"):[];}catch{return [];}}
function instant(raw:string,end=false) {
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw.trim())) {
    const time=Date.parse(raw);return Number.isFinite(time)?time+(end?1:0):undefined;
  }
  const match=/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(raw.trim());if(!match)return;
  const year=+match[1],month=+(match[2]||1),day=+(match[3]||1);
  const date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year || date.getUTCMonth()!==month-1 || date.getUTCDate()!==day)return;
  if(end){if(!match[2])date.setUTCFullYear(year+1);else if(!match[3])date.setUTCMonth(month);else date.setUTCDate(day+1);}
  return date.getTime();
}
export function datasetWindow(raw:string|null,official:AssertionDatasetRow["official"]):[number,number]|undefined {
  if(!raw?.trim())return;
  const temporal=official.flatMap(meta=>values(meta.temporal));
  const matches=temporal.filter(item=>item.begin===raw || item.raw===raw);
  if(matches.length && matches.every(item=>/^(?:Issued|Created|Updated|Submitted|Accepted|Available)$/i.test(item.date_type||"")))return;
  const parts=raw.trim().split(/\s*\/\s*|\s+to\s+|\s*[至–—]\s*/);
  if(parts.length>2)return;
  const start=instant(parts[0]),end=instant(parts.at(-1)!,true);
  return start!==undefined && end!==undefined && start<end ? [start,end] : undefined;
}
function evidenceText(value:string|null|undefined,limit=500) {
  const raw=value?.trim();
  if(!raw)return "";
  const safe=raw.replace(/https?:\/\/[^\s<>"']+/gi,url=>publicPage(url)||"[未展示受限地址]");
  return safe.length<=limit?safe:safe.slice(0,limit)+"…（有界摘录；源字段 SHA-256 "+
    createHash("sha256").update(raw).digest("hex")+"）";
}
function variants(source:OfficialAssertionMetadata[]){
  const rows=new Map<string,OfficialAssertionMetadata>();
  for(const v of source){
    const key=JSON.stringify([v.source,v.title,v.publisher,v.year,v.version,v.resourceType,v.landing,
      v.description,v.descriptionDigest,v.descriptionLength,v.spatial,v.temporal]);
    if(!rows.has(key))rows.set(key,v);
  }
  return [...rows].sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(([,row])=>row);
}
function officialWindow(source:OfficialAssertionMetadata[]){
  const windows=new Map<string,{raw:string;utc:[number,number]}>();
  for(const metadata of source)for(const date of values(metadata.temporal)){
    if(!/^(?:Collected|Coverage|Observation(?:Period)?|Acquired)$/i.test(date.date_type||"")||typeof date.begin!=="string")continue;
    const raw=typeof date.end==="string"&&date.end?date.begin+"/"+date.end:date.begin;
    const utc=datasetWindow(raw,[]);
    if(utc&&!windows.has(JSON.stringify(utc)))windows.set(JSON.stringify(utc),{raw,utc});
  }
  return [...windows.values()];
}
function owningSpatial(source:OfficialAssertionMetadata[],issues:string[]){
  const available=new Map<string,ReturnType<typeof normalizePaperSpace>>();
  for(const row of source){
    const geo=normalizePaperSpace({values:values(row.spatial).map(value=>({value}))});
    if(!geo.world&&!geo.points.length&&!geo.area)continue;
    const points=[...new Map(geo.points.map(point=>[JSON.stringify(point),point])).entries()]
      .sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,point])=>point);
    const key=JSON.stringify([geo.world,geo.area,points]);
    if(!available.has(key))available.set(key,{...geo,points});
  }
  if(available.size>1)issues.push("不同来源的空间范围不一致，分别保留声明，未合并为覆盖范围");
  if(available.size===1){
    const [key,geo]=[...available][0];
    if(key.length<=32000&&geo.points.length<=1000)return {...geo,coverage:evidenceText(geo.coverage,1000)};
    issues.push("源空间字段超出目录几何上限，保留来源字段的有界摘录");
  }
  return normalizePaperSpace({values:[]});
}
function officialTab(sources:OfficialAssertionMetadata[]):EvidenceTab {
  return {kind:"table",label:"断言源元数据（各来源原字段）",
    columns:["来源","标题","发布方","版次","发布年","资源类型","公开入口","时段描述","空间描述","数据描述（有界摘录）"],
    rows:sources.map(entry=>[entry.source||"未标明来源",evidenceText(entry.title,900),evidenceText(entry.publisher),
      evidenceText(entry.version),entry.year??"",evidenceText(entry.resourceType),publicPage(entry.landing)||"",
      evidenceText(entry.temporal,600),evidenceText(entry.spatial,600),
      evidenceText(entry.description,800)+((entry.descriptionLength??0)>800?"…（仅显示源描述的前 800 字符）":"")])};
}

export function assertionDataset(row:AssertionDatasetRow):{record?:PaperRecord;issues:string[]} {
  const issues:string[]=[];
  const hasUsage=!!(row.usage_paper_id?.trim()&&row.dataset_id?.trim());
  const kind:AssertionCatalogKind=hasUsage?"metadata-with-usage":"metadata-only";
  const rich=row.rich_metadata!==false;
  const officialVariants=variants(row.official);
  const representative=officialVariants.find(entry=>entry.title?.trim())||officialVariants[0];
  const title=(rich?row.title:representative?.title)?.trim()||row.ds_key;
  const publisher=rich?row.publisher:representative?.publisher;
  const version=rich?row.version:representative?.version;
  const description=rich?row.abstract:evidenceText(representative?.description,800);
  const official=rich?normalizePaperSpace({values:row.official.flatMap(meta=>values(meta.spatial).map(value=>({value})))}):
    owningSpatial(officialVariants,issues);
  const raw=row.extent_geographic_bbox;
  const bbox=Array.isArray(raw) && raw.length===4 && raw.every(value=>typeof value==="number" && Number.isFinite(value)) ? raw as number[] : undefined;
  const valid=bbox && bbox[0]>=-180 && bbox[2]<=180 && bbox[0]<=180 && bbox[2]>=-180 && bbox[0]!==bbox[2] && bbox[1]>=-90 && bbox[3]<=90 && bbox[1]<bbox[3];
  const inside=(point:Coordinate)=>bbox && (bbox[0]<=bbox[2]?point[0]>=bbox[0]&&point[0]<=bbox[2]:point[0]>=bbox[0]||point[0]<=bbox[2]) && point[1]>=bbox[1] && point[1]<=bbox[3];
  const conflict=valid && official.points.some(point=>!inside(point));
  if(bbox && !valid)issues.push("数据集范围字段无效，未用于网格着色");
  if(conflict)issues.push("数据集边界框与官方坐标不一致，保留官方坐标，边界框待核");
  const world=!!(valid && !conflict && bbox[0]===-180 && bbox[1]===-90 && bbox[2]===180 && bbox[3]===90) || official.world;
  const area:SourceProfile["area"]=valid && !conflict && !world ? bbox[0]<bbox[2]?rectangle(...bbox as [number,number,number,number]):
    {type:"MultiPolygon",coordinates:[...rectangle(bbox[0],bbox[1],180,bbox[3]).coordinates,...rectangle(-180,bbox[1],bbox[2],bbox[3]).coordinates]} : official.area;
  const candidateWindows=rich?[]:officialWindow(officialVariants);
  if(candidateWindows.length>1)issues.push("不同来源的时间覆盖声明不一致，分别保留声明，未合并为覆盖时段");
  const temporal=rich?row.extent_temporalelement:candidateWindows.length===1?candidateWindows[0].raw:null;
  const window=rich?datasetWindow(temporal,row.official):candidateWindows.length===1?candidateWindows[0].utc:undefined;
  if(temporal && !window)issues.push("时间字段尚不能确认为数据覆盖时段");
  const questions=hasUsage?row.questions.filter(question=>question.question && question.paperId && question.datasetId):[];
  const tabs:EvidenceTab[]=[{kind:"table",label:"数据集时空元数据",columns:["字段","来源值","说明"],rows:[
      ["数据集标识",row.ds_key,"源库 DOI 身份"],["元数据来源",rich?"dataset_metadata":"ds_meta",
        rich?"断言库源元数据记录":representative?.source?"展示字段取自 "+representative.source+"；分来源记录见下方":"未标明提供方"],
      ["数据集标题",title,(rich?row.title:representative?.title)?.trim()?"元数据标题":"未记录标题，显示原身份"],
      ["发布方",publisher||"未提供","源库元数据"],
      ["数据集空间范围",JSON.stringify(raw),conflict?"与官方坐标冲突，未作为覆盖范围":"范围顺序：西、南、东、北"],
      ["数据集覆盖时段",temporal||"未提供",window?"数据集覆盖字段":"时段待核"],
      ["数据集版次",version||"未提供","不从论文发表年份推定数据年份"]]}];
  if(!rich||officialVariants.length>1)tabs.push(officialTab(officialVariants));
  if(hasUsage)tabs.unshift({kind:"table",label:"论文用法（本页）",columns:["论文","角色与用途","变量","研究背景","论文 ID","文内数据集 ID","论文 DOI"],
    rows:[[row.paper_title||row.usage_paper_id!,row.role_function||"",row.variables||"",row.study_context||"",row.usage_paper_id!,row.dataset_id!,row.paper_id===row.usage_paper_id?row.paper_doi||"":""]]});
  if(questions.length)tabs.push({kind:"table",label:"关联论文研究问题（示例）",columns:["研究问题","论文","论文 ID","研究问题 ID","文内数据集 ID","论文 DOI"],
    rows:questions.map(question=>[question.question,question.paperTitle,question.paperId,question.rqId,question.datasetId])});
  const doi=row.ds_key.startsWith("doi:")?"https://doi.org/"+row.ds_key.slice(4):undefined;
  const detail=[description||"",hasUsage?row.role_function||"":"",questions[0]?.question||""].filter(Boolean).join("\n");
  const data={assertionCatalogKind:kind,dsKey:row.ds_key,papers:hasUsage?Math.max(1,Number(row.n_papers)||1):0,
    paperTitle:hasUsage?row.paper_title||row.usage_paper_id!:"",studyContext:hasUsage?row.study_context||"":"",points:official.points,
    researchQuestions:questions,questionSource:"postgres-readonly" as const,
    need:{name:"论文研究数据",product:title,datasetId:row.ds_key,type:"论文研究数据",source:"EarthNano 论文断言库",status:hasUsage?"有论文用法记录":"有数据集元数据",detail,url:doi,tabs,
      profile:{role:"data" as const,spatial:"coverage" as const,area,areaBasis:"bounding-box" as const,extent:world?"world" as const:undefined,
        coverage:[world?"数据集元数据标注全球范围":area?"数据集元数据范围 "+(valid&&!conflict?bbox!.join(", "):official.coverage):official.points.length?official.coverage:"数据集空间范围待核",
          window?"覆盖时段 "+temporal:"时间覆盖待核"].join(" · "),
        years:window?[new Date(window[0]).getUTCFullYear(),new Date(window[1]-1).getUTCFullYear()] as [number,number]:undefined,utcWindow:window,
        access:doi?"通过数据集 DOI 核对发布方与获取条件":"数据获取入口待核",limitation:[...issues,"论文研究问题、用法与数据集实际覆盖分别核对；元数据范围不代表已取得所有原始文件。"].join("；")}}};
  return {record:{...data,id:"earthnano:"+createHash("sha256").update(JSON.stringify(data)).digest("hex")},issues};
}
