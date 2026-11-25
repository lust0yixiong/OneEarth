import { createHash } from "node:crypto";
import type { AssertionDatasetRow } from "./assertion-postgres";
import { normalizePaperSpace } from "./earthnano";
import type { AssertionCatalogKind, PaperRecord } from "../src/domain/paper-record";
import { rectangle } from "../src/domain/geo-rectangle";
import type { Coordinate, EvidenceTab, SourceProfile } from "../src/domain/types";

function values(raw:string|null):any[] {try{const parsed=JSON.parse(raw||"[]");return Array.isArray(parsed)?parsed:[];}catch{return [];}}
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
export function assertionDataset(row:AssertionDatasetRow):{record?:PaperRecord;issues:string[]} {
  const issues:string[]=[];
  const hasUsage=!!(row.usage_paper_id?.trim()&&row.dataset_id?.trim());
  const kind:AssertionCatalogKind=hasUsage?"metadata-with-usage":"metadata-only";
  const official=normalizePaperSpace({values:row.official.flatMap(meta=>values(meta.spatial).map(value=>({value})))});
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
  const window=datasetWindow(row.extent_temporalelement,row.official);
  if(row.extent_temporalelement && !window)issues.push("时间字段尚不能确认为数据覆盖时段");
  const questions=hasUsage?row.questions.filter(question=>question.question && question.paperId && question.datasetId):[];
  const tabs:EvidenceTab[]=[{kind:"table",label:"数据集时空元数据",columns:["字段","来源值","说明"],rows:[
      ["数据集标识",row.ds_key,"源库 DOI 身份"],["元数据来源","dataset_metadata","断言库源元数据记录"],
      ["数据集标题",row.title?.trim()||row.ds_key,row.title?.trim()?"元数据标题":"未记录标题，显示原身份"],
      ["发布方",row.publisher||"未提供","源库元数据"],
      ["数据集空间范围",JSON.stringify(raw),conflict?"与官方坐标冲突，未作为覆盖范围":"范围顺序：西、南、东、北"],
      ["数据集覆盖时段",row.extent_temporalelement||"未提供",window?"数据集覆盖字段":"时段待核"],
      ["数据集版次",row.version||"未提供","不从论文发表年份推定数据年份"]]}];
  if(hasUsage)tabs.unshift({kind:"table",label:"论文用法（本页）",columns:["论文","角色与用途","变量","研究背景","论文 ID","文内数据集 ID","论文 DOI"],
    rows:[[row.paper_title||row.usage_paper_id!,row.role_function||"",row.variables||"",row.study_context||"",row.usage_paper_id!,row.dataset_id!,row.paper_id===row.usage_paper_id?row.paper_doi||"":""]]});
  if(questions.length)tabs.push({kind:"table",label:"关联论文研究问题（示例）",columns:["研究问题","论文","论文 ID","研究问题 ID","文内数据集 ID","论文 DOI"],
    rows:questions.map(question=>[question.question,question.paperTitle,question.paperId,question.rqId,question.datasetId])});
  const doi=row.ds_key.startsWith("doi:")?"https://doi.org/"+row.ds_key.slice(4):undefined;
  const title=row.title?.trim()||row.ds_key;
  const detail=[row.abstract||"",hasUsage?row.role_function||"":"",questions[0]?.question||""].filter(Boolean).join("\n");
  const data={assertionCatalogKind:kind,dsKey:row.ds_key,papers:hasUsage?Math.max(1,Number(row.n_papers)||1):0,
    paperTitle:hasUsage?row.paper_title||row.usage_paper_id!:"",studyContext:hasUsage?row.study_context||"":"",points:official.points,
    researchQuestions:questions,questionSource:"postgres-readonly" as const,
    need:{name:"论文研究数据",product:title,datasetId:row.ds_key,type:"论文研究数据",source:"EarthNano 论文断言库",status:hasUsage?"有论文用法记录":"有数据集元数据",detail,url:doi,tabs,
      profile:{role:"data" as const,spatial:"coverage" as const,area,areaBasis:"bounding-box" as const,extent:world?"world" as const:undefined,
        coverage:[world?"数据集元数据标注全球范围":area?"数据集元数据范围 "+(valid&&!conflict?bbox!.join(", "):official.coverage):official.points.length?official.coverage:"数据集空间范围待核",
          window?"覆盖时段 "+row.extent_temporalelement:"时间覆盖待核"].join(" · "),
        years:window?[new Date(window[0]).getUTCFullYear(),new Date(window[1]-1).getUTCFullYear()] as [number,number]:undefined,utcWindow:window,
        access:doi?"通过数据集 DOI 核对发布方与获取条件":"数据获取入口待核",limitation:[...issues,"论文研究问题、用法与数据集实际覆盖分别核对；元数据范围不代表已取得所有原始文件。"].join("；")}}};
  return {record:{...data,id:"earthnano:"+createHash("sha256").update(JSON.stringify(data)).digest("hex")},issues};
}
