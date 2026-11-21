import { rectangle } from "./geo-rectangle";
import {feature} from "topojson-client";
import atlas from "world-atlas/countries-110m.json";
import {geoCentroid} from "d3-geo";
import type {Polygon, MultiPolygon} from "geojson";
import snapshot from "../data/evidence/haina-extents.json";
import reviewData from "../data/evidence/haina-scope-review.json";
import reviewedShapes from "../data/evidence/haina-reviewed-areas.json";
import type {SourceProfile} from "./types";

type Area = Polygon | MultiPolygon;
type Raw = Partial<{spatialType:string|null;westBoundLongitude:number|null;eastBoundLongitude:number|null;southBoundLatitude:number|null;northBoundLatitude:number|null;geographicIdentifier:string|null;timeStart:string|null;timeEnd:string|null}>;
const raw:Record<string,Raw>=snapshot.records;
const codes:Record<string,string>={"China":"156","United States of America":"840","U.K. of Great Britain and Northern Ireland":"826","Netherlands":"528","Mexico":"484","New Zealand":"554","Denmark":"208"};
const shapes=new Map<string,Area>();
type Review = {
  title:string; basis:string; reason:string; original?:string; sourceCheck?:string;
  world?:boolean; shape?:string; country?:string; box?:number[];
};
const reviews:Record<string,Review>=reviewData.records;
const administrativeShapes = reviewedShapes as unknown as Record<string,{geometry:Area;source:string}>;
export function hainaScopeReview(id:number,title?:string) {
  const review=reviews[id];
  return review && (!title || review.title===title) ? review : undefined;
}
function reviewedScope(review:Review):Pick<SourceProfile,"extent"|"area"|"coverage"> {
  if(review.world)return {extent:"world",coverage:"全球产品目录范围 · "+review.reason};
  const key=JSON.stringify([review.country,review.shape,review.box]);
  let area=shapes.get(key);
  if(!area){
    if(review.box && review.box.length===4){
      const [w,s,e,n]=review.box;
      area=rectangle(w,s,e,n);
    } else if(review.country || review.shape==="CONUS"){
      const code=review.country || "840";
      const item=atlas.objects.countries.geometries.find(g=>String(g.id)===code);
      if(item){
        const g=(feature(atlas as any,item as any) as unknown as {geometry:Area}).geometry;
        if(review.shape==="CONUS" && g.type==="MultiPolygon"){
          area={type:"MultiPolygon",coordinates:g.coordinates.filter(coordinates=>{
            const [x,y]=geoCentroid({type:"Polygon",coordinates});
            return x>=-125 && x<=-66 && y>=24 && y<=50;
          })};
        }else area=g;
      }
    } else if(review.shape)area=administrativeShapes[review.shape]?.geometry;
    if(area)shapes.set(key,area);
  }
  const label=review.box?"发布方集合外包框":area?"行政范围近似":"范围复核";
  return {area,coverage:label+" · "+review.reason};
}
export function hainaSpace(id:number,title?:string):Pick<SourceProfile,"extent"|"area"|"coverage"|"catalogYears"> {
  const m=raw[id]||{};
  const year=(stamp:string|null|undefined)=>stamp?new Date(Number(stamp)+8*3600000).getUTCFullYear():NaN;
  const first=year(m.timeStart), last=year(m.timeEnd);
  const years=Number.isFinite(first)&&Number.isFinite(last)&&first<=last?{catalogYears:[first,last] as const}:{};
  const w=m.westBoundLongitude,e=m.eastBoundLongitude,s=m.southBoundLatitude,n=m.northBoundLatitude;
  const review=hainaScopeReview(id,title);
  if(w==null||e==null||s==null||n==null){
    if(review)return {...years,...reviewedScope(review)};
    if(id===1824119)return {...years,extent:"world",coverage:"海纳产品说明标注全球再分析范围。"};
    return {...years,coverage:"海纳公开地学元数据未提供可定位范围。"};
  }
  if(!(w>=-180&&w<e&&e<=180&&s>=-90&&s<n&&n<=90))
    return {...years,coverage:"海纳经纬度界限次序或取值异常。"+(review?.reason||"范围待核。")};
  if(w===-180&&e===180&&s===-90&&n===90)return {...years,extent:"world",coverage:"海纳目录标注全球外包范围，局地观测须核对原始数据。"};
  const name=m.geographicIdentifier||"",code=m.spatialType==="geographic_identifier"?codes[name]:undefined;
  const key=JSON.stringify([code,w,s,e,n]);
  let area=shapes.get(key);
  if(!area){
    if(code){
      const item=atlas.objects.countries.geometries.find((g)=>String(g.id)===code);
      if(item){
        const country=feature(atlas as any,item as any) as unknown as {geometry:Area};
        const polygons=country.geometry.type==="Polygon"?[country.geometry.coordinates]:country.geometry.coordinates;
        const parts=polygons.filter(coordinates=>{
          const [x,y]=geoCentroid({type:"Polygon",coordinates});
          return x>=w && x<=e && y>=s && y<=n;
        });
        if(parts.length)area={type:"MultiPolygon",coordinates:parts};
      }
    }
    area??=rectangle(w,s,e,n);shapes.set(key,area);
  }
  const label=code&&!area.bbox?"海纳登记国家 · 图集边界近似":name?"海纳地名及登记外包框":"海纳登记外包框";
  return {...years,area,coverage:[label,name,`西 ${w}° / 南 ${s}° / 东 ${e}° / 北 ${n}°`].filter(Boolean).join(" · ")};
}
export function hainaExtentEvidence(id:number,title?:string){
  const review=hainaScopeReview(id,title);
  return {source:"海纳 earth/meta",synced:snapshot.synced,...raw[id],
    ...(review?{review:{...review,date:reviewData.reviewedAt,
      boundarySource:review.shape && administrativeShapes[review.shape]?.source || (review.country || review.shape==="CONUS"?"Natural Earth 1:110m":undefined)}}:{})};
}
