import {
  Cartesian2, Cartesian3, CesiumWidget, Color, ColorGeometryInstanceAttribute,
  GeographicTilingScheme, GeometryInstance, GroundPolylineGeometry, GroundPolylinePrimitive,
  ImageryLayer, PointPrimitiveCollection, PolylineColorAppearance, Rectangle, Request,
  SingleTileImageryProvider, UrlTemplateImageryProvider,
  type ImageryTypes,
} from "cesium";
import {inPublicBounds,type PublicBounds,type PublicLayerPoint,type PublicLayerSelection} from "../domain/haina-public-layer";
import {
  pointInHainaFootprint,viirsTilePath,type HainaPatch,type ViirsPublication,
} from "../domain/haina-published-raster";
import type {PublishedRasterTarget} from "../domain/published-raster-observation";
import {datasetLayers} from "../domain/regional-cases";
import type {Coordinate,GridSpec} from "../domain/types";
import {createCesiumNativeObservations,type NativeLayerInput,type NativeLayerSelection} from "./cesium-native-observations";
import {visibleRainFrames} from "./cesium-rain";
import type {RainTiles} from "./rain-tiles";
import type {GeoImageFrame} from "./geo-image-layer";
import {tileBounds,tileColumns} from "./haina-viewport";
import type {FrameInfo,GlobeLayerRender,Scene} from "./renderer";
import {createWindImages} from "./cesium-wind";

export type CesiumDatasetPick =
  | NativeLayerSelection
  | {kind:"rain";layerId:string;point:Coordinate}
  | {kind:"field";layerId:string;point:Coordinate}
  | {kind:"point";layerId:string;point:Coordinate;pointId:string}
  | {kind:"raster";layerId:string;point:Coordinate;patch?:HainaPatch}
  | {kind:"wind";layerId:string;point:Coordinate};

type PublicSurface = Extract<GlobeLayerRender,{kind:"public"}>;

interface DatasetSurface {
  id:string;
  selection?:PublicLayerSelection;
  viewId?:string;
  viirs?:ViirsPublication;
  image?:GeoImageFrame|null;
  wind?:boolean;
  points?:PublicLayerPoint[];
  sample?:Coordinate;
  patches?:HainaPatch[];
  publication?:PublishedRasterTarget;
  rain?:RainTiles;
  month?:number;
  native?:NativeLayerInput;
  field?:boolean;
}

interface ImagerySurface {
  layer:ImageryLayer;
  viirs?:ViirsImagery;
  image?:GeoImageFrame;
}

interface RenderedSurface {
  imagery?:ImagerySurface;
  rainSource?:RainTiles;
  rainMonth?:number;
  rain?:Map<GeoImageFrame,ImagerySurface>;
  points?:PointPrimitiveCollection;
  pointsSource?:PublicLayerPoint[];
  patches?:PointPrimitiveCollection;
  patchSource?:HainaPatch[];
  footprint?:GroundPolylinePrimitive;
  selectedPatch?:string;
}

interface PointIdentity {
  owner:RenderedSurface;
  hit:CesiumDatasetPick;
}

type Projection = (point:Coordinate)=>[number,number]|null;

const pointColor=Color.fromCssColorString("#94521a");
const patchColor=Color.fromCssColorString("#2f7764");
const selectedColor=Color.fromCssColorString("#ad570e");
const sampleColor=Color.fromCssColorString("#fff1cf");
const cachedTiles=96;
const cachedErrors=96;

const toRectangle=([west,south,east,north]:PublicBounds)=>Rectangle.fromDegrees(west,south,east,north);

function viirsRectangle([west,south,east,north]:PublicBounds) {
  if(east-west>=360)return Rectangle.fromDegrees(-180,south,180,north);
  return Rectangle.fromDegrees(west<-180?west+360:west,south,east>180?east-360:east,north);
}

function insideViirs([longitude,latitude]:Coordinate,[west,south,east,north]:PublicBounds) {
  return latitude>=south&&latitude<=north&&Math.ceil((west-longitude)/360)<=Math.floor((east-longitude)/360);
}

function geoImageAlpha(source:GeoImageFrame,point:Coordinate) {
  if(!inPublicBounds(point,source.bounds))return 0;
  const [west,south,east,north]=source.bounds;
  const column=Math.min(source.width-1,Math.floor((point[0]-west)/(east-west)*source.width));
  const row=Math.min(source.height-1,Math.floor((north-point[1])/(north-south)*source.height));
  return source.pixels[(row*source.width+column)*4+3];
}

