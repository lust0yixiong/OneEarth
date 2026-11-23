import { useEffect, useState } from "react";
import {
  Wind,
  Pause,
  Play,
  ArrowLeft,
  Table2,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Sun,
  Moon,
} from "lucide-react";
import { useWorkspace } from "../domain/store";
import { windForecastHours, windFrame, windManifest, windReferenceLabel, windTimeLabel } from "../domain/wind";
import { windLegendGradient, type WindTheme } from "../globe/wind-layer";
export function WindControls({
  ready,
  error,
  retry,
  theme,
  onThemeChange,
}: {
  ready: boolean;
  error: string;
  retry: () => void;
  theme: WindTheme;
  onThemeChange: (theme: WindTheme) => void;
}) {
  const [collapsed, setCollapsed] = useState(() => innerWidth <= 760);
  useEffect(() => {
    const media = matchMedia("(max-width: 760px)");
    const update = () => setCollapsed(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const { state: s, patch, inspectAsset, leaveDetail } = useWorkspace(),
    view = s.visualization;
  if (!view) return null;
  const frame = windFrame(view);
  return (
    <section
      className={"wind-controls" + (collapsed ? " collapsed" : "")}
      aria-label="风场可视化控制"
    >
      <div className="wind-heading">
        <span>
          <Wind size={17} />
          GFS · 全球风场
        </span>
        <small>数据快照</small>
        <button
          className="wind-collapse"
          aria-label={collapsed ? "展开风场控件" : "收起风场控件"}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>
      {collapsed && (
        <p className="wind-compact-status">
          {view.level === "10m" ? "近地面 10 m" : "250 hPa"} ·{" "}
          {windTimeLabel(frame)}
        </p>
      )}
      <div className="wind-controls-body" hidden={collapsed}>
        <div className="wind-appearance" role="group" aria-label="风场背景">
          <span>背景</span>
          <div className="wind-theme-switch">
            <button aria-pressed={theme === "light"} onClick={() => onThemeChange("light")}>
              <Sun aria-hidden="true" size={13} />浅色
            </button>
            <button aria-pressed={theme === "dark"} onClick={() => onThemeChange("dark")}>
              <Moon aria-hidden="true" size={13} />深色
            </button>
          </div>
        </div>
        <label className="wind-field-label">垂直层次</label>
        <div className="wind-levels" role="group" aria-label="风场垂直层次">
          {windManifest.levels.map((level) => (
            <button
              key={level.id}
              aria-pressed={view.level === level.id}
              onClick={() =>
                patch({
                  visualization: {
                    ...view,
                    level: level.id as typeof view.level,
                  },
                })
              }
            >
              {level.label}
            </button>
          ))}
        </div>
        <label className="wind-field-label">预报时效</label>
        <div className="wind-times" role="group" aria-label="风场预报时效">
          {windForecastHours.map((hour) => (
            <button
              key={hour}
              aria-pressed={view.forecastHour === hour}
              aria-label={`预报 ${hour} 小时`}
              onClick={() =>
                patch({
                  visualization: { ...view, forecastHour: hour as 0 | 6 | 12 },
                })
              }
            >
              <strong>+{hour} h</strong>
              <small>F{String(hour).padStart(3, "0")}</small>
            </button>
          ))}
        </div>
        <p className="wind-valid-time">有效时间 {windTimeLabel(frame)}</p>
        <div className="wind-play-row">
          <button
            className="wind-play"
            aria-label={view.playing ? "暂停风场流线" : "播放风场流线"}
            onClick={() =>
              patch({ visualization: { ...view, playing: !view.playing } })
            }
          >
            {view.playing ? <Pause size={14} /> : <Play size={14} />}流线
            {view.playing ? "播放中" : "已暂停"}
          </button>
          <label>
            <input
              type="checkbox"
              checked={view.color}
              onChange={(e) =>
                patch({ visualization: { ...view, color: e.target.checked } })
              }
            />
            风速着色
          </label>
        </div>
        <div className="wind-source-detail">
          <span>
            起报 {windReferenceLabel}
          </span>
          <span>全球 1° 原网格 · NOAA / NCEP</span>
        </div>
        {!ready && !error && (
          <p className="wind-load" role="status">
            正在载入并校验风场…
          </p>
        )}
        {error && (
          <div className="wind-load" role="alert">
            <p>{error}</p>
            <button onClick={retry}>
              <RotateCcw size={12} />
              重新载入
            </button>
          </div>
        )}
        <div className="wind-dataset-actions">
          <button
            onClick={() => inspectAsset("wind-0")}
            aria-label="风场数据速览"
          >
            <Table2 size={13} />
            数据速览与获取
          </button>
        </div>
        <small className="wind-motion-note">
          流线表示所选时刻的流动方向 · 时效单独切换
        </small>
        <button className="wind-exit" onClick={leaveDetail}>
          <ArrowLeft size={13} />
          {s.origin ? "返回进入前的结果" : "返回数据分布"}
        </button>
      </div>
    </section>
  );
}
export function WindLegend({ theme }: { theme: WindTheme }) {
  const { state: s } = useWorkspace();
  if (!s.visualization) return null;
  return (
    <div className="wind-legend" aria-label="风速色标">
      <div>
        <span>风速</span>
        <strong>m/s</strong>
      </div>
      <div className="wind-color-ramp" style={{ backgroundImage: windLegendGradient(theme) }} />
      <div>
        <span>0</span>
        <span>{s.visualization.level === "10m" ? "35" : "110"}</span>
      </div>
      <small>点选球面，查看所在网格与位置读值</small>
    </div>
  );
}
