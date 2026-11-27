import {
  Cartesian2,Cartesian3,Color,ColorGeometryInstanceAttribute,GeometryInstance,GroundPolylineGeometry,
  GroundPolylinePrimitive,GroundPrimitive,LabelCollection,PerInstanceColorAppearance,
  PointPrimitiveCollection,PolygonGeometry,PolygonHierarchy,PolylineColorAppearance,
  type Scene as CesiumScene,
} from "cesium";
import type {Geometry,Position} from "geojson";
import {cellShape} from "../domain/spatial";
import {ctdCells,frontsFor,valueColor,variableInfo,type CtdSample} from "../domain/visualization";
import type {Coordinate,DataView,Filters,GridSpec} from "../domain/types";

export type NativeLayerSelection=
  | {kind:"ctd";layerId:string;sample:CtdSample;variable:"temperature"|"salinity"}
  | {kind:"glacier-front";layerId:string;objectId:string;observedOn:string;point:Coordinate};
export type NativeLayerInput={view:DataView;filters:Filters};

type NativeEntry={
  view:DataView;filters:Filters;gridKey:string;
  marks:Coordinate[];identities:Set<NativeLayerSelection>;
  lines?:{identity:NativeLayerSelection;points:Coordinate[]}[];
  clear:()=>void;
  ready:()=>boolean;
};

const selectedColor=Color.fromCssColorString("#8b4814");
const material=(color:Color)=>({color:ColorGeometryInstanceAttribute.fromColor(color)});
const position=(pair:number[],height=0)=>Cartesian3.fromDegrees(pair[0],pair[1],height);

