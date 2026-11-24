import {useMemo} from "react";
import {ChevronDown,Info,LocateFixed,MapPin} from "lucide-react";
import {inPublicBounds,type PublicLayerGrid,type PublicLayerPoint,type PublicLayerSelection} from "../domain/haina-public-layer";
import {patchForHainaView,pointInHainaFootprint,type CoveragePublication} from "../domain/haina-published-raster";
import type {Coordinate} from "../domain/types";
import type {HainaPublicLayer} from "./use-haina-public-layer";
import type {useHainaViirsSample,useHainaViirsTiles} from "./use-haina-viirs";

const colorChips=["#d64572","#4f9e6d","#4f7fc4"];
const coordinateText=(point:Coordinate)=>point.map(value=>value.toFixed(5)).join("°, ")+"°";
function sampleIndex({bounds,width,height}:Pick<PublicLayerGrid,"bounds"|"width"|"height">,point:Coordinate) {
  if(!inPublicBounds(point,bounds))return undefined;
  const [west,south,east,north]=bounds;
  const col=Math.min(width-1,Math.floor((point[0]-west)/(east-west)*width));
  const row=Math.min(height-1,Math.floor((north-point[1])/(north-south)*height));
  return row*width+col;
}

function RasterSample({layer,sample}:{layer:HainaPublicLayer;sample:Coordinate|null}) {
  const {view,data,grid}=layer;
  if(!view||!(view.kind==="raster"||view.kind==="patch")||!data?.image)return null;
  const gridExpected=view.kind==="raster"&&view.grid;
  let text:string;
  if(gridExpected){
    const index=sample&&grid?.value ? sampleIndex(grid.value,sample) : undefined;
    const value=index===undefined?undefined:grid?.value?.values[index];
    text=grid?.value
      ? sample ? value===undefined?"发布视窗外":value===null?"缺测":"原值 "+value : "点选视窗读取原值"
      : grid ? "原值暂不可用" : "正在加载栅格原值…";
  }else if(sample&&view.kind==="patch"&&layer.patch){
    text=pointInHainaFootprint(sample,layer.patch.footprint) ? "已发布图斑内" : "已发布图斑外";
  }else if(sample){
    const index=sampleIndex(data.image,sample);
    text=index!==undefined && data.image.pixels[index*4+3]>0 ? "已发布图斑内" : "已发布图斑外";
  }else text="点选核对图斑范围";
  return <output className="haina-sample" aria-label={gridExpected?"栅格原值":"图斑点位"}>
    {sample && <span>{coordinateText(sample)}</span>}
    <span>{text}</span>
  </output>;
}

function ViirsReadout({point,lookup}:{point:Coordinate|null;lookup:ReturnType<typeof useHainaViirsSample>}) {
  const result=lookup.result?.sample;
  return <output className="haina-sample" aria-label="栅格原值">
    {point && <span title={result?.center?"像元中心 "+coordinateText(result.center):undefined}>{coordinateText(point)}</span>}
    {!point ? <span>点选读取原生值</span> :
      !lookup.result ? <span>正在读取原生值…</span> :
      !result ? <button className="forest-info-toggle" type="button" onClick={lookup.retry}>取值暂不可用 · 重试</button> :
      <span>{result.status==="value"?"原值 "+result.value+"（单位待核）":result.status==="no-data"?"源像元缺测":"源数据覆盖范围外"}</span>}
  </output>;
}

function PatchControls({publication,layer,selection,choosePatch,chooseMonth,overview}:{
  publication:CoveragePublication;layer:HainaPublicLayer;selection:PublicLayerSelection;
  choosePatch:(id:string)=>void;chooseMonth:(month:string)=>void;overview:()=>void;
}) {
  const selected=selection.view?patchForHainaView(selection.view):publication.defaultPatch;
  const {month}=layer;
  const options=useMemo(()=>publication.patches.map(patch=><option key={patch.id} value={patch.id}>
    {patch.id}{month&&!patch.months.includes(month)?"（此月未发布）":""}
  </option>),[publication,month]);
  return <>
    <label className="c40-space c40-city-switch haina-point-switch">
      <MapPin size={13}/><select aria-label="已发布图斑" value={selected} onChange={e=>choosePatch(e.target.value)}>
        {!layer.patch && <option value={selected} disabled>{selected}（未发布）</option>}
        {options}
      </select><ChevronDown size={12} className="c40-caret" aria-hidden="true"/>
    </label>
    <label className="c40-space c40-city-switch haina-view-switch">
      <select aria-label="已发布月份" value={month??""} onChange={e=>chooseMonth(e.target.value)}>
        {month&&!publication.months.includes(month)&&<option value={month} disabled>{month}（未发布）</option>}
        {publication.months.map(value=><option key={value} value={value}>
          {value}{layer.patch&&!layer.patch.months.includes(value)?"（此图斑未发布）":""}
        </option>)}
      </select><ChevronDown size={12} className="c40-caret" aria-hidden="true"/>
    </label>
    <span>{publication.patches.length.toLocaleString()} 个已发布图斑</span>
    <button className="forest-info-toggle" type="button" onClick={overview}>查看图斑分布</button>
    {publication.colors.labels.map((label,i)=><span key={i}><i className="forest-channel" style={{background:colorChips[i]}}/>{label}</span>)}
    {publication.colors.kind==="per-frame-pca" && <span>逐帧 PCA · 颜色不可直接跨期比较</span>}
  </>;
}

