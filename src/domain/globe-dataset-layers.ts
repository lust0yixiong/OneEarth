import { isPublicLayerId, validPublicCoordinate, validPublicViewId, type PublicLayerSelection } from "./haina-public-layer";
import { validHainaMonth } from "./haina-published-raster";
import { datasetLayers, globeCases, isForestDate, layerFrameCount, type RegionalId } from "./regional-cases";
import { isRainYear } from "./rain-catalog";
import { emptyFilters } from "./spatial";
import { createDataView, ctdStations } from "./visualization";
import { validVisualization } from "./visualization-catalog";
import type { Camera, DataView, Filters, Selection, VisualizationState } from "./types";

export type FieldLayerSelection = {id:RegionalId;frame:number;year?:number;city?:string;date?:string};
type DrawLayer =
  | {kind:"public";selection:PublicLayerSelection}
  | {kind:"field";selection:FieldLayerSelection}
  | {kind:"wind";selection:VisualizationState}
  | {kind:"data";selection:DataView;caseId:string;needIndex:number;filters:Filters;gridSelection:Selection|null};
export type GlobeDatasetLayer = DrawLayer & {id:string;label:string;visible:boolean};

const publicNames = {
  1835833:"VIIRS 夜间灯光",
  1835839:"安第斯全新世火山",
  1846104:"玄女哈尔滨嵌入",
};

const nativeDatasets = {
  ctd: {id:"pangaea:891386", label:"格陵兰 CTD 剖面", caseId:"Q19", needIndex:4},
  front: {id:"zenodo:15241675:fronts", label:"冰川末端变化", caseId:"Q20", needIndex:1},
};

export function globeDatasetLayer(layer: DrawLayer, visible = true): GlobeDatasetLayer {
  switch (layer.kind) {
    case "public": return {...layer, id:"haina:"+layer.selection.id, label:publicNames[layer.selection.id], visible};
    case "field": return {...layer, id:datasetLayers[layer.selection.id], label:globeCases[layer.selection.id].title, visible};
    case "wind": return {...layer, id:layer.selection.id, label:"全球 GFS 风场", visible};
    case "data": {
      const {id,label} = nativeDatasets[layer.selection.kind];
      return {...layer,id,label,visible};
    }
  }
}

export function setDatasetLayer(layers: GlobeDatasetLayer[], layer: GlobeDatasetLayer) {
  return layers.some(item=>item.id===layer.id)
    ? layers.map(item=>item.id===layer.id ? layer : item)
    : [...layers,layer];
}

type LayerProjection = {
  publicLayer:PublicLayerSelection|null;
  fieldLayer:FieldLayerSelection|null;
  visualization:VisualizationState|null;
  dataView:DataView|null;
};

export function focusedDatasetLayer(layer: GlobeDatasetLayer|null): LayerProjection {
  return {
    publicLayer:layer?.kind==="public" ? layer.selection : null,
    fieldLayer:layer?.kind==="field" ? layer.selection : null,
    visualization:layer?.kind==="wind" ? layer.selection : null,
    dataView:layer?.kind==="data" ? layer.selection : null,
  };
}

export function datasetLayerFromView(state: LayerProjection & {caseId:string|null;filters:Filters;selection:Selection|null}) {
  if(state.publicLayer)return globeDatasetLayer({kind:"public",selection:state.publicLayer});
  if(state.fieldLayer)return globeDatasetLayer({kind:"field",selection:state.fieldLayer});
  if(state.visualization)return globeDatasetLayer({kind:"wind",selection:state.visualization});
  if(state.dataView){
    const recipe = nativeDatasets[state.dataView.kind];
    return globeDatasetLayer({kind:"data",selection:state.dataView,caseId:recipe.caseId,needIndex:recipe.needIndex,
      filters:state.filters,gridSelection:state.selection});
  }
  return null;
}

// Links carry dataset controls and visibility. The originating browser separately retains local selections and filters.
type LinkLayer =
  | ["public",boolean,PublicLayerSelection]
  | ["field",boolean,FieldLayerSelection]
  | ["wind",boolean,VisualizationState]
  | ["data",boolean,DataView];

