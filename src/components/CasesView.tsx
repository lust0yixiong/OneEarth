import { useEffect, useState } from "react";
import { ArrowUpRight, ArrowRight, Check, Search } from "lucide-react";
import { geoOrthographic, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import atlas from "world-atlas/land-110m.json";
import { visualizationCatalog } from "../domain/visualization-catalog";
import { researchTasks } from "../domain/research-task";
import { hasLocalMaterial } from "../domain/results";
import { assets } from "../domain/datasets";
import { cases, featuredIds } from "../domain/catalog";
import { useWorkspace } from "../domain/store";
import { regionalIds, type RegionalId } from "../domain/regional-cases";
import { globeCases } from "../domain/regional-cases";
import { RegionalExplorer } from "./RegionalExplorer";
import {LiveLightning} from "./LiveLightning";
import {EarthquakeCase} from "./EarthquakeCase";
type LiveAtlas="live-lightning"|"earthquakes";
function currentExplorer():RegionalId|LiveAtlas|null {
  const id=new URL(location.href).searchParams.get("atlas");
  if(id==="live-lightning" || id==="earthquakes")return id;
  return id && regionalIds.includes(id as RegionalId) ? id as RegionalId : null;
}
const regions: Record<string, [number, number]> = {
  Q02: [-55, 65],
  Q07: [70, 35],
  Q14: [32.5, 41.5],
  Q19: [-24, 79],
  Q20: [-143, 62],
};
const subtitles: Record<string, string> = {
  Q02: "阿尔卑斯与阿拉斯加",
  Q07: "青藏高原西部 · 跨国窗口",
  Q14: "土耳其 · 巴尔滕省",
  Q19: "格陵兰 · 79 North",
  Q20: "阿拉斯加与加拿大西北部",
};
const land = feature(atlas as any, (atlas as any).objects.land);
function CaseMap({ id }: { id: string }) {
  const centre = regions[id];
  const projection = geoOrthographic()
    .rotate(centre.map((v) => -v) as [number, number])
    .translate([150, 112])
    .scale(106);
  const path = geoPath(projection);
  return (
    <svg viewBox="0 0 300 195" aria-hidden="true">
      <path d={path({ type: "Sphere" }) || ""} fill="#d7e6db" />
      <path
        d={path(land as any) || ""}
        fill="#ecf0e4"
        stroke="#9ebaa8"
        strokeWidth=".6"
      />
      <circle cx="150" cy="112" r="5" fill="#258f5b" />
      <circle
        cx="150"
        cy="112"
        r="11"
        fill="none"
        stroke="#258f5b"
        strokeWidth="1"
      />
    </svg>
  );
}
export function CasesView() {
  const { openCase, openVisualization } = useWorkspace();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [explorer,setExplorer]=useState(currentExplorer);
  const detail=new URL(location.href).searchParams.get("detail")==="1";
  useEffect(()=>{
    const read=()=>setExplorer(currentExplorer());
    window.addEventListener("popstate",read);
    return ()=>window.removeEventListener("popstate",read);
  },[]);
  useEffect(()=>{if(explorer && explorer!=="live-lightning" && explorer!=="earthquakes" && (!detail || explorer==="rain"))openVisualization(explorer,null);},[explorer,detail,openVisualization]);
  function navigateLive(atlas:LiveAtlas|null){
    const url=new URL(location.href);
    if(atlas)url.searchParams.set("atlas",atlas);else url.searchParams.delete("atlas");
    history.pushState(history.state,"",url);
    setExplorer(currentExplorer());
  }
  if(explorer==="earthquakes")return <EarthquakeCase back={()=>navigateLive(null)}/>;
  if(explorer==="live-lightning")return <LiveLightning back={()=>navigateLive(null)}/>;
  if(explorer && detail && explorer!=="rain")return <div className="cases-view"><RegionalExplorer key={explorer} id={explorer} onBack={()=>openVisualization(explorer,null)}/></div>;
  const matching = cases.filter(
    (c) =>
      !!researchTasks[c.id] &&
      (!group || researchTasks[c.id]?.group === group) &&
      [c.id, c.title, c.question]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section className="cases-view">
      <header className="page-heading">
        <h1>案例</h1>
      </header>
      <section className="case-section" aria-labelledby="viz-case-heading">
        <h2 id="viz-case-heading">数据可视化</h2>
        <button className="visual-case" onClick={()=>navigateLive("live-lightning")}>
          <img src="/visualizations/regional/lightning-globe.webp" width="100" height="100" alt=""/>
          <span><strong>全球雷暴与天气实况</strong><small>全球气象站报告 · 美洲卫星闪电</small></span><ArrowUpRight size={18}/>
        </button>
        <button className="visual-case" onClick={()=>navigateLive("earthquakes")}>
          <span className="quake-preview" aria-hidden="true"><CaseMap id="Q20"/></span>
          <span><strong>全球地震</strong><small>USGS 近 24 小时地震 · 全球地震台站</small></span><ArrowUpRight size={18}/>
        </button>
        {visualizationCatalog.map(v=><button key={v.id} className="visual-case" onClick={()=>openVisualization(v.id,null)}>
          <img src={v.preview} width="100" height="100" alt="" />
          <span><strong>{v.title}</strong><small>{v.dataset} · {v.level}</small><small>{v.subtitle}</small></span>
          <ArrowUpRight size={18}/>
        </button>)}
        {regionalIds.map(id=>{
          const v=globeCases[id];
          return <button key={id} className="visual-case" onClick={()=>openVisualization(id,null)}>
            <img src={"/visualizations/regional/"+id+"-globe.webp"} width="100" height="100" alt=""/>
            <span><strong>{v.title}</strong><small>{v.dataset}</small><small>{v.effect}</small></span>
            <ArrowUpRight size={18}/>
          </button>;
        })}
        <button className="visual-case" onClick={()=>openVisualization("forest",null)}>
          <img src="/visualizations/haina/1846764/20230715.webp" width="100" height="100" alt=""/>
          <span><strong>{globeCases.forest.title}</strong><small>{globeCases.forest.dataset}</small><small>{globeCases.forest.effect}</small></span>
          <ArrowUpRight size={18}/>
        </button>
        <button className="visual-case" onClick={()=>openVisualization("c40",null)}>
          <img src="/visualizations/haina/1846639/shanghai.webp" width="100" height="100" alt=""/>
          <span><strong>{globeCases.c40.title}</strong><small>{globeCases.c40.dataset}</small><small>{globeCases.c40.effect}</small></span>
          <ArrowUpRight size={18}/>
        </button>
      </section>
      <section className="case-section" aria-labelledby="science-case-heading">
      <h2 id="science-case-heading">科学问题案例</h2>
      <div className="featured-cases">
        {featuredIds.map((id) => {
          const c = cases.find((c) => c.id === id)!;
          return (
            <button
              className="featured-case"
              key={id}
              onClick={() => openCase(id)}
            >
              <div className="case-map">
                <CaseMap id={id} />
                <span>{id}</span>
                <span className="case-entry">
                  <ArrowUpRight size={18} />
                </span>
              </div>
              <div className="case-copy">
                <small>{subtitles[id]}</small>
                <h2>{c.title}</h2>
                <p>{c.question}</p>
                <footer>
                  <span>
                    <Check size={12} />
                    一手材料
                  </span>
                  <span>{c.needs.length} 项需求</span>
                </footer>
              </div>
            </button>
          );
        })}
      </div>
      <div className="regional-cases">
        {cases
          .filter((c) =>
            ["glacier", "dongting", "manaus"].includes(c.id),
          )
          .map((c) => (
            <button key={c.id} onClick={() => openCase(c.id)}>
              <span>
                {c.id === "dongting"
                  ? "中国 · 站区观测"
                  : c.id === "manaus"
                    ? "巴西 · 站区观测"
                    : "全球 · 数据分布"}
              </span>
              <h3>{c.title}</h3>
              <p>{c.question}</p>
              <ArrowUpRight size={16} />
            </button>
          ))}
      </div>
      <div className="case-library-heading">
        <div>
          <h2>研究题库</h2>
        </div>
        <label className="search-field">
          <Search size={15} />
          <input
            aria-label="搜索研究案例"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索问题…"
          />
        </label>
      </div>
      <div className="case-filters" aria-label="按科研任务筛选">
        {["", ...new Set(Object.values(researchTasks).map((t) => t.group))].map(
          (g) => (
            <button
              key={g}
              aria-pressed={group === g}
              onClick={() => setGroup(g)}
            >
              {g || "全部任务"}
            </button>
          ),
        )}
      </div>
      <div className="case-library">
        {matching.map((c) => (
          <button key={c.id} onClick={() => openCase(c.id)}>
            <span className="case-number">{c.id}</span>
            <div>
              <h3>{c.title}</h3>
              <p>{c.question}</p>
            </div>
            <span
              className={
                "case-state " +
                (assets.some((a) => a.caseId === c.id && hasLocalMaterial(a))
                  ? "verified"
                  : "")
              }
            >
              {assets.some((a) => a.caseId === c.id && hasLocalMaterial(a))
                ? "有本地材料"
                : assets.some(
                      (a) => a.caseId === c.id && a.kind !== "requirement",
                    )
                  ? "有来源目录"
                  : "需求待补"}
            </span>
            <ArrowRight size={16} />
          </button>
        ))}
      </div>
      {!matching.length && (
        <div className="empty-state">
          没有找到这个案例，可以尝试问题中的主题词。
        </div>
      )}
      </section>
    </section>
  );
}