export function HainaPublicLayerLegend({selection,layer,sample,viirs,viirsSample,chooseView,choosePatch,chooseMonth,choosePoint,locate,overview,inspect}:{
  selection:PublicLayerSelection;
  layer:HainaPublicLayer;
  sample:Coordinate|null;
  viirs:ReturnType<typeof useHainaViirsTiles>;
  viirsSample:ReturnType<typeof useHainaViirsSample>;
  chooseView:(id:string)=>void;
  choosePatch:(id:string)=>void;
  chooseMonth:(month:string)=>void;
  choosePoint:(point:PublicLayerPoint)=>void;
  locate:()=>void;
  overview:()=>void;
  inspect?:()=>void;
}) {
  const {catalogue,view,data}=layer;
  const {manifest}=catalogue;
  const coverage=manifest?.mode==="coverage"?manifest:undefined;
  const global=manifest?.mode==="viirs";
  const missing=coverage&&(!layer.patch||view?.kind==="patch"&&!view.image);
  const status=catalogue.error||data?.error||viirs.failed||missing ? "unavailable" : data||viirs.ready ? "ready" : "loading";
  return <section className="map-legend forest-legend-bar haina-public-legend" aria-label="海纳公开图层"
    data-public-layer={selection.id} data-public-view={view?.id} data-public-month={layer.month} data-public-status={status}>
    <span className="forest-legend-title">{manifest?.title??"海纳公开图层"}</span>
    {catalogue.error ? <button className="forest-info-toggle" onClick={catalogue.retry}>图层发布清单暂不可用 · 重试</button> :
      !manifest ? <span role="status">正在加载图层发布清单…</span> : <>
        {!coverage && <span>{manifest.period}</span>}
        {coverage && <PatchControls publication={coverage} layer={layer} selection={selection}
          choosePatch={choosePatch} chooseMonth={chooseMonth} overview={overview}/>}
        {global && <>
          <span><i className="haina-viirs-key" aria-hidden="true"/>夜光暗至亮 · 对数拉伸</span>
          <ViirsReadout point={sample} lookup={viirsSample}/>
        </>}
        {manifest.mode==="legacy" && view && (manifest.views.length>1
          ? <label className="c40-space c40-city-switch haina-view-switch">
              <MapPin size={13}/>
              <select aria-label="已发布视窗" value={view.id} onChange={event=>chooseView(event.target.value)}>
                {manifest.views.map(option=><option value={option.id} key={option.id}>{option.label}</option>)}
              </select>
              <ChevronDown size={12} className="c40-caret" aria-hidden="true"/>
            </label>
          : view.kind==="raster" && <span>{view.label}</span>)}
        {missing ? <span role="status">{layer.patch?"此图斑未发布所选月份":"此图斑未发布"}</span> :
          global ? viirs.failed ? <button className="forest-info-toggle" onClick={viirs.retry}>地图瓦片未完整载入 · 重试</button> :
            viirs.empty ? <span role="status">当前视野超出源数据覆盖范围</span> :
            !viirs.ready&&<span role="status">正在加载当前视野的夜光图层…</span> :
          data?.error ? <button className="forest-info-toggle" onClick={layer.retry}>图层载入失败 · 重试</button> :
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
        {view?.kind==="points" && <span><i className="haina-volcano-key" aria-hidden="true"/>火山点</span>}
        <RasterSample layer={layer} sample={sample}/>
        {view && <button className="forest-info-toggle" onClick={locate}><LocateFixed size={13}/>{global?"定位到图层起始视野":"定位到当前范围"}</button>}
        {inspect && <button className="forest-info-toggle" onClick={inspect}><Info size={13}/>数据速览</button>}
      </>}
  </section>;
}