// Present the existing decoded source directly as a native geographic imagery layer.
class GeoFrameImagery extends SingleTileImageryProvider {
  private readonly tile:HTMLCanvasElement;

  constructor(source:GeoImageFrame) {
    super({url:location.origin,tileWidth:source.width,tileHeight:source.height,rectangle:toRectangle(source.bounds)});
    const canvas=document.createElement("canvas");
    canvas.width=source.width;
    canvas.height=source.height;
    const context=canvas.getContext("2d")!;
    const pixels=context.createImageData(source.width,source.height);
    pixels.data.set(source.pixels);
    context.putImageData(pixels,0,0);
    this.tile=canvas;
  }

  override requestImage() {
    return Promise.resolve(this.tile);
  }
}

function remember<T>(entries:Map<string,T>,key:string,value:T,limit:number) {
  entries.delete(key);
  entries.set(key,value);
  while(entries.size>limit)entries.delete(entries.keys().next().value!);
}

class ViirsImagery extends UrlTemplateImageryProvider {
  readonly publication:ViirsPublication;
  private active=true;
  private decoded=new Map<string,ImageryTypes>();
  private errors=new Map<string,Rectangle>();
  private readonly removeError:()=>void;
  private readonly pixelReader=document.createElement("canvas").getContext("2d",{willReadFrequently:true})!;

  constructor(publication:ViirsPublication,changed:()=>void) {
    const firstTile=viirsTilePath(publication.revision,0,0,0);
    super({
      url:firstTile.slice(0,-"0/0/0.png".length)+"{z}/{x}/{y}.png",
      tilingScheme:new GeographicTilingScheme(),
      rectangle:viirsRectangle(publication.sourceBounds),
      tileWidth:publication.tileSize,tileHeight:publication.tileSize,
      maximumLevel:publication.maxZoom,enablePickFeatures:false,
    });
    this.publication=publication;
    this.pixelReader.canvas.width=this.pixelReader.canvas.height=1;
    this.removeError=this.errorEvent.addEventListener(({x,y,level})=>{
      if(!this.active || x===undefined || y===undefined || level===undefined)return;
      remember(this.errors,level+"/"+x+"/"+y,toRectangle(tileBounds(level,x,y)),cachedErrors);
      changed();
    });
  }

  override requestImage(x:number,y:number,level:number,request?:Request) {
    return super.requestImage(x,y,level,request)?.then(image=>{
      if(this.active) {
        const key=level+"/"+x+"/"+y;
        this.errors.delete(key);
        remember(this.decoded,key,image,cachedTiles);
      }
      return image;
    });
  }

  failedIn(view:Rectangle | undefined) {
    for(const rectangle of this.errors.values())
      if(!view || Rectangle.intersection(rectangle,view))return true;
    return false;
  }

  // This alpha only resolves overlap order. The legend always reads the
  // source value through the existing revision-qualified native sample API.
  alphaAt([longitude,latitude]:Coordinate) {
    const longitudeFraction=((longitude+180)%360+360)%360/360;
    const latitudeFraction=Math.min(1-Number.EPSILON,Math.max(0,(90-latitude)/180));
    for(let level=this.publication.maxZoom;level>=0;level--) {
      const tileX=longitudeFraction*tileColumns(level), tileY=latitudeFraction*2**level;
      const x=Math.floor(tileX),y=Math.floor(tileY);
      const image=this.decoded.get(level+"/"+x+"/"+y);
      if(!image)continue;
      const size=this.publication.tileSize;
      const column=Math.floor((tileX-x)*size),row=Math.floor((tileY-y)*size);
      const ctx=this.pixelReader;
      try {
        ctx.clearRect(0,0,1,1);
        ctx.drawImage(image,column,row,1,1,0,0,1,1);
        return ctx.getImageData(0,0,1,1).data[3];
      } catch {
        return;
      }
    }
  }

  retire() {
    this.active=false;
    this.removeError();
    this.decoded.clear();
    this.errors.clear();
  }
}

function publicSurface(id:string,selection:PublicLayerSelection,layer:PublicSurface|Scene):DatasetSurface {
  return {id,selection,viewId:layer.publicRaster,viirs:layer.publicViirsPublication,image:layer.publicImage,
    points:layer.publicPoints,patches:layer.publicPatches,sample:layer.publicSample};
}

