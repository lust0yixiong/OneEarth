import {useEffect,useRef} from "react";
import {X} from "lucide-react";
import {BASEMAPS,basemapStyle,type BasemapId} from "../globe/basemaps";
import type {GlobeDatasetLayer} from "../domain/globe-dataset-layers";

export function GlobeLayerMenu({basemapId,basemapError,layers,focus,chooseBasemap,chooseFocus,setVisibility,close}:{
  basemapId:BasemapId|null;
  basemapError:string;
  layers:GlobeDatasetLayer[];
  focus:string|null;
  chooseBasemap:(id:BasemapId|null)=>void;
  chooseFocus:(id:string)=>void;
  setVisibility:(id:string,visible:boolean)=>void;
  close:()=>void;
}) {
  const closeButton=useRef<HTMLButtonElement>(null);
  useEffect(()=>{closeButton.current?.focus({preventScroll:true});},[]);
  return <>
    <div className="basemap-backdrop" onClick={close}/>
    <div className="basemap-menu globe-layer-menu" data-layer-menu role="dialog" aria-label="选择底图"
      onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();close();}}}>
      <header><strong>图层</strong><button ref={closeButton} type="button" aria-label="关闭底图菜单" onClick={close}><X size={13}/></button></header>
      <fieldset className="basemap-list">
        <legend>底图</legend>
        <label className={!basemapId?"active":""}>
          <input type="radio" name="globe-basemap" checked={!basemapId} onChange={()=>chooseBasemap(null)}/>
          <i className="basemap-swatch vector" aria-hidden="true"/>
          <span><strong>矢量底图</strong><small>项目默认样式，最轻</small></span>
        </label>
        {BASEMAPS.map(style=><label key={style.id} className={basemapId===style.id?"active":""}>
          <input type="radio" name="globe-basemap" checked={basemapId===style.id} onChange={()=>chooseBasemap(style.id)}/>
          <i className={"basemap-swatch "+style.id} aria-hidden="true"/>
          <span><strong>{style.name}</strong><small>{style.hint}</small></span>
        </label>)}
      </fieldset>
      {basemapError&&<p role="status">{basemapError}</p>}
      <small className="basemap-credit">底图 © Esri ArcGIS Online{basemapStyle(basemapId)?" · "+basemapStyle(basemapId)!.attribution:""}</small>
      <fieldset className="globe-dataset-list">
        <legend>数据图层</legend>
        {!layers.length&&<p>从资料详情选择「数据上球」后，可在这里管理图层。</p>}
        {layers.map(entry=><div key={entry.id} className="globe-dataset-choice" data-dataset-layer={entry.id}>
          <label>
            <input type="checkbox" aria-label={"显示 "+entry.label} checked={entry.visible}
              onChange={event=>setVisibility(entry.id,event.target.checked)}/>
            <span>{entry.label}</span>
          </label>
          <button type="button" className="globe-dataset-focus" aria-label={"操作焦点："+entry.label} disabled={!entry.visible}
            aria-pressed={focus===entry.id} onClick={()=>chooseFocus(entry.id)}>{focus===entry.id?"当前操作":"设为焦点"}</button>
        </div>)}
      </fieldset>
    </div>
  </>;
}
