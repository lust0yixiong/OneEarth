import {literatureDisplay} from "../domain/literature-label";
import {caseById} from "../domain/catalog";
import { datasetLineage } from "../domain/lineage";
import type { Asset } from "../domain/datasets";
import "../styles/dataset-lineage.css";

export function DatasetLineage({ asset }: { asset: Asset }) {
  const { version, records } = literatureDisplay(datasetLineage(asset));
  return (
    <section className="dataset-lineage" aria-label="版本与发现线索">
      <h3>版本与发现线索</h3>
      <p>
        资料版次 <strong>{version || "待核"}</strong> · {records.length}{" "}
        条来源记录
      </p>
      {records.map((r) => (
        <details key={r.assetId} open={r.assetId === asset.id}>
          <summary>{caseById(r.caseId) && !r.paper ? "案例发现背景 · " : ""}{r.study}</summary>
          <dl>
            <dt>关联依据</dt>
            <dd>{r.relation}</dd>
            {r.paper && (
              <>
                <dt>研究原文</dt>
                <dd>{r.paper}</dd>
              </>
            )}
            <dt>来源</dt>
            <dd>
              {r.url ? (
                <a href={r.url} target="_blank" rel="noreferrer">
                  {r.source}
                </a>
              ) : (
                r.source
              )}
            </dd>
            {r.studyContext !== undefined ? <>
              <dt>论文研究背景</dt>
              <dd>{r.studyContext || "未提供"}</dd>
            </> : <>
              <dt>实际区域</dt>
              <dd>{r.actualRegion}</dd>
              <dt>实际时段</dt>
              <dd>{r.actualPeriod}</dd>
            </>}
            <dt>材料证据</dt>
            <dd>
              {r.materials.length
                ? r.materials.map((m, i) => (
                    <div key={i}>
                      {m.url ? (
                        <a href={m.url} target="_blank" rel="noreferrer">
                          {m.label}
                        </a>
                      ) : (
                        m.label
                      )}
                    </div>
                  ))
                : "待核"}
            </dd>
          </dl>
        </details>
      ))}
    </section>
  );
}
