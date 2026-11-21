import { useMemo, useState } from "react";
import { BookOpen, ChevronRight } from "lucide-react";
import {
  evaluateBatch,
  type AssessmentEvidence,
  type AssessmentFinding,
} from "../domain/research-assessment";
import { assetById } from "../domain/datasets";
import { assetMaterials } from "../domain/evidence";
import { useWorkspace } from "../domain/store";
import type { CandidateSet, EvidenceTab } from "../domain/types";
import "../styles/research-assessment.css";

function previewable(tab: EvidenceTab) {
  return (
    (tab.kind === "table" && !!tab.rows?.length) ||
    (tab.kind === "pdf" && !!tab.pages?.length) ||
    (tab.kind === "text" && !!tab.quote)
  );
}

function SourceEntry({
  source,
  batch,
}: {
  source: AssessmentEvidence;
  batch: CandidateSet;
}) {
  const { patch } = useWorkspace();
  const [expanded, setExpanded] = useState(false);
  const asset = source.assetId ? assetById.get(source.assetId) : undefined;
  const doc = useMemo(
    () =>
      expanded && asset
        ? assetMaterials(asset, batch.filters, batch.selection, null)
        : null,
    [expanded, asset, batch.filters, batch.selection],
  );
  const materials = doc?.tabs.filter(previewable) || [];
  return (
    <div className="assessment-source">
      <button
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        title={source.source}
      >
        <BookOpen size={12} />
        {source.title}
      </button>
      {expanded && (
        <div className="assessment-source-detail">
          <strong>{source.source}</strong>
          <p>{source.detail}</p>
          {doc &&
            materials.map((tab, i) => (
              <button
                key={i}
                onClick={() =>
                  patch({
                    evidence: {
                      ...doc,
                      id: doc.id + "/assessment/" + i,
                      title: tab.label,
                      url: tab.url || doc.url,
                      tabs: [tab],
                      fullSource: undefined,
                    },
                    previewKind: tab.kind,
                  })
                }
              >
                {tab.kind === "pdf"
                  ? "查看原页"
                  : tab.kind === "table"
                    ? "核对表格"
                    : "查看原文摘录"}{" "}
                · {tab.label}
              </button>
            ))}
          {source.url && (
            <a href={source.url} target="_blank" rel="noreferrer">
              {asset ? "打开发布方来源" : "查看相关论文"} ↗
            </a>
          )}
          {asset?.tabs
            .filter((t) => t.kind === "web" && t.url && t.url !== source.url)
            .map((t) => (
              <a key={t.url} href={t.url} target="_blank" rel="noreferrer">
                {t.label} ↗
              </a>
            ))}
        </div>
      )}
    </div>
  );
}

export function ResearchAssessment({ batch }: { batch: CandidateSet }) {
  const assessment = useMemo(() => evaluateBatch(batch), [batch]);
  const sources = new Map(assessment.evidence.map((item) => [item.id, item]));
  function row(finding: AssessmentFinding) {
    return (
      <details key={finding.id} className="assessment-row">
        <summary>
          <span>{finding.title}</span>
          <small>{finding.status}</small>
          <ChevronRight size={13} />
        </summary>
        <p>{finding.detail}</p>
        <div
          className="assessment-sources"
          aria-label={finding.title + "的依据"}
        >
          {finding.evidenceIds.map((id) => {
            const source = sources.get(id);
            return (
              source && <SourceEntry key={id} source={source} batch={batch} />
            );
          })}
        </div>
      </details>
    );
  }
  return (
    <section className="research-assessment" aria-label="联合使用判断">
      <header>
        <h3>联合使用判断</h3>
        <strong>{assessment.status}</strong>
      </header>
      <p className="assessment-summary">{assessment.summary}</p>
      {assessment.findings.map(row)}
      {assessment.roles.length > 0 && (
        <details className="assessment-roles">
          <summary>
            逐项核对资料角色{" "}
            <span>
              {assessment.roles.filter((r) => r.assetIds.length).length} /{" "}
              {assessment.roles.length} 项已选来源
            </span>
          </summary>
          {assessment.roles.map((role) =>
            row({
              ...role,
              title: role.title + (role.required ? "" : "（补充）"),
            }),
          )}
        </details>
      )}
    </section>
  );
}
