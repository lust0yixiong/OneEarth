import type { Camera, Coordinate, Filters, GridSystem, MapLayer, View } from "./types";

export type WorkspaceViewChoice = {id:string;label:string};
export const c40CityManifestPath="/visualizations/haina/1846639/manifest.json";
export type WorkspaceViewPublication = {kind:"c40-cities";revision:string;total:number};

export function c40CityPublicationRevision(etag:string|null|undefined) {
  return etag?.match(/^"([0-9a-f]{64})"$/)?.[1];
}

export type WorkspaceViewDisplayFact = {label:string;value:string};
export type WorkspaceViewControl = {
  id:string;label:string;current:WorkspaceViewChoice;options:WorkspaceViewChoice[];ordered:boolean;publication?:WorkspaceViewPublication;
};

export type WorkspaceViewContext = {
  version:1;
  surface:View;
  display?:WorkspaceViewDisplayFact[];
  map?: {
    mode:"catalog"|"simulation";
    camera:Pick<Camera,"center"|"zoom">;
    gridSystem:GridSystem;
    layer:MapLayer;
    selection?:{id:string;gridKey:string;point:Coordinate;simulated:boolean};
    filters:Pick<Filters,"type"|"source"|"place"|"period"|"depth"|"maxDem"> & {utcWindow:[number,number]|null};
    mesh:boolean;
  };
  case?: {id:string;title:string};
  activeLayer?: {
    id:string;title:string;datasetId?:string;
    status:"ready"|"loading"|"unavailable";controls:WorkspaceViewControl[];
    display?:WorkspaceViewDisplayFact[];
  };
  focus?: {
    kind:"dataset"|"batch"|"comparison"|"evidence";
    id?:string;version?:string;title:string;tab?:string;page?:number;locator?:string;
  };
  candidates?: {count:number;title?:string};
  catalogue?: {section?:string;type?:string;source?:string;capability?:string;page?:number;savedOnly?:boolean};
};

export type WorkspaceViewAction = {
  kind:"set-control";layerId:string;controlId:string;valueId:string;publicationRevision?:string;
};

type Fields = Record<string,unknown>;
function object(value:unknown, keys:string[]):value is Fields {
  return !!value&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
}
function text(value:unknown, max=200):value is string {
  return typeof value==="string"&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
}
function label(value:unknown, max=200):value is string {
  return text(value,max)&&!!value.trim();
}
function id(value:unknown):value is string {
  return typeof value==="string"&&/^[a-z0-9][a-z0-9:_.-]{0,159}$/i.test(value);
}
function optional(value:unknown, validate:(value:unknown)=>boolean) {
  return value===undefined||validate(value);
}
function member(value:unknown, options:string[]) {
  return typeof value==="string"&&options.includes(value);
}
function integer(value:unknown, min:number, max:number):value is number {
  return typeof value==="number"&&Number.isSafeInteger(value)&&value>=min&&value<=max;
}
function pair(value:unknown):value is [number,number] {
  return Array.isArray(value)&&value.length===2&&value.every(item=>typeof item==="number"&&Number.isFinite(item));
}
function coordinate(value:unknown) {
  return pair(value)&&Math.abs(value[0])<=180&&Math.abs(value[1])<=90;
}
function range(value:unknown) {
  return value===null||(pair(value)&&value[0]<=value[1]);
}
function mapContext(v:unknown) {
  if(!object(v,["mode","camera","gridSystem","layer","selection","filters","mesh"]))return false;
  const {camera,selection,filters}=v;
  return member(v.mode,["catalog","simulation"])&&member(v.gridSystem,["h3","s2"])&&
    member(v.layer,["all","verified","joint","paired"])&&typeof v.mesh==="boolean"&&
    object(camera,["center","zoom"])&&coordinate(camera.center)&&typeof camera.zoom==="number"&&camera.zoom>=1&&camera.zoom<=2200&&
    optional(selection,s=>object(s,["id","gridKey","point","simulated"])&&id(s.id)&&id(s.gridKey)&&coordinate(s.point)&&typeof s.simulated==="boolean")&&
    object(filters,["type","source","place","period","utcWindow","depth","maxDem"])&&
    text(filters.type,100)&&text(filters.source,100)&&text(filters.place,100)&&
    range(filters.period)&&range(filters.utcWindow)&&range(filters.depth)&&
    (filters.maxDem===null||(typeof filters.maxDem==="number"&&Number.isFinite(filters.maxDem)&&filters.maxDem>0));
}
function choice(v:unknown):v is WorkspaceViewChoice {
  return object(v,["id","label"])&&id(v.id)&&label(v.label);
}
function publicationRevision(value:unknown):value is string {
  return typeof value==="string"&&/^[0-9a-f]{64}$/.test(value);
}
function publication(v:unknown):v is WorkspaceViewPublication {
  return object(v,["kind","revision","total"])&&v.kind==="c40-cities"&&
    publicationRevision(v.revision)&&integer(v.total,1,10000);
}
function control(v:unknown):v is WorkspaceViewControl {
  if(!object(v,["id","label","current","options","ordered","publication"])||!id(v.id)||!label(v.label)||
      !choice(v.current)||typeof v.ordered!=="boolean"||!Array.isArray(v.options)||v.options.length>36||!v.options.every(choice))
    return false;
  const current=v.current;
  return (v.publication===undefined||publication(v.publication)&&v.options.length>0&&v.options.length<=v.publication.total)&&
    new Set(v.options.map(option=>option.id)).size===v.options.length&&
    (!v.options.length||v.options.some(option=>option.id===current.id&&option.label===current.label));
}
function displayFacts(v:unknown) {
  return Array.isArray(v)&&v.length<=16&&v.every(item=>
    object(item,["label","value"])&&label(item.label,80)&&label(item.value,240));
}
function activeLayer(v:unknown) {
  return object(v,["id","title","datasetId","status","controls","display"])&&id(v.id)&&label(v.title)&&optional(v.datasetId,id)&&optional(v.display,displayFacts)&&
    member(v.status,["ready","loading","unavailable"])&&Array.isArray(v.controls)&&v.controls.length<=8&&
    v.controls.every(control)&&v.controls.every(item=>!item.publication||v.id==="c40"&&item.id==="city")&&
    new Set(v.controls.map(item=>item.id)).size===v.controls.length&&
    (v.status==="ready"||v.controls.every(item=>!item.options.length));
}
function focus(v:unknown) {
  return object(v,["kind","id","version","title","tab","page","locator"])&&
    member(v.kind,["dataset","batch","comparison","evidence"])&&optional(v.id,id)&&
    optional(v.version,item=>label(item,180))&&label(v.title,240)&&optional(v.tab,label)&&
    optional(v.page,item=>integer(item,1,100000))&&optional(v.locator,label);
}
function catalogue(v:unknown) {
  return object(v,["section","type","source","capability","page","savedOnly"])&&
    ["section","type","source","capability"].every(key=>optional(v[key],text))&&
    optional(v.page,item=>integer(item,1,100000))&&optional(v.savedOnly,item=>typeof item==="boolean");
}

