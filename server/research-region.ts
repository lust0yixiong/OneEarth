import {readFile,readdir} from "node:fs/promises";
import path from "node:path";
import {geoArea} from "d3-geo";
import {feature} from "topojson-client";
import atlas from "world-atlas/countries-110m.json";
import names from "../src/data/evidence/country-names.json";
import marine from "../src/data/evidence/marine-areas.json";
import {rectangle} from "../src/domain/geo-rectangle";
import {cellShape} from "../src/domain/spatial";
import type {Selection} from "../src/domain/types";
import {validResearchRegion,type ResearchRegion} from "../src/domain/research-region";
import type {Polygon,MultiPolygon} from "geojson";

// Explicit view windows for non-administrative research names. These are UI
// aids, not authoritative boundaries, user-approved extents, or query filters.
const windows:[string[],[number,number,number,number]][]=[
  [["川西","四川西部","western Sichuan","west Sichuan"],[97.3,27,104.5,34.4]],
  [["大兴安岭","大兴安岭山脉","Greater Khingan","Greater Khingan Range","Daxing'anling"],[119,43,127,53.6]],
  [["西北太平洋","Northwest Pacific","Northwestern Pacific"],[120,0,180,60]],
  [["长白山","Changbai Mountain","Changbai Mountains","Changbaishan"],[127,41,129.5,43.5]],
  [["青藏高原东北缘","东北青藏高原","northeastern Tibetan Plateau","northeast Tibetan Plateau"],[96,33,106,39.5]],
];
// Keep locality types when matching countries: "Mexico City" must never
// become the country "Mexico" just because both include the same name.
const normalize=(s:string)=>s.normalize("NFKC").toLowerCase().replace(/(?:地区|区域|\b(?:region|area)\b)\s*$/g,"").replace(/[\s'’·.-]/g,"");
const adminName=(s:string)=>normalize(s.replace(/(?:省|市|自治区|特别行政区|\b(?:Province|City|Autonomous Region))\s*$/i,""));
const provinces:Record<string,string>={北京:"Beijing",天津:"Tianjin",河北:"Hebei",山西:"Shanxi",内蒙古:"Inner Mongolia",辽宁:"Liaoning",吉林:"Jilin",黑龙江:"Heilongjiang",上海:"Shanghai",江苏:"Jiangsu",浙江:"Zhejiang",安徽:"Anhui",福建:"Fujian",江西:"Jiangxi",山东:"Shandong",河南:"Henan",湖北:"Hubei",湖南:"Hunan",广东:"Guangdong",广西:"Guangxi",海南:"Hainan",重庆:"Chongqing",四川:"Sichuan",贵州:"Guizhou",云南:"Yunnan",西藏:"Tibet",陕西:"Shaanxi",甘肃:"Gansu",青海:"Qinghai",宁夏:"Ningxia",新疆:"Xinjiang"};

function boundary(label:string,geometry:Polygon|MultiPolygon,source:string,sourceUrl:string,note:string):ResearchRegion {
  const area=structuredClone(geometry);
  for(const rings of area.type==="Polygon"?[area.coordinates]:area.coordinates)
    if(geoArea({type:"Polygon",coordinates:[rings[0]]})>2*Math.PI)rings.forEach(ring=>ring.reverse());
  const value:ResearchRegion={label,status:"located",geometry:area,precision:"boundary",source,sourceUrl,note};
  return validResearchRegion(value)?value:unresolved(label,"该地域边界过于复杂，暂未绘制；可在球上选择网格后提问。");
}
const unresolved=(label:string,note="尚未取得可核对的地域边界，可在球上选网格，或补充更明确的地名、经纬度范围。"):ResearchRegion=>
  ({label,status:"unresolved",geometry:null,precision:"approximate",source:"研究问题中的地名",note});

/** Offline first: no extra model call or network lookup on the chat critical
 * path. Use the atlas and existing boundary cache, never invent model polygons. */
export function researchRegions(directory:string) {
  const cache=new Map<string,Promise<ResearchRegion>>();
  let china:Promise<any[]>|undefined;
  const countries=feature(atlas as any,(atlas as any).objects.countries) as any;
  async function resolve(label:string):Promise<ResearchRegion> {
    const key=normalize(label);
    if(["全球","全世界","global","world","worldwide"].includes(key))return {label,status:"located",geometry:null,precision:"global",source:"用户指定全球",note:"全球研究范围。"};
    const window=windows.find(([aliases])=>aliases.some(a=>normalize(a)===key));
    if(window)return {label,status:"located",geometry:rectangle(...window[1]),precision:"approximate",source:"OneEarth 地域示意窗口",
      note:"虚线为地名的大致定位窗口，不是精确研究边界，也不作为检索过滤条件。经度 "+window[1][0]+" 至 "+window[1][2]+"°，纬度 "+window[1][1]+" 至 "+window[1][3]+"°；可通过选网格明确范围。"};
    const country=countries.features.filter((f:any)=>[f.properties.name,(names.numeric as Record<string,string>)[String(f.id)],(names.atlasName as Record<string,string>)[f.properties.name]].some(n=>n && normalize(n)===key));
    if(country.length===1)return boundary(label,country[0].geometry,"Natural Earth · 概化图集","https://www.naturalearthdata.com/","概化地理轮廓，仅用于定位，不代表精确研究区或数据覆盖。 ");
    const sea=marine.filter(row=>normalize(row.name)===key);
    if(sea.length===1)return boundary(label,sea[0].geometry as Polygon|MultiPolygon,"Natural Earth · 海域图集","https://www.naturalearthdata.com/","概化海域轮廓，仅用于定位，不代表用户已确定的精确边界。");
    // Existing local geoBoundaries ADM1 cache. Never download a national file
    // just because someone asks a question. Chinese names are exact aliases.
    const english=provinces[adminName(label)];
    if(english || Object.values(provinces).some(p=>adminName(p)===adminName(label))){
      china??=(async()=>{
        const file=(await readdir(directory)).find(f=>/^CHN-ADM1-[\w-]+\.geojson$/.test(f));
        return file?JSON.parse(await readFile(path.join(directory,file),"utf8")).features:[];
      })().catch(()=>[]);
      const matches=(await china).filter(f=>adminName(f.properties?.shapeName || "")===adminName(english || label));
      if(matches.length===1)return boundary(label,matches[0].geometry,"geoBoundaries · 本地行政边界参考","https://www.geoboundaries.org/","行政区轮廓参考缓存所载版本；不等同于数据实际覆盖。");
    }
    return unresolved(label);
  }
  return {async locate(label:string|null|undefined,grid?:Pick<Selection,"id"|"grid"|"point">):Promise<ResearchRegion|null>{
    // An explicit attached grid has a concrete user-selected boundary.
    if(grid){
      const shape=cellShape(grid.id,grid.grid);
      return {label:grid.grid.label+" · "+grid.id,status:"located",geometry:shape.geometry,precision:"grid",source:"用户选中的网格",note:"选中网格的实际边界。"};
    }
    if(!label?.trim())return null;
    const text=label.trim().slice(0,1200);
    if(!cache.has(text)){if(cache.size>=256)cache.delete(cache.keys().next().value!);cache.set(text,resolve(text));}
    return cache.get(text)!;
  }};
}
