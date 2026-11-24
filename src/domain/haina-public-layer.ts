import type {Coordinate} from "./types";

const pilotIds=[1835839,1835833,1846104] as const;
export type PublicLayerId=typeof pilotIds[number];
export type PublicLayerSelection={id:PublicLayerId;view?:string;month?:string;point?:string};
export type PublicBounds=[number,number,number,number];
type PublicViewBase={id:string;label:string;bounds:PublicBounds;center:Coordinate;zoom:number;count?:number};
export type PublicLayerView=PublicViewBase & ({kind:"points";data:string}|{kind:"raster";image:string;grid?:string});
export type PublicLayerManifest={version:1;datasetId:PublicLayerId;title:string;period:string;description:string;source:string;defaultView:string;views:PublicLayerView[]};
export type PublicLayerPoint={id:string;label:string;coordinate:Coordinate;properties:Record<string,unknown>};
export type PublicLayerGrid={version:1;width:number;height:number;bounds:PublicBounds;values:(number|null)[]};

export function isPublicLayerId(value:number):value is PublicLayerId {
  return pilotIds.some(id=>id===value);
}
export function publicLayerForDataset(id:string|undefined) {
  const match=id?.match(/^haina:(\d+)$/);
  const number=Number(match?.[1]);
  return isPublicLayerId(number)?number:undefined;
}
export const validPublicViewId=(value:unknown):value is string=>typeof value==="string"&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(value);
const prefix=(id:PublicLayerId)=>"/visualizations/haina/"+id+"/public-v1/";
const manifestPath=(id:PublicLayerId)=>prefix(id)+"manifest.json";
const finite=(value:unknown):value is number=>typeof value==="number"&&Number.isFinite(value);
export const validPublicCoordinate=(value:unknown):value is Coordinate=>Array.isArray(value)&&value.length===2&&value.every(finite)
  &&Math.abs(value[0])<=180&&Math.abs(value[1])<=90;
export const validPublicBounds=(value:unknown):value is PublicBounds=>Array.isArray(value)&&value.length===4&&value.every(finite)
  &&validPublicCoordinate(value.slice(0,2))&&validPublicCoordinate(value.slice(2))&&value[0]<value[2]&&value[1]<value[3];
const text=(value:unknown,max:number):value is string=>typeof value==="string"&&!!value.trim()&&value.length<=max;
const relative=(value:unknown,id:PublicLayerId):value is string=>typeof value==="string"&&value.startsWith(prefix(id))
  &&/^[A-Za-z0-9][A-Za-z0-9_-]*\.[A-Za-z0-9]+$/.test(value.slice(prefix(id).length));
export const inPublicBounds=([x,y]:Coordinate,[w,s,e,n]:PublicBounds)=>x>=w&&x<=e&&y>=s&&y<=n;

export function readPublicLayerManifest(value:unknown,id:PublicLayerId):PublicLayerManifest {
  const m=value as PublicLayerManifest;
  if(m?.version!==1||m.datasetId!==id||!text(m.title,240)||!text(m.period,160)||!text(m.description,6000)||!text(m.source,1000)||
    !Array.isArray(m.views)||!m.views.length||m.views.length>32||!m.views.every(view=>
      view&&validPublicViewId(view.id)&&text(view.label,240)&&validPublicBounds(view.bounds)&&validPublicCoordinate(view.center)&&inPublicBounds(view.center,view.bounds)&&
      finite(view.zoom)&&view.zoom>=1&&view.zoom<=2200&&
      (view.count===undefined||Number.isSafeInteger(view.count)&&view.count>=0)&&
      (view.kind==="points"?relative(view.data,id):view.kind==="raster"&&relative(view.image,id)&&(view.grid===undefined||relative(view.grid,id))))||
    new Set(m.views.map(view=>view.id)).size!==m.views.length||!m.views.some(view=>view.id===m.defaultView))
    throw Error("图层发布清单格式不正确");
  return m;
}
export async function fetchPublicLayerManifest(id:PublicLayerId,signal:AbortSignal) {
  const response=await fetch(manifestPath(id),{signal,cache:"no-cache",redirect:"error"});
  if(!response.ok)throw Error("图层发布清单暂不可用");
  return readPublicLayerManifest(await response.json(),id);
}

export function readPublicLayerPoints(value:unknown,view:PublicLayerView):PublicLayerPoint[] {
  const collection=value as {type:string;features:any[]};
  if(collection?.type!=="FeatureCollection"||!Array.isArray(collection.features)||collection.features.length>2000||
    (view.count!==undefined&&collection.features.length!==view.count))throw Error("点图层与清单不一致");
  const points=collection.features.map((feature,index)=>{
    const p=feature?.geometry?.coordinates;
    const properties=feature?.properties;
    if(feature?.type!=="Feature"||feature.geometry?.type!=="Point"||!validPublicCoordinate(p)||!inPublicBounds(p,view.bounds)||
      !properties||typeof properties!=="object"||Array.isArray(properties))throw Error("点图层记录格式不正确");
    const label=Object.entries(properties).find(([key,value])=>/^(?:volcano[ _-]?name|name|火山名称|名称)$/i.test(key)&&text(value,240))?.[1];
    const id=Number.isSafeInteger(feature.id) ? String(feature.id) : validPublicViewId(feature.id) ? feature.id : String(index+1);
    return {id,label:typeof label==="string"?label:"火山 "+(index+1),coordinate:p,properties};
  });
  if(new Set(points.map(point=>point.id)).size!==points.length)throw Error("点图层记录标识重复");
  return points;
}

export function readPublicLayerGrid(value:unknown,view:PublicLayerView):PublicLayerGrid {
  const grid=value as PublicLayerGrid;
  if(grid?.version!==1||!Number.isSafeInteger(grid.width)||!Number.isSafeInteger(grid.height)||grid.width<1||grid.height<1||
    grid.width*grid.height>1_000_000||!validPublicBounds(grid.bounds)||!grid.bounds.every((value,index)=>Math.abs(value-view.bounds[index])<1e-7)||
    !Array.isArray(grid.values)||grid.values.length!==grid.width*grid.height||!grid.values.every(value=>value===null||finite(value)))
    throw Error("原值网格与图层不一致");
  return grid;
}