/** User-visible context only. It carries no source access, scope, or operation grant. */
export function validWorkspaceViewContext(value:unknown):value is WorkspaceViewContext {
  return object(value,["version","surface","map","case","activeLayer","focus","candidates","catalogue","display"])&&
    value.version===1&&member(value.surface,["earth","discover","cases"])&&optional(value.display,displayFacts)&&
    optional(value.map,mapContext)&&optional(value.case,v=>object(v,["id","title"])&&id(v.id)&&label(v.title,240))&&
    optional(value.activeLayer,activeLayer)&&optional(value.focus,focus)&&
    optional(value.candidates,v=>object(v,["count","title"])&&integer(v.count,0,10000000)&&optional(v.title,label))&&
    optional(value.catalogue,catalogue);
}

/** Bind the model's absolute selection to the interface that exposed that choice. */
export function workspaceViewActionAllowed(view:WorkspaceViewContext|undefined, action:unknown,
  publishedChoice?: (publication:WorkspaceViewPublication,valueId:string)=>boolean):action is WorkspaceViewAction {
  if(!object(action,["kind","layerId","controlId","valueId","publicationRevision"])||action.kind!=="set-control"||
      !id(action.layerId)||!id(action.controlId)||!id(action.valueId)||
      !optional(action.publicationRevision,publicationRevision))return false;
  const layer=view?.activeLayer;
  const valueId=action.valueId;
  return layer?.status==="ready"&&layer.id===action.layerId&&layer.controls.some(item=>
    item.id===action.controlId&&item.publication?.revision===action.publicationRevision&&
    (item.options.some(option=>option.id===valueId)||!!item.publication&&publishedChoice?.(item.publication,valueId)===true));
}

/** Confirm permission for a UI change after the planner identifies its target. */
export function authorizesWorkspaceViewAction(question:string) {
  const query=question.trim();
  if(/[？?]|为什么|为何|如何|怎样|怎么|是否|能否|有没有|哪些|多少|原因|区别|\b(?:why|how|what|whether)\b/i.test(query))
    return false;
  if(/(?:不要|不必|不用|无需|别)\s*(?:实际|真的)?\s*(?:执行|操作|切换|切到|更改|修改)/u.test(query))return false;
  const command=query.replace(/^(?:(?:请|请求|帮我|麻烦)\s*)+/u,"");
  return /^(?:切换|切到|改为|改成|设为|选中|选择|移动到|跳到|打开|展示|显示|收起|展开|暂停|继续播放|上一(?:项|期|页|帧|个)|下一(?:项|期|页|帧|个))/u.test(command)||
    /^(?:把|将)[^，。；！？?\n]{1,32}(?:改为|改成|设为|切换到|切到|调整到|移到)/u.test(command);
}