export function encodeGlobeLayers(layers: GlobeDatasetLayer[], focus: string|null, camera: Camera) {
  const entries:LinkLayer[]=layers.map(layer=>{
    switch(layer.kind){
      case "public": return ["public",layer.visible,{id:layer.selection.id,view:layer.selection.view,month:layer.selection.month}];
      case "field": return ["field",layer.visible,layer.selection];
      case "wind": return ["wind",layer.visible,{...layer.selection,playing:false}];
      case "data": return ["data",layer.visible,layer.selection];
    }
  });
  const center = camera.center.map(value=>Number(value.toFixed(7)));
  return JSON.stringify([1,focus,entries,[...center,Number(camera.zoom.toFixed(4))]]);
}

function readLinkLayer(entry:unknown): GlobeDatasetLayer|null {
  if(!Array.isArray(entry)||entry.length!==3||typeof entry[1]!=="boolean")return null;
  const [kind,visible,value]=entry;
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  if(kind==="public"&&isPublicLayerId(value.id)){
    return globeDatasetLayer({kind,selection:{id:value.id,
      ...(validPublicViewId(value.view)?{view:value.view}:{}),
      ...(value.id===1846104&&validHainaMonth(value.month)?{month:value.month}:{})}},visible);
  }
  if(kind==="field"&&typeof value.id==="string"&&Object.hasOwn(globeCases,value.id)){
    const id = value.id as RegionalId;
    const frame = Number.isInteger(value.frame)&&value.frame>=0&&value.frame<layerFrameCount(id)?value.frame:globeCases[id].month;
    return globeDatasetLayer({kind,selection:{id,frame,
      ...(id==="forest"&&isForestDate(value.date)?{date:value.date}:{}),
      ...(id==="c40"&&typeof value.city==="string"&&/^[a-z0-9][a-z0-9-]{0,79}$/.test(value.city)?{city:value.city}:{}),
      ...(id==="rain"&&isRainYear(value.year)?{year:value.year}:{})}},visible);
  }
  if(kind==="wind"&&validVisualization(value)){
    const {id,level,forecastHour,color}=value;
    return globeDatasetLayer({kind,selection:{id,level,forecastHour,color,playing:false}},visible);
  }
  if(kind==="data"&&(value.kind==="ctd"||value.kind==="front")){
    const {caseId,needIndex}=nativeDatasets[value.kind as DataView["kind"]];
    const filters={...emptyFilters(),need:needIndex};
    const initial=createDataView(caseId,needIndex,filters);
    if(!initial)return null;
    const selection:DataView=initial.kind==="ctd" ? {
      kind:"ctd",
      stationId:ctdStations.some(station=>station.name===value.stationId)?value.stationId:initial.stationId,
      variable:value.variable==="salinity"?"salinity":"temperature",
      depth:typeof value.depth==="number"&&Number.isFinite(value.depth)&&value.depth>=0&&value.depth<=12000?value.depth:initial.depth,
    } : {
      kind:"front",
      glacier:value.glacier==="Alsek"?"Alsek":"Mendenhall",
      epoch:value.epoch==="first"||value.epoch==="last"?value.epoch:"compare",
    };
    return globeDatasetLayer({kind,selection,caseId,needIndex,filters,gridSelection:null},visible);
  }
  return null;
}

export function decodeGlobeLayers(raw: string|null) {
  if(!raw||raw.length>6000)return null;
  let wire:unknown;
  try{wire=JSON.parse(raw);}catch{return null;}
  if(!Array.isArray(wire)||wire.length!==4||wire[0]!==1||!Array.isArray(wire[2])||wire[2].length>16)return null;
  const layers:GlobeDatasetLayer[]=[];
  for(const entry of wire[2]){
    const layer=readLinkLayer(entry);
    if(!layer||layers.some(item=>item.id===layer.id))return null;
    layers.push(layer);
  }
  const focus=layers.find(item=>item.visible&&item.id===wire[1]) ?? null;
  const position=wire[3];
  const center=Array.isArray(position)&&position.length===3 ? position.slice(0,2) : null;
  const zoom=center ? position[2] : null;
  const camera=validPublicCoordinate(center)&&typeof zoom==="number"&&Number.isFinite(zoom)&&zoom>=1&&zoom<=2200
    ? {center,zoom,reason:"数据图层组合"} : null;
  return {layers,focus,camera};
}
