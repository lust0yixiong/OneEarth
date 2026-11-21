import {geoArea,geoContains,geoDistance,geoPath} from 'd3-geo';
import {cellAt,cellShape,drawGrid} from './research-grid.mjs';
import outlines from './research-shapes.json';
import bartin from './bartin-boundary.json';
import lakes from './lake-evidence.json';
import {demSamples} from './research-ice.mjs';
import {greenlandEvidence} from './research-polar.mjs';

const polygon=ring=>({type:'Polygon',coordinates:[ring]});
const along=Array.from({length:81},(_,i)=>60+i*.25);
const westTibet=polygon([[60,30],...along.map(lon=>[lon,40]),...[...along].reverse().map(lon=>[lon,30])]);
// D3 expects clockwise exteriors. Work on a display copy of the source boundary.
const province=structuredClone(bartin.features[0].geometry);
for(const rings of province.coordinates){
  if(geoArea({type:'Polygon',coordinates:rings})>2*Math.PI)rings.forEach(r=>r.reverse());
}
export const scopes={
  ice:[['阿尔卑斯','Hintereisferner'],['阿拉斯加','Columbia']],
  lakes:[['Mendenhall','Mendenhall'],['Alsek','Alsek']]
};
const makePoint=(label,center,need,origin,extra={})=>({label,center,need,origin,...extra});
export function spatialModel(key,c){
  if(key==='Q02'){
    const dem=demSamples.map(x=>makePoint(x.name,x.center,0,'实读高程 '+x.value.toFixed(2)+' m',{url:x.url}));
    const shapes=outlines.filter(x=>x.group==='ice').map(x=>({...x,need:2,year:x.label==='Columbia'?2009:2003}));
    const pairedEntries = [];
    for (const point of dem) {
      const boundary = shapes.find(shape => point.label.startsWith(shape.label) && geoContains(shape.geometry, point.center));
      if (!boundary) continue;
      // The boundary is evidence for this verified sample at the pixel centre.
      // Index that relationship only there, independently of the full outline.
      pairedEntries.push(point, makePoint(boundary.label, point.center, boundary.need,
        boundary.origin + ' · 轮廓包含该 DEM 像元中心', {year: boundary.year}));
    }
    return {entries:[...dem,...shapes],pairedEntries,places:scopes.ice,caption:'两条冰川样本 · 公开 DEM 像元与 RGI 轮廓',labels:dem};
  }
  if(key==='Q07'){
    return {entries:[],area:westTibet,areaNeed:c.needs.findIndex(n=>/范围|研究区/.test(n.name)),areaTitle:'论文研究窗口 · 60–80°E，30–40°N',areaPoints:[[60,30],[60,40],[80,40],[80,30]],caption:'论文 §2.1 经纬度窗口 · 积雪产品有效像元待核'};
  }
  if(key==='Q14'){
    return {entries:[],area:province,areaNeed:0,areaTitle:'土耳其 › 巴尔滕省 · ADM1',areaPoints:province.coordinates.flat(2),caption:'2021 省界 · geoBoundaries / OpenStreetMap · CC BY-SA 2.0'};
  }
  if(key==='Q20'){
    const i=c.needs.findIndex(n=>/前缘/.test(n.name));
    const obj=c.needs.findIndex(n=>/对象|编目|标识|研究冰川/.test(n.name));
    const entries=lakes.points.map(p=>makePoint(p.name,p.center,Math.max(obj,0),'作者 CSV · 冰川质心 '+p.id,{object:p.id,studyOnly:true}));
    const lines=outlines.filter(x=>x.group==='lakes').map(x=>({...x,need:Math.max(i,0),year:Number(x.label.match(/\d{4}/)[0])}));
    return {entries:[...entries,...lines],places:scopes.lakes,caption:'55 条冰川质心记录 · 两条冰川的 4 条前缘线',labels:entries.filter(e=>/mendenhall|alsek/i.test(e.label))};
  }
  if(key==='Q19')return greenlandModel(c);
  return {entries:[],caption:'题库线索 · 等待可定位的原始证据'};
}
function greenlandModel(c){
  const i=c.needs.findIndex(n=>/冰厚|基岩|地震/.test(n.name));
  const j=c.needs.findIndex(n=>/海洋|温盐|CTD/.test(n.name));
  const track=greenlandEvidence.seismicProfile.geometry.coordinates;
  const seismicPoints=greenlandEvidence.mainSeismicPoints.points;
  const ctdStations=greenlandEvidence.ctdEvents;
  const entries=[...seismicPoints.map(p=>makePoint(p.name,p.center,i,'原表地震观测 · '+p.name,p)),
    ...track.map((center,k)=>makePoint('MGO #'+(k+1),center,i,'MGO 地震测线取样点',{track:true})),
    ...ctdStations.map(p=>makePoint(p.name,p.center,j,'CTD 温盐剖面 · '+p.depthRangeM.join('–')+' m',{...p,year:Number(p.date.slice(0,4))}))];
  return {entries,track:greenlandEvidence.seismicProfile.geometry,caption:'格陵兰东北 · 地震观测与 CTD 剖面站',labels:[]};
}
export function evidenceIndex(entries,g){
  const index=new Map();
  for(const e of entries){
    const cells=e.cells?e.cells[g.key]:[cellAt(e.center,g)];
    for(const id of cells||[]){
      if(!index.has(id))index.set(id,[]);
      index.get(id).push(e);
    }
  }
  return index;
}
function shapePaint(ctx,path,geometry,stroke,fill,width=1){
  ctx.beginPath();path(geometry);
  if(fill){ctx.fillStyle=fill;ctx.fill();}
  if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}
}
export function drawResearchMap({ctx,projection,camera,g,w,h,z,mesh,layer,model,entries,index,selected}){
  const path=geoPath(projection,ctx);
  if(mesh)drawGrid(ctx,projection,camera,g,w,h,z);
  if(model.area){
    ctx.setLineDash(model.area===westTibet?[6,4]:[]);
    shapePaint(ctx,path,model.area,'#826321','rgba(198,162,74,.13)',1.8);ctx.setLineDash([]);
  }
  {
    for(const [id,items] of index){
      const {geometry,center}=cellShape(id,g);
      if(geoDistance(camera,center)>Math.PI*.53)continue;
      const [x,y]=projection(center);
      if(x< -100||x>w+100||y< -100||y>h+100)continue;
      const alpha=Math.min(.76,.39+.09*Math.log2(items.length));
      shapePaint(ctx,path,geometry,'#137e70','rgba(0,126,114,'+alpha+')',1.15);
      if(z<=7){
        // A halo locates a subpixel cell at world scale. Picking always uses the cell.
        ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.strokeStyle='#138877b3';ctx.lineWidth=1;ctx.stroke();
      }
    }
    for(const r of entries)if(layer!=='joint'&&r.geometry&&z>=18)shapePaint(ctx,path,r.geometry,r.group==='lakes'?'#ac502c':'#095d59',null,2);
    if(layer!=='joint'&&model.track&&entries.some(e=>e.track)&&z>=18)shapePaint(ctx,path,model.track,'#a35232',null,2);
    const occupied=[];
    for(const e of model.labels||[]){
      if(layer==='joint'||!entries.includes(e)||geoDistance(camera,e.center)>Math.PI/2-.02)continue;
      const [x,y]=projection(e.center),label=e.label.replace(/ Glacier$/i,'');
      ctx.font='600 11px system-ui';const tw=ctx.measureText(label).width+12;
      const left=Math.min(w-tw-5,Math.max(4,(x>w/2?x-tw-8:x+9))),top=Math.min(h-25,Math.max(3,y-25));
      if(x<2||x>w-2||y<2||y>h-2||occupied.some(([a,b])=>Math.abs(left-a)<tw&&Math.abs(top-b)<21))continue;
      occupied.push([left,top]);ctx.fillStyle='#f9fffbec';ctx.fillRect(left,top,tw,19);
      ctx.fillStyle='#184b42';ctx.fillText(label,left+6,top+13);
    }
  }
  if(selected)shapePaint(ctx,path,cellShape(selected.id,selected.grid).geometry,'#ad542c','rgba(207,119,51,.09)',2.4);
}
export function withinStudy(model,point){return model.area&&geoContains(model.area,point);}