function datasetSurfaces(state:Scene,windImage:ReturnType<typeof createWindImages>):DatasetSurface[] {
  if(state.datasetLayers) return state.datasetLayers.flatMap((layer):DatasetSurface[]=>{
    if(layer.kind==="public")return [publicSurface(layer.id,layer.selection,layer)];
    if(layer.kind==="field")return [{id:layer.id,image:layer.image,publication:layer.publishedRaster,
      field:true,rain:layer.rain??undefined,month:layer.selection.frame}];
    if(layer.kind==="wind")return [{id:layer.id,wind:true,image:windImage(layer.selection,state.windTheme)}];
    return [{id:layer.id,native:{view:layer.selection,filters:layer.filters}}];
  });
  if(state.publicLayer) return [publicSurface("haina:"+state.publicLayer.id,state.publicLayer,state)];
  if(state.fieldLayer) return [{id:state.fieldRaster?.datasetId??(state.fieldLayer.id==="rain"?datasetLayers.rain:state.fieldLayer.id),image:state.fieldImage,publication:state.fieldRaster,
    field:true,rain:state.fieldRain??undefined,month:state.fieldLayer.frame}];
  if(state.visualization) return [{id:state.visualization.id,wind:true,image:windImage(state.visualization,state.windTheme)}];
  if(state.dataView)return [{id:state.dataView.kind==="ctd"?"pangaea:891386":"zenodo:15241675:fronts",
    native:{view:state.dataView,filters:state.filters}}];
  return [];
}

