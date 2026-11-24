import {ChevronDown,Info,LocateFixed,MapPin} from "lucide-react";
import {inPublicBounds,type PublicLayerGrid,type PublicLayerPoint,type PublicLayerSelection} from "../domain/haina-public-layer";
import type {Coordinate} from "../domain/types";
import type {HainaPublicLayer} from "./use-haina-public-layer";

function sampleIndex({bounds,width,height}:Pick<PublicLayerGrid,"bounds"|"width"|"height">,point:Coordinate) {
  if(!inPublicBounds(point,bounds))return undefined;
  const [west,south,east,north]=bounds;
  const col=Math.min(width-1,Math.floor((point[0]-west)/(east-west)*width));
  const row=Math.min(height-1,Math.floor((north-point[1])/(north-south)*height));
  return row*width+col;
}

function RasterSample({layer,sample}:{layer:HainaPublicLayer;sample:Coordinate|null}) {
  const {view,data,grid}=layer;
  if(view?.kind!=="raster"||!data?.image)return null;
  let text:string;
  if(view.grid){
    const index=sample&&grid?.value ? sampleIndex(grid.value,sample) : undefined;
    const value=index===undefined?undefined:grid?.value?.values[index];
    text=grid?.value
      ? sample ? value===undefined?"发布视窗外":value===null?"缺测":"原值 "+value : "点选视窗读取原值"
      : grid ? "原值暂不可用" : "正在加载栅格原值…";
  }else if(sample){
    const index=sampleIndex(data.image,sample);
    text=index!==undefined && data.image.pixels[index*4+3]>0 ? "已发布图斑内" : "已发布图斑外";
  }else text="点选核对图斑范围";
  return <output className="haina-sample" aria-label={view.grid?"栅格原值":"图斑点位"}>
    {sample && <span>{sample.map(value=>value.toFixed(5)).join("°, ")}°</span>}
    <span>{text}</span>
  </output>;
}

export function HainaPublicLayerLegend({selection,layer,sample,chooseView,choosePoint,locate,inspect}:{
  selection:PublicLayerSelection;
  layer:HainaPublicLayer;
  sample:Coordinate|null;
  chooseView:(id:string)=>void;
  choosePoint:(point:PublicLayerPoint)=>void;
  locate:()=>void;
  inspect?:()=>void;
}) {
  const {catalogue,view,data}=layer;
  const {manifest}=catalogue;
  const status=catalogue.error || data?.error ? "unavailable" : data ? "ready" : "loading";
  return <section className="map-legend forest-legend-bar haina-public-legend" aria-label="海纳公开图层"
    data-public-layer={selection.id} data-public-view={view?.id} data-public-status={status}>
    <span className="forest-legend-title">{manifest?.title??"海纳公开图层"}</span>
    {catalogue.error ? <button className="forest-info-toggle" onClick={catalogue.retry}>图层发布清单暂不可用 · 重试</button> :
      !manifest || !view ? <span role="status">正在加载图层发布清单…</span> : <>
        <span>{manifest.period}</span>
        {manifest.views.length>1
          ? <label className="c40-space c40-city-switch haina-view-switch">
              <MapPin size={13}/>
              <select aria-label="已发布视窗" value={view.id} onChange={event=>chooseView(event.target.value)}>
                {manifest.views.map(option=><option value={option.id} key={option.id}>{option.label}</option>)}
              </select>
              <ChevronDown size={12} className="c40-caret" aria-hidden="true"/>
            </label>
          : view.kind==="raster" && <span>{view.label}</span>}
        {data?.error ? <button className="forest-info-toggle" onClick={layer.retry}>图层载入失败 · 重试</button> :
          !data && <span role="status">正在加载当前范围的图层…</span>}
        {data?.points && <label className="c40-space c40-city-switch haina-point-switch">
          <MapPin size={13}/>
          <select aria-label="选择火山" value={selection.point??""} onChange={event=>{
            const point=data.points?.find(item=>item.id===event.target.value);
            if(point)choosePoint(point);
          }}>
            <option value="" disabled>{data.points.length} 个火山点</option>
            {data.points.map(point=><option value={point.id} key={point.id}>{point.label}</option>)}
          </select>
          <ChevronDown size={12} className="c40-caret" aria-hidden="true"/>
        </label>}
        {view.kind==="points" && <span><i className="haina-volcano-key" aria-hidden="true"/>火山点</span>}
        {selection.id===1835833 && <span title="颜色采用对数拉伸，原值单位待核">
          <i className="haina-viirs-key" aria-hidden="true"/>夜光暗至亮 · 对数拉伸
        </span>}
        {selection.id===1846104 && <>
          <span><i className="forest-channel" style={{background:"#d64572"}}/>R · PC1</span>
          <span><i className="forest-channel" style={{background:"#4f9e6d"}}/>G · PC2</span>
          <span><i className="forest-channel" style={{background:"#4f7fc4"}}/>B · PC3</span>
        </>}
        <RasterSample layer={layer} sample={sample}/>
        <button className="forest-info-toggle" onClick={locate}><LocateFixed size={13}/>定位到当前范围</button>
        {inspect && <button className="forest-info-toggle" onClick={inspect}><Info size={13}/>数据速览</button>}
      </>}
  </section>;
}
