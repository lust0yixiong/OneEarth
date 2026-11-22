import type {GridCoverageEvidence} from "../domain/grid-coverage";
import {isBoundCoverageSummary} from "../domain/coverage-attachment";
import {coverageScopeLabels} from "../domain/question-scope";

export function GridCoverageRecord({coverage}: {coverage?: GridCoverageEvidence}) {
  if (!coverage) return <p className="answer-location-note">覆盖版本未知。该回答未保存覆盖修订。</p>;
  const {summary}=coverage;
  const knownScope=isBoundCoverageSummary(summary,coverage.cellId,coverage.gridKey);
  const scope=knownScope ? <div role="group" aria-label="回答时实际覆盖范围">
    <p>{coverageScopeLabels(summary).join(" · ")}</p>
    {summary.candidateIdentity && <p title={summary.candidateIdentity}>候选标识 <code>{summary.candidateIdentity.slice(0,12)}</code></p>}
  </div> : <p>实际覆盖范围未知。该回答未保存完整范围摘要。</p>;
  if (coverage.status === "unknown") {
    const text=coverage.reason==="expired"
      ? "原范围已失效。若要按当前数据提问，请在地图选格后点击「用此范围提问」。"
      : coverage.reason==="pending" ? "回答时，格内定位结果仍在准备。"
      : "回答时无法读取格内定位结果。";
    return <div className="answer-location-note">
      <p role="status">覆盖未知。{text}</p>
      {knownScope && scope}
    </div>;
  }
  if (!coverage.revision || !Array.isArray(coverage.members) || !Array.isArray(coverage.sourceIds) ||
      !Number.isSafeInteger(coverage.count) || coverage.count!==new Set(coverage.members).size) {
    return <p className="answer-location-note">覆盖版本未知。该回答未保存可核对的格内记录。</p>;
  }
  return <details className="chat-role" aria-label="本轮覆盖记录">
    <summary>回答时格内可定位数据集 {coverage.count} 种</summary>
    <div className="chat-role-body">
      <p>网格 {coverage.cellId} · {coverage.gridKey}</p>
      <p title={coverage.revision}>覆盖修订 <code>{coverage.revision.slice(0,12)}</code></p>
      {scope}
      {!!coverage.members.length && <p>格内成员：{coverage.members.join("、")}</p>}
      {!!coverage.sourceIds.length && <p>来源记录：{coverage.sourceIds.join("、")}</p>}
    </div>
  </details>;
}
