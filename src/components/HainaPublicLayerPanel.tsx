import {X} from "lucide-react";
import {inPublicBounds,type PublicLayerGrid,type PublicLayerSelection} from "../domain/haina-public-layer";
import type {Coordinate} from "../domain/types";
import type {useHainaPublicLayer} from "./use-haina-public-layer";

function gridValue(grid:PublicLayerGrid,point:Coordinate) {
  if(!inPublicBounds(point,grid.bounds))return undefined;
  const [west,south,east,north]=grid.bounds;
  const col=Math.min(grid.width-1,Math.floor((point[0]-west)/(east-west)*grid.width));
  const row=Math.min(grid.height-1,Math.floor((north-point[1])/(north-south)*grid.height));
  return grid.values[row*grid.width+col];
}
const coordinateText=([lon,lat]:Coordinate)=>lon.toFixed(4)+"°, "+lat.toFixed(4)+"°";

export function HainaPublicLayerPanel({selection,layer,sample,chooseView,choosePoint,locate,inspect,close}:{
  selection:PublicLayerSelection;
  layer:ReturnType<typeof useHainaPublicLayer>;
  sample:Coordinate|null;
  chooseView:(id:string)=>void;
  choosePoint:(id:string|undefined)=>void;
  locate:()=>void;
  inspect?:()=>void;
  close:()=>void;
}) {
  const {catalogue,view,data,grid}=layer;
  const {manifest}=catalogue;
  const point=data?.points?.find(point=>point.id===selection.point);
  const status=catalogue.error || data?.error ? "unavailable" : data ? "ready" : "loading";
  const value=sample&&grid?.value ? gridValue(grid.value,sample) : undefined;
  const source=manifest?.source;
  return <section className="haina-layer-panel" aria-label="海纳公开图层" data-public-layer={selection.id}
    data-public-view={view?.id} data-public-status={status}>
    <div className="haina-layer-heading">
      <strong>{manifest?.title??"海纳公开图层"}</strong>
      <button type="button" aria-label="关闭海纳图层" onClick={close}><X size={15}/></button>
    </div>
    {catalogue.error ? <button onClick={catalogue.retry}>图层发布清单暂不可用 · 重试</button> :
      !manifest || !view ? <p role="status">正在加载图层发布清单…</p> : <>
        <div className="haina-layer-options">
          <span>{manifest.period}</span>
          {manifest.views.length>1
            ? <select aria-label="已发布视窗" value={view.id} onChange={event=>chooseView(event.target.value)}>
              {manifest.views.map(option=><option value={option.id} key={option.id}>{option.label}</option>)}
            </select>
            : <span>{view.label}</span>}
          <button type="button" onClick={locate}>定位到当前范围</button>
          {inspect && <button type="button" onClick={inspect}>数据速览</button>}
        </div>
        <p>{manifest.description}</p>
        {source && <p>来源 {/^https?:\/\//i.test(source)
          ? <a href={source} target="_blank" rel="noreferrer">{source}</a> : source}</p>}
        {data?.error ? <button onClick={layer.retry}>图层载入失败 · 重试</button> : !data &&
          <p role="status">正在加载当前范围的图层…</p>}
        {data?.points && <>
          <label className="haina-point-control">火山记录 {data.points.length} 条
            <select aria-label="选择火山" value={selection.point??""} onChange={event=>choosePoint(event.target.value||undefined)}>
              <option value="">请选择</option>
              {data.points.map(point=><option value={point.id} key={point.id}>{point.label}</option>)}
            </select>
          </label>
          {point&&<div className="haina-point-detail" aria-label="火山原始记录">
            <strong>{point.label}</strong><small>{coordinateText(point.coordinate)}</small>
            <dl>{Object.entries(point.properties).map(([label,v])=><div key={label}>
              <dt>{label}</dt><dd>{v===null || v==="" ? "缺测" : typeof v==="object" ? JSON.stringify(v) : String(v)}</dd>
            </div>)}</dl>
          </div>}
        </>}
        {view.kind==="raster"&&!!view.grid&&data&&!data.error&&
          <p role="status" aria-label="栅格原值">{grid?.value
            ? sample ? coordinateText(sample)+" · "+(value===undefined?"发布视窗外":value===null?"缺测":"原值 "+value) : "点击当前视窗内的位置读取栅格原值"
            : grid ? "当前范围的栅格原值暂不可用" : "正在加载栅格原值…"}</p>}
      </>}
  </section>;
}