export function createCesiumDatasetLayers(widget:CesiumWidget,schedule:()=>void,projectVisible:Projection) {
  const scene=widget.scene, imageryLayers=widget.imageryLayers;
  const entries=new Map<string,RenderedSurface>();
  const native=createCesiumNativeObservations(scene,projectVisible);
  const windImage=createWindImages();
  const markerDrawer=scene.primitives.add(new PointPrimitiveCollection());
  const sampleMarker=markerDrawer.add({show:false,pixelSize:13,color:sampleColor,outlineColor:selectedColor,outlineWidth:2});
  let sample:Coordinate|undefined;
  let imageryOrder:ImageryLayer[]=[];
  let observedImagery=new Map<string,ImageryLayer>();
  let drawnPoints=new Set<string>();
  let frameStamp="";
  let focusedViirs:{revision:string;ready:boolean;failed:boolean;empty:boolean}|undefined;

  function removeImagery(entry:RenderedSurface) {
    if(!entry.imagery)return;
    entry.imagery.viirs?.retire();
    imageryLayers.remove(entry.imagery.layer);
    entry.imagery=undefined;
  }

  function removePoints(entry:RenderedSurface) {
    if(entry.points)scene.primitives.remove(entry.points);
    entry.points=undefined;
  }

  function clearRain(entry:RenderedSurface) {
    for(const item of entry.rain?.values()??[])imageryLayers.remove(item.layer);
    entry.rain=undefined;
  }

  function clear(entry:RenderedSurface) {
    removeImagery(entry);
    clearRain(entry);
    removePoints(entry);
    if(entry.patches)scene.primitives.remove(entry.patches);
    if(entry.footprint)scene.groundPrimitives.remove(entry.footprint);
  }

  function updateImagery(entry:RenderedSurface,target:DatasetSurface) {
    const old=entry.imagery;
    if(target.viirs) {
      if(old?.viirs?.publication.revision===target.viirs.revision)return;
      removeImagery(entry);
      const viirs=new ViirsImagery(target.viirs,schedule);
      entry.imagery={layer:imageryLayers.addImageryProvider(viirs),viirs};
    } else if(target.image) {
      if(old?.image===target.image)return;
      removeImagery(entry);
      entry.imagery={layer:imageryLayers.addImageryProvider(new GeoFrameImagery(target.image)),image:target.image};
    } else removeImagery(entry);
  }

  function updateRain(entry:RenderedSurface,target:DatasetSurface,view:Rectangle|undefined,zoom:number){
    if(entry.rainSource!==target.rain||entry.rainMonth!==target.month){
      clearRain(entry);
      entry.rainSource=target.rain;
      entry.rainMonth=target.month;
    }
    if(!target.rain||target.month===undefined)return;
    const frames=visibleRainFrames(target.rain,target.month,view,widget.canvas.clientHeight,zoom);
    const previous=entry.rain??new Map<GeoImageFrame,ImagerySurface>();
    const next=new Map<GeoImageFrame,ImagerySurface>();
    for(const image of frames)next.set(image,previous.get(image)??{
      layer:imageryLayers.addImageryProvider(new GeoFrameImagery(image)),image,
    });
    for(const [image,item] of previous)if(!next.has(image))imageryLayers.remove(item.layer);
    entry.rain=next;
  }

  function rainSurfaces(entry:RenderedSurface,target:DatasetSurface){
    return entry.rainSource===target.rain&&entry.rainMonth===target.month
      ? [...(entry.rain?.values()??[])] : [];
  }

  function updatePoints(entry:RenderedSurface,target:DatasetSurface) {
    if(entry.pointsSource===target.points)return;
    removePoints(entry);
    entry.pointsSource=target.points;
    if(!target.points?.length)return;
    const points=new PointPrimitiveCollection();
    for(const source of target.points) {
      const id:PointIdentity={owner:entry,hit:{kind:"point",layerId:target.id,point:source.coordinate,pointId:source.id}};
      points.add({id,position:Cartesian3.fromDegrees(...source.coordinate,80),color:pointColor,
        outlineColor:Color.WHITE,outlineWidth:1,pixelSize:8});
    }
    entry.points=scene.primitives.add(points);
  }

  function updatePatches(entry:RenderedSurface,target:DatasetSurface) {
    const selected=(target.viewId??target.selection?.view)?.replace("-","_");
    if(entry.patchSource===target.patches&&entry.selectedPatch===selected)return;
    if(entry.patches)scene.primitives.remove(entry.patches);
    if(entry.footprint)scene.groundPrimitives.remove(entry.footprint);
    entry.patches=undefined;
    entry.footprint=undefined;
    entry.patchSource=target.patches;
    entry.selectedPatch=selected;
    if(!target.patches?.length)return;
    const points=new PointPrimitiveCollection();
    for(const patch of target.patches) {
      const id:PointIdentity={owner:entry,hit:{kind:"raster",layerId:target.id,point:patch.center,patch}};
      points.add({id,position:Cartesian3.fromDegrees(...patch.center,20),color:patch.id===selected?selectedColor:patchColor,
        outlineColor:Color.WHITE,outlineWidth:1,pixelSize:patch.id===selected?7:5});
    }
    entry.patches=scene.primitives.add(points);
    const patch=target.patches.find(patch=>patch.id===selected);
    if(patch)entry.footprint=scene.groundPrimitives.add(new GroundPolylinePrimitive({
      geometryInstances:new GeometryInstance({
        geometry:new GroundPolylineGeometry({positions:patch.footprint.map(point=>Cartesian3.fromDegrees(...point)),width:1.8}),
        attributes:{color:ColorGeometryInstanceAttribute.fromColor(selectedColor)},
      }),appearance:new PolylineColorAppearance(),allowPicking:false,
    }));
  }

  function focusedDataset(state:Scene,targets:DatasetSurface[]) {
    return targets.find(item=>item.id===state.datasetFocus)??(!state.datasetLayers?targets[0]:undefined);
  }

  function update(state:Scene,grid:GridSpec,zoom:number) {
    const targets=datasetSurfaces(state,windImage);
    const view=targets.some(item=>item.rain) ? scene.camera.computeViewRectangle(scene.globe.ellipsoid) : undefined;
    const selected=focusedDataset(state,targets)?.sample;
    if(selected!==sample) {
      sample=selected;
      sampleMarker.show=!!sample;
      if(sample)sampleMarker.position=Cartesian3.fromDegrees(...sample,110);
    }
    const shown=new Set(targets.map(target=>target.id));
    for(const [id,entry] of entries)if(!shown.has(id)) {
      clear(entry);
      native.remove(id);
      entries.delete(id);
    }
    for(const target of targets) {
      const entry=entries.get(target.id)??{};
      entries.set(target.id,entry);
      updateImagery(entry,target);
      updateRain(entry,target,view,zoom);
      native.update(target.id,target.native,grid);
      updatePoints(entry,target);
      updatePatches(entry,target);
    }
    const ordered=targets.flatMap(target=>{
      const entry=entries.get(target.id)!;
      return entry.imagery?[entry.imagery]:rainSurfaces(entry,target);
    });
    if(ordered.length!==imageryOrder.length||ordered.some(({layer},index)=>layer!==imageryOrder[index])) {
      for(const {layer} of ordered)imageryLayers.raiseToTop(layer);
      imageryOrder=ordered.map(({layer})=>layer);
    }
    const alpha=targets.filter(target=>{
      const entry=entries.get(target.id)!;
      return !!entry.imagery||!!entry.rain?.size;
    }).length>1?.66:1;
    for(const {layer,image} of ordered)layer.alpha=alpha*(image?.opacity??1);
  }

  function visibleImagery(pixel:Cartesian2) {
    const ray=scene.camera.getPickRay(pixel);
    return ray ? imageryLayers.pickImageryLayers(ray,scene)??[] : [];
  }

  function present(target:DatasetSurface,entry:RenderedSurface) {
    const content=entry.imagery;
    if(!content)return;
    return target.viirs ? content.viirs?.publication.revision===target.viirs.revision?content:undefined
      : content.image===target.image?content:undefined;
  }

  function postRender(state:Scene) {
    const targets=datasetSurfaces(state,windImage);
    const nextImagery=new Map<string,ImageryLayer>();
    const nextPoints=new Set<string>();
    const available=new Set<ImageryLayer>();
    const width=widget.canvas.clientWidth,height=widget.canvas.clientHeight;
    const pending=new Set(imageryOrder);
    const observe=(pixel:Cartesian2)=>{
      for(const layer of visibleImagery(pixel))if(pending.delete(layer))available.add(layer);
    };
    if(pending.size&&width&&height) {
      for(const x of [.5,.15,.85])for(const y of [.5,.15,.85]) {
        if(!pending.size)break;
        observe(new Cartesian2(width*x,height*y));
      }
    }
    for(const target of targets) {
      const entry=entries.get(target.id);
      if(!entry)continue;
      const raster=present(target,entry);
      const surfaces=raster?[raster]:rainSurfaces(entry,target);
      const content=surfaces.find(content=>{
        if(content.image&&!available.has(content.layer)){
          const [west,south,east,north]=content.image.bounds;
          // A small native raster may lie entirely between the viewport probes.
          for(const u of [.1,.5,.9])for(const v of [.1,.5,.9]){
            const pixel=projectVisible([west+(east-west)*u,south+(north-south)*v]);
            if(pixel&&pending.has(content.layer))observe(new Cartesian2(...pixel));
          }
        }
        return available.has(content.layer);
      });
      if(content)nextImagery.set(target.id,content.layer);
      if(native.has(target.id,target.native)||target.points?.some(p=>projectVisible(p.coordinate))||target.patches?.some(p=>projectVisible(p.center)))
        nextPoints.add(target.id);
    }
    const focus=focusedDataset(state,targets);
    const viirs=focus&&entries.get(focus.id)?.imagery?.viirs;
    const matched=viirs?.publication.revision===focus?.viirs?.revision;
    const view=matched&&viirs ? scene.camera.computeViewRectangle(scene.globe.ellipsoid) : undefined;
    focusedViirs=matched&&viirs&&focus ? {
      revision:viirs.publication.revision,
      ready:nextImagery.has(focus.id),
      empty:!!view&&!Rectangle.intersection(view,viirs.rectangle),
      failed:!nextImagery.has(focus.id)&&viirs.failedIn(view),
    } : undefined;
    observedImagery=nextImagery;
    drawnPoints=nextPoints;
    const stamp=JSON.stringify([targets.map(target=>[target.id,
      nextImagery.has(target.id),
      nextPoints.has(target.id),target.publication]),focusedViirs]);
    if(stamp!==frameStamp) {
      frameStamp=stamp;
      schedule();
    }
  }

  function frame(state:Scene):Pick<FrameInfo,"paintedRasters"|"publicPoints"|"publicMarkers"> & {
    drawnIds:string[];viirs?:{ready:boolean;failed:boolean;empty:boolean};
  } {
    const targets=datasetSurfaces(state,windImage);
    const focus=focusedDataset(state,targets);
    const drawnIds:string[]=[];
    const paintedRasters:PublishedRasterTarget[]=[];
    for(const target of targets){
      const entry=entries.get(target.id);
      if(!entry)continue;
      const layer=present(target,entry)?.layer;
      const observed=observedImagery.get(target.id);
      const drawn=!!observed&&(observed===layer||rainSurfaces(entry,target).some(content=>content.layer===observed));
      if(drawn||drawnPoints.has(target.id))drawnIds.push(target.id);
      if(drawn&&target.publication)paintedRasters.push(target.publication);
    }
    const publicPoints=focus?.points;
    const publicMarkers=publicPoints?.flatMap(point=>{
      const xy=projectVisible(point.coordinate);
      return xy?[{id:point.id,label:point.label,x:xy[0],y:xy[1]}]:[];
    });
    return {drawnIds,paintedRasters,publicPoints,publicMarkers,
      viirs:focus?.viirs?.revision===focusedViirs?.revision?focusedViirs:undefined};
  }

  function pick(state:Scene,point:Coordinate,pixel:Cartesian2):CesiumDatasetPick|undefined {
    const targets=datasetSurfaces(state,windImage);
    if(!targets.length)return;
    for(const picked of scene.drillPick(pixel,8,3,3) as {id?:PointIdentity|NativeLayerSelection}[]){
      const identity=picked.id;
      if(!identity||typeof identity!=="object")continue;
      if("layerId" in identity){
        const target=targets.find(item=>item.id===identity.layerId);
        if(target&&native.owns(identity,target.native))
          return identity.kind==="glacier-front"?{...identity,point}:identity;
      }else if("owner" in identity){
        const target=targets.find(item=>item.id===identity.hit.layerId);
        if(!target||entries.get(target.id)!==identity.owner)continue;
        if(identity.hit.kind==="point"&&identity.owner.pointsSource===target.points)return identity.hit;
        if(identity.hit.kind==="raster"&&identity.owner.patchSource===target.patches){
          const patch=identity.hit.patch;
          if(patch&&(patch.id!==identity.owner.selectedPatch||pointInHainaFootprint(point,patch.footprint)))
            return {...identity.hit,point};
        }
      }
    }

    for(const target of targets.slice().reverse()){
      if(!drawnPoints.has(target.id))continue;
      const hit=native.lineAt(target.id,target.native,pixel);
      if(hit?.kind==="glacier-front")return {...hit,point};
    }
    const visible=new Set(visibleImagery(pixel));
    let transparent:CesiumDatasetPick|undefined;
    for(const item of targets.slice().reverse()) {
      const entry=entries.get(item.id);
      const content=entry&&present(item,entry);
      const hit={kind:"raster" as const,layerId:item.id,point};
      if(content?.viirs&&visible.has(content.layer)&&insideViirs(point,content.viirs.publication.sourceBounds)) {
        if(content.viirs.alphaAt(point)!==0)return hit;
        // A zero/no-data sample remains available when there is no opaque layer below.
        transparent??=hit;
      }
      if(entry&&item.rain){
        const surfaces=rainSurfaces(entry,item);
        const source=surfaces.reverse().find(({image,layer})=>visible.has(layer)&&!!image&&inPublicBounds(point,image.bounds));
        if(source?.image){
          const rainHit={...hit,kind:"rain" as const};
          if(geoImageAlpha(source.image,point)>0)return rainHit;
          transparent??=rainHit;
        }
      }
      const patch=item.patches?.find(candidate=>candidate.id===entry?.selectedPatch&&
        inPublicBounds(point,candidate.bounds)&&pointInHainaFootprint(point,candidate.footprint));
      if(content?.image&&visible.has(content.layer)&&geoImageAlpha(content.image,point)>0&&(!item.patches||patch))
        return item.wind?{...hit,kind:"wind"}:item.field?{...hit,kind:"field"}:{...hit,...(patch?{patch}:{})};
      const footprint=item.patches?.find(candidate=>candidate.id!==entry?.selectedPatch&&
        inPublicBounds(point,candidate.bounds)&&pointInHainaFootprint(point,candidate.footprint));
      if(footprint)return {...hit,patch:footprint};
    }
    if(transparent)return transparent;
    const focus=focusedDataset(state,targets);
    // Keep the public layer's explicit out-of-coverage response available at
    // the clicked coordinate after giving every visible lower layer a chance.
    if(focus?.viirs&&!insideViirs(point,focus.viirs.sourceBounds)||focus?.patches)
      return {kind:"raster",layerId:focus.id,point};
  }

  function retryViirs() {
    for(const entry of entries.values())if(entry.imagery?.viirs)removeImagery(entry);
    schedule();
  }

  return {update,postRender,frame,pick,retryViirs,dispose(){
    for(const entry of entries.values())clear(entry);
    entries.clear();
    native.dispose();
    scene.primitives.remove(markerDrawer);
  }};
}
