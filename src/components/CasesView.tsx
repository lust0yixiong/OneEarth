import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { geoOrthographic, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import atlas from "world-atlas/land-110m.json";
import { visualizationCatalog } from "../domain/visualization-catalog";
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
const land = feature(atlas as any, (atlas as any).objects.land);
function EarthquakePreview() {
  const projection = geoOrthographic()
    .rotate([143, -62])
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
  const { openVisualization } = useWorkspace();
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
          <span className="quake-preview" aria-hidden="true"><EarthquakePreview/></span>
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
      </section>
    </section>
  );
}
