import { assets } from "../domain/datasets";
import { DatasetActions } from "./DatasetActions";
import { ChevronDown, FileSearch } from "lucide-react";
import { useWorkspace } from "../domain/store";
import { caseById, resources, sourceLabels } from "../domain/catalog";
import { needVisible, spatialEntries } from "../domain/spatial";
export function NeedList() {
  const { state: s, setFilters } = useWorkspace();
  const c = caseById(s.caseId);
  if (!c) return null;
  const available = c.needs
    .map((_, i) => i)
    .filter((i) => needVisible(c.id, i, s.filters));
  return (
    <section className="need-section" aria-label="当前数据需求">
      <div className="section-heading">
        <span>数据需求</span>
        <small>
          {available.length} / {c.needs.length}
        </small>
      </div>
      <div className="compact-filters">
        <select
          aria-label="筛选需求项"
          value={s.filters.need}
          onChange={(e) => setFilters({ need: +e.target.value })}
        >
          <option value={-1}>全部需求</option>
          {c.needs.map((n, i) => (
            <option key={i} value={i}>
              {n.name}
            </option>
          ))}
        </select>
        <select
          aria-label="按数据类型筛选"
          value={s.filters.type}
          onChange={(e) => setFilters({ type: e.target.value })}
        >
          <option value="">全部类型</option>
          {[
            ...new Set(
              resources
                .filter((r) => r.caseId === c.id)
                .flatMap((r) => r.categories),
            ),
          ].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select
          aria-label="按发现来源筛选"
          value={s.filters.source}
          onChange={(e) => setFilters({ source: e.target.value })}
        >
          <option value="">全部来源</option>
          {Object.entries(sourceLabels).map(([k, v]) => (
            <option value={k} key={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {available.map((i) => {
        const n = c.needs[i],
          r = resources.find((r) => r.caseId === c.id && r.needIndex === i)!;
        let fit = r.fit;
        let why = r.why;
        if (
          c.id === "Q02" &&
          i === 0 &&
          s.filters.maxDem !== null &&
          s.filters.maxDem < 30
        ) {
          fit = "未满足";
          why =
            "当前候选为 30 米级 GLO-30，超过指定的 " +
            s.filters.maxDem +
            " 米上限。";
        }
        const count = spatialEntries(c.id, s.filters, s.layer).filter(
          (e) => e.need === i,
        ).length;
        return (
          <article className="need-card" key={i}>
            <div className="need-card-heading">
              <h3>{n.name}</h3>
              <span
                className={
                  "fit " +
                  (fit === "未满足"
                    ? "unmet"
                    : fit === "部分满足"
                      ? "partial"
                      : "unknown")
                }
              >
                {fit}
              </span>
            </div>
            <p className="resource-title">{n.product}</p>
            <small className="need-meta">
              {r.categories.join(" / ")} · {n.status}
            </small>
            {(s.filters.period ||
              s.filters.place ||
              s.filters.depth ||
              s.filters.source) && (
              <small className="condition-count">
                当前筛选可定位 {count} 条
              </small>
            )}
            <details>
              <summary>
                判断依据 <ChevronDown size={12} />
              </summary>
              <p>{why}</p>
              <p>{n.detail}</p>
              <small>{n.source}</small>
            </details>
            {assets
              .filter(
                (a) =>
                  a.caseId === c.id &&
                  a.needIndex === i &&
                  a.kind !== "requirement",
              )
              .map((a) => (
                <div key={a.id}>
                  {a.subasset && <strong>{a.title}</strong>}
                  <DatasetActions caseId={c.id} index={i} asset={a} />
                </div>
              ))}
          </article>
        );
      })}
      {!available.length && (
        <div className="empty-state">
          <FileSearch />
          <p>这个来源尚无已核实的关联资料。</p>
          <button
            onClick={() => setFilters({ source: "", type: "", need: -1 })}
          >
            恢复全部需求
          </button>
        </div>
      )}
      <details className="gap-box">
        <summary>
          共同使用还缺什么 <ChevronDown size={14} />
        </summary>
        <p>{c.gap}</p>
        {!c.verified && <p>题库候选线索 · {c.clues.join("、")}</p>}
      </details>
    </section>
  );
}
