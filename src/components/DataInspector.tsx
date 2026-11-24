import {useLayoutEffect} from "react";
import { dataRecipeFor } from "../domain/data-preview";
import { evidenceFor } from "../domain/evidence";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  FileSearch,
  ExternalLink,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronUp,
  Code2,
  MapPin,
  ArrowUpRight,
} from "lucide-react";
import { useWorkspace } from "../domain/store";
import {
  ctdRows,
  dataSelection,
  selectedStation,
  eligibleStations,
  variableInfo,
  valueColor,
  dataCamera,
  frontsFor,
} from "../domain/visualization";
import type { DataView, Filters } from "../domain/types";
function ProfileChart({
  view,
  filters,
  onDepth,
}: {
  view: Extract<DataView, { kind: "ctd" }>;
  filters: Filters;
  onDepth: (n: number) => void;
}) {
  const [hover, setHover] = useState<(number | null)[] | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [chartSize, setChartSize] = useState({ width: 700, height: 230 });
  useEffect(() => {
    const host = svg.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      if (width > 0 && height > 0)
        setChartSize((previous) =>
          previous.width === width && previous.height === height
            ? previous
            : { width, height },
        );
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  const samples = (ctdRows[view.stationId] || []).filter(
    (row) =>
      !filters.depth ||
      (row[0]! >= filters.depth[0] && row[0]! <= filters.depth[1]),
  );
  const info = variableInfo(view.variable),
    column = view.variable === "temperature" ? 1 : 2;
  const { width, height } = chartSize;
  const left = 58,
    right = 25,
    top = 33,
    bottom = 29;
  const minDepth = samples.length ? Math.min(...samples.map((r) => r[0]!)) : 0,
    maxDepth = samples.length ? Math.max(...samples.map((r) => r[0]!)) : 1;
  const x = (v: number) =>
    left +
    ((v - info.min) / (info.max - info.min || 1)) * (width - left - right);
  const y = (d: number) =>
    top +
    ((d - minDepth) / (maxDepth - minDepth || 1)) * (height - top - bottom);
  const curve = useMemo(() => {
    let path = "",
      start = true;
    for (const row of samples) {
      if (row[column] === null) {
        start = true;
        continue;
      }
      path +=
        (start ? "M" : "L") +
        x(row[column]!).toFixed(2) +
        "," +
        y(row[0]!).toFixed(2);
      start = false;
    }
    return path;
  }, [view.stationId, view.variable, filters.depth, width, height]);
  const rowAt = (
    event: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>,
  ) => {
    const box = svg.current!.getBoundingClientRect();
    const localY = ((event.clientY - box.top) / box.height) * height;
    const target =
      minDepth +
      ((localY - top) / (height - top - bottom)) * (maxDepth - minDepth);
    const closest = samples.reduce<(number | null)[] | null>(
      (best, row) =>
        !best || Math.abs(row[0]! - target) < Math.abs(best[0]! - target)
          ? row
          : best,
      null,
    );
    return closest;
  };
  const current =
    hover ||
    samples.reduce<(number | null)[] | null>(
      (best, row) =>
        !best ||
        Math.abs(row[0]! - view.depth) < Math.abs(best[0]! - view.depth)
          ? row
          : best,
      null,
    );
  return (
    <div className="profile-chart">
      <div className="profile-readout">
        <span>
          {selectedStation(view).name.split("_").pop()} · {samples.length}{" "}
          条原始层值
        </span>
        <strong>
          {current
            ? "深度 " +
              current[0] +
              " m · " +
              (current[column] === null
                ? "缺测"
                : current[column]!.toFixed(4) + " " + info.unit)
            : "当前条件下无观测"}
        </strong>
      </div>
      <svg
        ref={svg}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={info.label + "随采样深度变化的实测剖面，深度向下增加"}
        onPointerMove={(event) => setHover(rowAt(event))}
        onPointerLeave={() => setHover(null)}
        onClick={(event) => {
          const row = rowAt(event);
          if (row) {
            setHover(row);
            onDepth(row[0]!);
          }
        }}
      >
        <text x={left} y={13} className="chart-axis-title">
          {info.label} · {info.unit}
        </text>
        <text x={5} y={17} className="chart-axis-title">
          深度 m
        </text>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const v = info.min + t * (info.max - info.min);
          const d = minDepth + t * (maxDepth - minDepth);
          return (
            <g key={t}>
              <line
                x1={x(v)}
                x2={x(v)}
                y1={top}
                y2={height - bottom}
                className="chart-grid"
              />
              <line
                x1={left}
                x2={width - right}
                y1={y(d)}
                y2={y(d)}
                className="chart-grid"
              />
              <text x={x(v)} y={height - 8} textAnchor="middle">
                {v.toFixed(1)}
              </text>
              <text x={left - 10} y={y(d) + 3} textAnchor="end">
                {d.toFixed(0)}
              </text>
            </g>
          );
        })}
        <path d={curve} fill="none" stroke="#147d69" strokeWidth="1.8" />
        {view.depth >= minDepth && view.depth <= maxDepth && (
          <line
            x1={left}
            x2={width - right}
            y1={y(view.depth)}
            y2={y(view.depth)}
            stroke="#b08944"
            strokeDasharray="5 4"
          />
        )}
        {current && current[column] !== null && (
          <circle
            cx={x(current[column]!)}
            cy={y(current[0]!)}
            r={3.5}
            fill="#d29a40"
            stroke="white"
            strokeWidth="1.5"
          />
        )}
      </svg>
      <small>
        深度向下增加 · 指向曲线查看原值，点击设置球面采样层 · 空值处断开
      </small>
    </div>
  );
}
export function DataInspector() {
  const {
    state: s,
    patch,
    preview,
    leaveDetail,
    inspectAsset,
    registerWorkspacePanel,
  } = useWorkspace();
  const [collapsed, setCollapsed] = useState(false);
  const view = s.dataView;
  const compact = !!s.evidence || collapsed;
  useLayoutEffect(()=>view?registerWorkspacePanel("inspector",{inspector:compact?"collapsed":"expanded"}):undefined,
    [view,compact,registerWorkspacePanel]);
  if (!view) return null;
  const setView = (next: DataView, focus = false) =>
    patch({
      dataView: next,
      ...(next.kind === "front"
        ? { filters: { ...s.filters, place: next.glacier } }
        : {}),
      ...(focus ? { selection: null } : {}),
      ...(focus ? { camera: dataCamera(next) } : {}),
    });
  const gridSamples = dataSelection(view, s.filters, s.selection);
  const readDataEvidence = () => {
    if (view.kind === "ctd") {
      const station = selectedStation(view);
      const doc = evidenceFor("Q19", 4, s.filters, [
        {
          ...station,
          label: station.name,
          center: station.center as [number, number],
          need: 4,
          origin: "原始 CTD 采样站次",
        },
      ]);
      patch({
        evidence: {
          ...doc,
          id: doc.id + "-" + station.name,
          scope: doc.scope + " · " + station.name,
        },
        previewKind: "table",
      });
    } else preview(s.caseId!, 1);
  };
  const fullFronts =
    view.kind === "front"
      ? frontsFor({ ...view, epoch: "compare" }, { ...s.filters, period: null })
      : [];
  const title =
    view.kind === "ctd"
      ? "79 North · 历史温盐剖面"
      : "湖终止型冰川 · 实际前缘位置";
  return (
    <section
      className={"data-inspector" + (compact ? " compact" : "")}
      aria-label="数据内容可视化"
    >
      <div className="data-inspector-heading">
        <span className="eyebrow">
          <ChartNoAxesCombined size={14} />
          数据速览
        </span>
        <div className="icon-actions">
          <button
            aria-label="查看数据处理说明"
            title="处理说明与代码"
            onClick={() =>
              patch({
                evidence: dataRecipeFor(view, s.filters),
                previewKind: "trace",
              })
            }
          >
            <Code2 size={14} />
          </button>
          <button
            aria-label={compact ? "展开数据速览" : "收起数据速览"}
            title={compact ? "返回数据速览" : "收起数据速览"}
            onClick={() => {
              if (s.evidence) patch({ evidence: null });
              setCollapsed(!compact);
            }}
          >
            {compact || collapsed ? (
              <ChevronUp size={15} />
            ) : (
              <ChevronDown size={15} />
            )}
          </button>
          <button
            onClick={() =>
              inspectAsset(view.kind === "ctd" ? "Q19-4" : "Q20-1")
            }
          >
            概览与获取
          </button>
          <button onClick={readDataEvidence}>
            <FileSearch size={14} />
            <span>原表与来源</span>
          </button>
          <button aria-label="关闭数据可视化" onClick={leaveDetail}>
            <X size={16} />
          </button>
        </div>
      </div>
      <h2>{title}</h2>
      <div className="data-inspector-content" hidden={compact}>
        {view.kind === "ctd" ? (
          <>
            <div className="data-controls">
              <label>
                变量
                <select
                  aria-label="剖面变量"
                  value={view.variable}
                  onChange={(e) =>
                    setView({
                      ...view,
                      variable: e.target.value as "temperature" | "salinity",
                    })
                  }
                >
                  <option value="temperature">海水温度 °C</option>
                  <option value="salinity">实用盐度（无量纲）</option>
                </select>
              </label>
              <label>
                站次
                <select
                  aria-label="采样站次"
                  value={view.stationId}
                  onChange={(e) =>
                    setView({ ...view, stationId: e.target.value }, true)
                  }
                >
                  {eligibleStations(s.filters).map((station) => (
                    <option key={station.name} value={station.name}>
                      {station.name.split("_").pop()} ·{" "}
                      {station.date.replace("T", " ")}（原表时间）
                    </option>
                  ))}
                </select>
              </label>
              <label>
                球面采样层
                <input
                  aria-label="球面采样深度"
                  type="number"
                  min="0"
                  max="600"
                  step="0.1"
                  value={view.depth}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 0 && n <= 600)
                      setView({ ...view, depth: n });
                  }}
                />
                m
              </label>
            </div>
            {gridSamples.length > 0 && (
              <label className="grid-station-picker">
                选中网格 · {gridSamples.length} 个有效站次
                <select
                  aria-label="查看格内站次"
                  value={
                    gridSamples.some((sample) => sample.name === view.stationId)
                      ? view.stationId
                      : ""
                  }
                  onChange={(e) =>
                    setView({ ...view, stationId: e.target.value })
                  }
                >
                  <option value="" disabled>
                    选择剖面
                  </option>
                  {gridSamples.map((sample) => (
                    <option key={sample.name} value={sample.name}>
                      {sample.name.split("_").pop()}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <ProfileChart
              key={
                view.stationId + view.variable + JSON.stringify(s.filters.depth)
              }
              view={view}
              filters={s.filters}
              onDepth={(depth) => setView({ ...view, depth })}
            />
          </>
        ) : (
          <>
            <div className="data-controls">
              <label>
                冰川
                <select
                  aria-label="前缘冰川"
                  value={view.glacier}
                  onChange={(e) =>
                    setView(
                      {
                        ...view,
                        glacier: e.target.value as "Mendenhall" | "Alsek",
                      },
                      true,
                    )
                  }
                >
                  <option value="Mendenhall">Mendenhall Glacier</option>
                  <option value="Alsek">Alsek Glacier</option>
                </select>
              </label>
              <label>
                时相
                <select
                  aria-label="前缘时相"
                  value={view.epoch}
                  onChange={(e) =>
                    setView({
                      ...view,
                      epoch: e.target.value as "first" | "last" | "compare",
                    })
                  }
                >
                  <option value="compare">首末时相对照</option>
                  <option value="first">首期前缘</option>
                  <option value="last">末期前缘</option>
                </select>
              </label>
            </div>
            <div className="front-observations">
              {frontsFor({ ...view, epoch: "compare" }, s.filters).map(
                (shape) => (
                  <button
                    key={shape.key}
                    aria-pressed={
                      view.epoch ===
                      (shape.key === fullFronts[0]?.key ? "first" : "last")
                    }
                    onClick={() =>
                      setView({
                        ...view,
                        epoch:
                          shape.key === fullFronts[0]?.key ? "first" : "last",
                      })
                    }
                  >
                    <span
                      style={{
                        background:
                          shape.key === fullFronts[0]?.key
                            ? "#b16b34"
                            : "#147d69",
                      }}
                    />
                    <div>
                      <strong>{shape.label.split(" · ")[1]}</strong>
                      <small>作者提供的实际前缘线</small>
                    </div>
                    <MapPin size={15} />
                  </button>
                ),
              )}
            </div>
            <p className="data-scope-note">
              本次载入两条冰川各自的首末前缘线。可切换实际日期或同时对照；前缘线的地理形状直接绘制在球面。
            </p>
            <a
              className="data-source-link"
              href="https://doi.org/10.5281/zenodo.15241675"
              target="_blank"
              rel="noreferrer"
            >
              Caldwell 等 · 作者数据存档
              <ArrowUpRight size={12} />
            </a>
          </>
        )}
      </div>
    </section>
  );
}
