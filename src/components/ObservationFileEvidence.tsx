import type {ObservationEvidence} from "../domain/observation-evidence";
import {observationSourceUrl,validObservationArtifactSource} from "../domain/observation-source";

export function ObservationFileEvidence({evidence}:{evidence:ObservationEvidence}) {
  const {netcdf}=evidence;
  const artifactSource=validObservationArtifactSource(evidence.artifactSource)?evidence.artifactSource:undefined;
  const dataUrl=observationSourceUrl(artifactSource?.dataUrl),catalogUrl=observationSourceUrl(artifactSource?.catalogUrl);
  const dates=evidence.first && evidence.last ? evidence.first+" 至 "+evidence.last : "时段未记录";
  const markers=netcdf && [
    netcdf.fillValues.length ? "_FillValue "+netcdf.fillValues.join("、") : "",
    netcdf.missingValues.length ? "missing_value "+netcdf.missingValues.join("、") : "",
  ].filter(Boolean).join(" · ");
  return <>
    <small>文件版本 {evidence.version} · 变量 {evidence.variable} · 单位 {evidence.unit}</small>
    {netcdf ? <>
      <small>样本 {netcdf.totalSamples} 条 · 计入统计 {evidence.count} 条{evidence.count?" · UTC 日期 "+dates:""}</small>
      {netcdf.firstUtc && netcdf.lastUtc && <small>首末时刻（UTC） {netcdf.firstUtc} 至 {netcdf.lastUtc}</small>}
    </> : <small>{evidence.count?"非空记录 "+evidence.count+" 条 · "+dates:"无非空记录"}</small>}
    {netcdf?.firstRaw!=null && netcdf.lastRaw!=null &&
      <small>原始时间坐标 {netcdf.timeVariable} {netcdf.firstRaw} 至 {netcdf.lastRaw} · {netcdf.timeUnits} · {netcdf.calendar}</small>}
    {netcdf && <small>缺测标记 {markers || "未声明"}</small>}
    {netcdf?.qcApplied===false && <small>未应用质量标记（QC）筛选</small>}
    {!!netcdf?.relatedVariables.length && <details>
      <summary>同文件变量（目录元数据）</summary>
      {netcdf.relatedVariables.map(variable=><small key={variable.name}>
        {[variable.name,variable.longName || variable.standardName,variable.unit && "单位 "+variable.unit].filter(Boolean).join(" · ")}
      </small>)}
      {netcdf.relatedVariablesTruncated && <small>此记录仅列出部分关联变量。</small>}
    </details>}
    <small style={{overflowWrap:"anywhere"}}>SHA-256 {evidence.sha256}</small>
    {artifactSource && <div className="oe-observation-source-actions">
      <small>归档文件来源版本 {artifactSource.versionLabel}</small>
      {dataUrl && <a href={dataUrl} data-external target="_blank" rel="noreferrer">打开归档中的文件入口</a>}
      {catalogUrl && <a href={catalogUrl} data-external target="_blank" rel="noreferrer">打开归档中的发布目录</a>}
    </div>}
  </>;
}
