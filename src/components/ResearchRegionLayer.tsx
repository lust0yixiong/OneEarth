import {Layers,LocateFixed,Info} from "lucide-react";
import type {ResearchRegionLayer as Layer} from "../domain/research-region";
import "../styles/research-region.css";

export function ResearchRegionLayer({layer,toggle,locate}:{layer:Layer;toggle:()=>void;locate:()=>void}) {
  const {region,visible}=layer,located=region.status==="located";
  return <div className="research-region-layer" role="group" aria-label="研究区域图层">
    <Layers size={13}/><span>研究区域</span>
    <button className="region-visibility" role="switch" aria-checked={visible} aria-label="显示研究区域图层" onClick={toggle} disabled={!located}>
      <i aria-hidden="true"/>
    </button>
    <strong title={region.label}>{region.label}</strong>
    <span className="region-precision">{!located?"待定位":region.precision==="approximate"?"示意范围":region.precision==="grid"?"网格边界":region.precision==="global"?"全球":"边界参考"}</span>
    {located && <button onClick={locate} aria-label="定位研究区域" title="重新定位研究区域"><LocateFixed size={14}/></button>}
    <details className="region-info">
      <summary aria-label="研究区域范围说明"><Info size={13}/></summary>
      <div><p>{region.note}</p><small>{region.source}</small>{region.sourceUrl && <a href={region.sourceUrl} target="_blank" rel="noreferrer">查看范围来源 ↗</a>}</div>
    </details>
  </div>;
}
