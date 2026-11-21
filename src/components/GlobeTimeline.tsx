import { useMemo, useState } from "react";
import { CalendarRange, ChevronLeft, ChevronRight, X } from "lucide-react";
import type { Filters } from "../domain/types";
import { windowFilters, windowLabel } from "../domain/time-window";
import type { Observation } from "../domain/push-observations";
import "../styles/globe-timeline.css";

type Props = {
  onAskTime:()=>void;
  filters: Filters;
  onChange: (f: Partial<Filters>) => void;
  mode: "year" | "month" | "scene";
  years: [number, number];
  records: Observation[];
};
const monthIndex = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();
const monthText = (i: number) =>
  new Date(Date.UTC(Math.floor(i / 12), i % 12, 1)).toISOString().slice(0, 7);
export function GlobeTimeline({
  filters,
  onChange,onAskTime,
  mode,
  years,
  records,
}: Props) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<[string, string]>(["", ""]);
  const times = useMemo(() => [...new Set(records.map((r) => Date.parse(r.observedAt))
    .filter(Number.isFinite))].sort((a, b) => a - b), [records]);
  // Keep the scale stationary while a handle changes the filter.
  const [dragScale, setDragScale] = useState<{
    selection: string;
    bounds: [number, number];
  } | null>(null);
  const { period, utcWindow: w } = filters;
  const label = w
    ? windowLabel(w)
    : period
      ? period[0] === period[1]
        ? period[0] + " 年"
        : period.join("–") + " 年"
      : "全部时间";
  const lo = mode === "scene" ? 0 : mode === "year" ? years[0] : years[0] * 12;
  const hi =
    mode === "scene"
      ? Math.max(0, times.length - 1)
      : mode === "year"
        ? years[1]
        : years[1] * 12 + 11;
  let start = lo, end = hi;
  if (period || w) {
    const startDate = w ? new Date(w[0]) : new Date(Date.UTC(period![0], 0));
    const endDate = w ? new Date(w[1] - 1) : new Date(Date.UTC(period![1] + 1, 0) - 1);
    if (mode === "scene") {
      start = times.findIndex(t => t >= startDate.getTime());
      end = times.filter(t => t <= endDate.getTime()).length - 1;
    } else if (mode === "month") {
      start = monthIndex(startDate);
      end = monthIndex(endDate);
    } else {
      start = startDate.getUTCFullYear();
      end = endDate.getUTCFullYear();
    }
  }
  const disabled = mode === "scene" && !times.length;
  const hasInterval = !disabled && start >= lo && start <= end && end <= hi;
  const selectionKey = JSON.stringify([mode, period, w ?? null]);
  const focused = !!(period || w) && hasInterval;
  const bounds: [number, number] = dragScale?.selection === selectionKey
    && dragScale.bounds[0] >= lo && dragScale.bounds[1] <= hi
    && dragScale.bounds[0] <= start && dragScale.bounds[1] >= end
    ? dragScale.bounds
    : focused && start !== end ? [start, end]
    : focused ? [Math.max(lo, start - 1), Math.min(hi, end + 1)] : [lo, hi];
  const [axisMin, axisMax] = bounds;
  const percent = (i: number) => axisMax === axisMin ? 50 : 100 * (i - axisMin) / (axisMax - axisMin);
  const valueText = (i: number) =>
    mode === "scene"
      ? times.length
        ? new Date(times[i]).toISOString().replace("T", " ").slice(0, 19)
        : "暂无观测"
      : mode === "month"
        ? monthText(i)
        : String(i);
  function select(first: number, last: number, keepScale = false) {
    let next: Pick<Filters, "period" | "utcWindow">;
    if (mode === "year") {
      next = { period: [first, last], utcWindow: null };
    } else {
      const from = mode === "scene" ? times[first] : Date.UTC(Math.floor(first / 12), first % 12);
      const until = mode === "scene" ? times[last] + 1 : Date.UTC(Math.floor(last / 12), last % 12 + 1);
      if (!Number.isFinite(from) || !Number.isFinite(until)) return;
      next = windowFilters([from, until]);
    }
    setDragScale(keepScale ? { selection: JSON.stringify([mode, next.period, next.utcWindow]), bounds } : null);
    onChange(next);
  }
  function shift(delta: number) {
    if (focused) select(start + delta, end + delta);
    else {
      const instant = Math.max(lo, Math.min(hi, hi + delta));
      select(instant, instant);
    }
  }
  function toggle() {
    if (!open) {
      const field = mode === "scene" ? String : valueText;
      setRange([field(hasInterval ? start : lo), field(hasInterval ? end : hi)]);
    }
    setOpen(!open);
  }
  const decode = (raw: string) =>
    mode === "month"
      ? /^\d{4}-(0[1-9]|1[0-2])$/.test(raw)
        ? monthIndex(new Date(raw + "-01T00:00:00Z"))
        : NaN
      : raw
        ? Number(raw)
        : NaN;
  const [first, last] = range.map(decode);
  return (
    <div className="globe-timeline" role="group" aria-label="观测时间轴">
      <button className="time-toggle" aria-expanded={open} onClick={toggle}>
        <CalendarRange size={14} />
        时间轴 <b>{label}</b>
      </button>
      <button
        aria-label="上一时段"
        disabled={!hasInterval || (focused && start <= lo)}
        onClick={() => shift(-1)}
      >
        <ChevronLeft size={14} />
      </button>
      {hasInterval ? (
        <div className="time-scale">
          <span className="time-edge">{valueText(axisMin)}</span>
          <div className="time-rail" onClick={e => {
            if (e.target !== e.currentTarget) return;
            const box = e.currentTarget.getBoundingClientRect();
            const position = Math.max(0, Math.min(1, (e.clientX - box.left - 6) / Math.max(1, box.width - 12)));
            const index = Math.round(axisMin + position * (axisMax - axisMin));
            select(index, index, true);
          }}>
            <div className="time-track">
              <span style={{left: percent(start) + "%", right: (100 - percent(end)) + "%"}} />
            </div>
            {(["起始", "结束"] as const).map((name, i) => (
              <input key={name} type="range" aria-label={name + "时间刻度"}
                min={axisMin} max={axisMax} value={i ? end : start}
                aria-valuetext={valueText(i ? end : start)}
                style={{ zIndex: start === end && start === axisMax && !i ? 2 : undefined }}
                onChange={e => {
                  const value = Number(e.target.value);
                  select(i ? start : Math.min(value, end), i ? Math.max(value, start) : end, true);
                }} />
            ))}
          </div>
          <span className="time-edge">{valueText(axisMax)}{mode === "scene" ? " UTC" : ""}</span>
        </div>
      ) : <span className="time-empty">当前时段暂无观测</span>}
      <button
        aria-label="下一时段"
        disabled={!hasInterval || (focused && end >= hi)}
        onClick={() => shift(1)}
      >
        <ChevronRight size={14} />
      </button>
      {period && <button className="ask-time" onClick={onAskTime}>用此时段提问</button>}
      {period && (
        <button
          aria-label="恢复全部时间"
          title="恢复全部时间"
          onClick={() => {
            setDragScale(null);
            onChange({ period: null, utcWindow: null });
            setOpen(false);
          }}
        >
          <X size={14} />
        </button>
      )}
      {open && (
        <div className="time-range-panel">
          <strong>
            {mode === "scene"
              ? "采集时间 · UTC"
              : mode === "year"
                ? "研究时段 · 年"
                : "研究时段 · 月"}
          </strong>
          {disabled ? (
            <span>当前范围暂无观测时刻</span>
          ) : (
            <>
              {(["起始", "结束"] as const).map((name, i) => (
                <label key={name}>
                  {name}
                  {mode === "scene" ? (
                    <select
                      aria-label={name + "采集时刻"}
                      value={range[i]}
                      onChange={(e) =>
                        setRange(
                          i
                            ? [range[0], e.target.value]
                            : [e.target.value, range[1]],
                        )
                      }
                    >
                      {times.map((t, k) => (
                        <option key={t} value={k}>
                          {valueText(k)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label={name + "时段"}
                      type={mode === "month" ? "month" : "number"}
                      value={range[i]}
                      min={valueText(lo)}
                      max={valueText(hi)}
                      onChange={(e) =>
                        setRange(
                          i
                            ? [range[0], e.target.value]
                            : [e.target.value, range[1]],
                        )
                      }
                    />
                  )}
                </label>
              ))}
              <button
                disabled={
                  !Number.isInteger(first) ||
                  !Number.isInteger(last) ||
                  first > last ||
                  first < lo ||
                  last > hi
                }
                onClick={() => {
                  select(first, last);
                  setOpen(false);
                }}
              >
                应用时段
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
