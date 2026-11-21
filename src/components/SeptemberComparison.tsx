import september from "../data/evidence/september-sea-ice-pdo.json";
import { useWorkspace } from "../domain/store";

const rows = september.map(([date, extent, pdo]) => ({
  year: Number(String(date).slice(0, 4)),
  extent: Number(extent),
  pdo: Number(pdo),
}));
const sources = {
  extent:
    "https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/N_09_extent_v4.0.csv",
  pdo: "https://psl.noaa.gov/pdo/data/pdo.timeseries.sstens.csv",
};
const series = [
  { key: "extent", name: "北半球海冰范围", unit: "百万 km²", color: "#147D52" },
  { key: "pdo", name: "PDO 指数", unit: "°C", color: "#225E9E" },
] as const;
export function SeptemberComparison({
  period,
}: {
  period: [number, number] | null;
}) {
  const {
    patch,
    state: { comparisonYear: year },
  } = useWorkspace();
  const points = rows.filter(
    (r) => !period || (r.year >= period[0] && r.year <= period[1]),
  );
  if (!points.length) return <p>当前年份范围没有可配对的 9 月记录。</p>;
  const current = points.find((r) => r.year === year) || points[0];
  const first = points[0].year,
    last = points[points.length - 1].year;
  const x = (y: number) => 4 + ((y - first) / Math.max(last - first, 1)) * 432;
  return (
    <section className="series-comparison" aria-label="海冰与 PDO 同期对照">
      <header>
        <h3>同年 9 月对照</h3>
        <small>
          {first}–{last} · {points.length} 个共同年份
        </small>
      </header>
      {series.map(({ key, name, unit, color }) => {
        const values = points.map((p) => p[key]),
          min = Math.min(...values),
          max = Math.max(...values);
        const y = (value: number) =>
          42 - (38 * (value - min)) / (max - min || 1);
        return (
          <div key={key} className="series-row">
            <span>
              {name}
              <strong style={{ color }}>
                {current[key]} <small>{unit}</small>
              </strong>
            </span>
            <svg
              viewBox="0 0 440 46"
              preserveAspectRatio="none"
              role="img"
              aria-label={
                name + "，" + current.year + "年9月：" + current[key] + unit
              }
            >
              <line x1="4" y1="42" x2="436" y2="42" stroke="#ced8df" />
              <polyline
                points={points
                  .map((p) => x(p.year) + "," + y(p[key]))
                  .join(" ")}
                stroke={color}
                fill="none"
                strokeWidth="1.8"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={x(current.year)}
                x2={x(current.year)}
                y1="2"
                y2="43"
                stroke="#8898a7"
                strokeDasharray="2 2"
              />
              <circle
                cx={x(current.year)}
                cy={y(current[key])}
                r="3.5"
                fill={color}
              />
            </svg>
          </div>
        );
      })}
      <label>
        {current.year} 年 9 月
        <input
          aria-label="共同观测年份"
          type="range"
          min={first}
          max={last}
          value={current.year}
          onChange={(e) => patch({ comparisonYear: Number(e.target.value) })}
        />
      </label>
      <footer>
        <button
          onClick={() =>
            patch({
              evidence: {
                id: "september-" + first + "-" + last,
                title: "9 月海冰范围与 PDO 配对表",
                source: "NSIDC G02135 v4 · NOAA PSL ensemble PDO",
                scope: first + "–" + last + " 年 · 每年 9 月月值",
                tabs: [
                  {
                    kind: "table",
                    label: "共同月份",
                    columns: ["月份", "海冰范围（百万 km²）", "PDO（°C）"],
                    rows: points.map((p) => [p.year + "-09", p.extent, p.pdo]),
                  },
                ],
              },
              previewKind: "table",
            })
          }
        >
          核对配对表
        </button>
        <a href={sources.extent} target="_blank" rel="noreferrer">
          NSIDC 海冰原表 ↗
        </a>
        <a href={sources.pdo} target="_blank" rel="noreferrer">
          PSL 指数原表 ↗
        </a>
      </footer>
    </section>
  );
}
