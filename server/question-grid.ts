import {cellAt,emptyFilters} from "../src/domain/spatial";
import {dateEvidence} from "../src/domain/time-window";
import type {GridCoverageEvidence} from "../src/domain/grid-coverage";
import type {DiscoveryContext} from "../src/domain/types";
import type {spatialCoverageClient} from "./spatial-coverage-client";

export async function questionGridEvidence(ctx:DiscoveryContext,coverage:ReturnType<typeof spatialCoverageClient>,
    signal:AbortSignal):Promise<GridCoverageEvidence|undefined>{
  const attached = ctx.attachedScope?.find(item=>item.kind==="grid");
  if (!attached) return;
  signal.throwIfAborted();
  const {selection,coverageScope} = attached;
  if (!coverageScope)
    return {cellId:selection.id,gridKey:selection.grid.key,status:"unknown",reason:"unavailable"};
  return coverage({cell:selection,scope:coverageScope},signal);
}

export function verifiedGridContext(context:DiscoveryContext,evidence:GridCoverageEvidence):DiscoveryContext {
  const summary=evidence.summary;
  const attachments=context.attachedScope||[];
  const datasets=attachments.filter(item=>item.kind==="dataset");
  const referenceIds=attachments.flatMap(item=>item.kind==="reference"&&item.reference.kind==="asset"?[item.reference.id]:[]);
  const candidateIds=[...new Set([...datasets.map(item=>item.id),...referenceIds])];
  const candidateScope={candidateIds,inCandidateScope:candidateIds.length>0,
    candidateVersions:Object.fromEntries(datasets.flatMap(item=>item.version?[[item.id,item.version]]:[]))};
  if (!summary) {
    const time=attachments.find(item=>item.kind==="time");
    return {...context,...candidateScope,filters:{...emptyFilters(),period:time?.period??null,utcWindow:time?.utcWindow??null},
      caseId:null,layer:"all",selection:null,attachedScope:attachments.filter(item=>item.kind!=="grid")};
  }
  const {filters,selection,caseId,layer}=summary;
  const place="经度 "+selection.point[0].toFixed(4)+"°，纬度 "+selection.point[1].toFixed(4)+"°";
  return {...context,...candidateScope,filters,selection,caseId,layer,gridSystem:selection.grid.system,
    camera:{...context.camera,center:selection.point},
    attachedScope:attachments.map(item=>item.kind==="grid"&&item.coverageScope
      ?{kind:"grid",selection,place,coverageScope:{id:item.coverageScope.id,revision:item.coverageScope.revision,summary}}:item)};
}

export function gridCoverageSummary(evidence:GridCoverageEvidence){
  if (evidence.status==="ready") {
    const ids = evidence.sourceIds.slice(0,32);
    const units=evidence.summary?.metric==="scenes"?" 条影像目录记录":" 种目录数据集";
    return "所引网格和筛选范围匹配 "+evidence.count+units+"（覆盖修订 "+evidence.revision+"）。这是目录定位信息，不能证明有当地有效观测。"+
      (ids.length ? " 对应来源记录示例 ID："+ids.join("、") : "");
  }
  if (evidence.reason==="expired") return "覆盖未知。所引网格的覆盖范围已失效，请重新选用当前范围。";
  if (evidence.reason==="pending") return "覆盖未知。所引网格的目录定位结果还在准备。";
  return "覆盖未知。暂时无法读取所引网格的目录定位结果。";
}

// Product-level samples in other cells must never be interpreted as local readings.
export function pickedSamples(tabs:import("../src/domain/types").EvidenceTab[],ctx:DiscoveryContext){
  if(!ctx.selection || !ctx.attachedScope?.length)return;
  const {grid,id}=ctx.selection;
  return tabs.flatMap(tab=>{
    const cols=tab.columns || [];
    const x=cols.findIndex(c=>/经度|^lon(?:gitude)?$/i.test(c)), y=cols.findIndex(c=>/纬度|^lat(?:itude)?$/i.test(c));
    if(x<0 || y<0)return [];
    const t=cols.findIndex(c=>/日期|观测时间|采集时间|^时间$|^date(time)?$/i.test(c));
    const rows=(tab.rows || []).filter(row=>{
      const lon=row[x],lat=row[y];
      if(typeof lon!=="number" || !Number.isFinite(lon) || Math.abs(lon)>180 || typeof lat!=="number" || !Number.isFinite(lat) || Math.abs(lat)>90 || cellAt([lon,lat],grid)!==id)return false;
      if(ctx.filters.utcWindow)return dateEvidence(row[t],ctx.filters.utcWindow);
      if(ctx.filters.period){const year=String(row[t] ?? "").match(/^(\d{4})(?:-|$)/)?.[1];return !!year && +year>=ctx.filters.period[0] && +year<=ctx.filters.period[1];}
      return true;
    }).slice(0,4);
    return rows.length?[{label:tab.label,columns:cols,rows:rows.map(row=>row.map(v=>String(v ?? "").slice(0,180)))}]:[];
  });
}