export function createCesiumNativeObservations(scene:CesiumScene,project:(point:Coordinate)=>[number,number]|null) {
  const entries=new Map<string,NativeEntry>();
  function nativeCtd(layerId:string,view:Extract<DataView,{kind:"ctd"}>,filters:Filters,grid:GridSpec){
    const marks:Coordinate[]=[],identities=new Set<NativeLayerSelection>();
    const cells=ctdCells(view,filters,grid),range=variableInfo(view.variable);
    const instances:GeometryInstance[]=[];
    const points=new PointPrimitiveCollection(),labels=new LabelCollection({scene});
    for(const [id,samples] of cells){
      const shape=cellShape(id,grid),geometry=shape.geometry;
      if(geometry.type==="Polygon"){
        const average=samples.reduce((sum,sample)=>sum+sample.value,0)/samples.length;
        const rings=(geometry.coordinates as Position[][]).map(ring=>ring.slice(0,-1).map(pair=>position(pair)));
        instances.push(new GeometryInstance({geometry:new PolygonGeometry({
          polygonHierarchy:new PolygonHierarchy(rings[0],rings.slice(1).map(ring=>new PolygonHierarchy(ring))),
          vertexFormat:PerInstanceColorAppearance.VERTEX_FORMAT,
        }),attributes:material(Color.fromCssColorString(valueColor(average,range)).withAlpha(.68))}));
        labels.add({position:position(shape.center,90),text:average.toFixed(2)+(samples.length>1?" · "+samples.length+"站":""),
          font:"12px sans-serif",fillColor:Color.fromCssColorString("#274b43"),showBackground:true,
          backgroundColor:Color.fromCssColorString("#fffff5ed"),pixelOffset:new Cartesian2(14,-13)});
      }
      for(const sample of samples){
        const identity:NativeLayerSelection={kind:"ctd",layerId,sample,variable:view.variable};
        identities.add(identity);marks.push(sample.center);
        points.add({id:identity,position:position(sample.center,30),pixelSize:9,
          color:sample.name===view.stationId?selectedColor:Color.fromCssColorString(valueColor(sample.value,range)),
          outlineColor:Color.WHITE,outlineWidth:1});
      }
    }
    scene.primitives.add(points);scene.primitives.add(labels);
    const area=instances.length?scene.groundPrimitives.add(new GroundPrimitive({
      geometryInstances:instances,appearance:new PerInstanceColorAppearance({flat:true,translucent:true}),
      allowPicking:false,
    })):undefined;
    return {view,filters,gridKey:grid.key,marks,identities,ready:()=>true,clear(){
      scene.primitives.remove(points);scene.primitives.remove(labels);
      if(area)scene.groundPrimitives.remove(area);
    }};
  }

  function nativeFront(layerId:string,view:Extract<DataView,{kind:"front"}>,filters:Filters){
    const identities=new Set<NativeLayerSelection>(),marks:Coordinate[]=[];
    const projectedLines:NonNullable<NativeEntry["lines"]>=[];
    const first=frontsFor({...view,epoch:"first"},{...filters,period:null})[0];
    const instances=frontsFor(view,filters).flatMap(record=>{
      const date=record.label.match(/\d{4}-\d{2}-\d{2}$/)?.[0];
      if(!date)return [];
      const geometry=record.geometry as Geometry;
      const lines=geometry.type==="MultiLineString"?geometry.coordinates:geometry.type==="LineString"?[geometry.coordinates]:[];
      return lines.flatMap(line=>{
        if(line.length<2)return [];
        const point=line[Math.floor(line.length/2)] as Coordinate;
        const identity:NativeLayerSelection={kind:"glacier-front",layerId,objectId:record.key,observedOn:date,point};
        identities.add(identity);marks.push(point,line[0] as Coordinate,line.at(-1) as Coordinate);
        projectedLines.push({identity,points:line as Coordinate[]});
        return [new GeometryInstance({id:identity,
          geometry:new GroundPolylineGeometry({positions:line.map(pair=>position(pair)),width:3}),
          attributes:material(Color.fromCssColorString(record===first?"#b16b34":"#147d69")),
        })];
      });
    });
    const paths=instances.length?scene.groundPrimitives.add(new GroundPolylinePrimitive({
      geometryInstances:instances,appearance:new PolylineColorAppearance(),
    })):undefined;
    return {view,filters,gridKey:"",marks,identities,lines:projectedLines,ready:()=>paths?.ready??false,
      clear(){if(paths)scene.groundPrimitives.remove(paths);}};
  }

  return {
    update(layerId:string,input:NativeLayerInput|undefined,grid:GridSpec){
      const previous=entries.get(layerId);
      if(previous&&previous.view===input?.view&&previous.filters===input.filters&&
        previous.gridKey===(input.view.kind==="ctd"?grid.key:""))return;
      previous?.clear();
      entries.delete(layerId);
      if(input)entries.set(layerId,input.view.kind==="ctd"
        ? nativeCtd(layerId,input.view,input.filters,grid):nativeFront(layerId,input.view,input.filters));
    },
    has(layerId:string,input:NativeLayerInput|undefined){
      const entry=entries.get(layerId);
      return !!entry&&entry.view===input?.view&&entry.filters===input.filters&&entry.ready()&&entry.marks.some(project);
    },
    owns(identity:NativeLayerSelection,input:NativeLayerInput|undefined){
      const entry=entries.get(identity.layerId);
      return !!entry && entry.view===input?.view&&entry.filters===input.filters&&entry.identities.has(identity);
    },
    lineAt(layerId:string,input:NativeLayerInput|undefined,pixel:Cartesian2){
      const entry=entries.get(layerId);
      if(!entry||entry.view!==input?.view||entry.filters!==input.filters||!entry.ready())return;
      // Ground primitives can be stencil-composited without a pick colour at
      // the stroke edge. Hit-test the current rendered source path in CSS pixels.
      let result:NativeLayerSelection|undefined,best=4;
      for(const line of entry.lines??[]){
        let a:[number,number]|null=null;
        for(const point of line.points){
          const b=project(point);
          if(a&&b){
            const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
            const t=length?Math.min(1,Math.max(0,((pixel.x-a[0])*dx+(pixel.y-a[1])*dy)/length)):0;
            const distance=Math.hypot(pixel.x-a[0]-dx*t,pixel.y-a[1]-dy*t);
            if(distance<best){best=distance;result=line.identity;}
          }
          a=b;
        }
      }
      return result;
    },
    remove(layerId:string){entries.get(layerId)?.clear();entries.delete(layerId);},
    dispose(){for(const entry of entries.values())entry.clear();entries.clear();},
  };
}
