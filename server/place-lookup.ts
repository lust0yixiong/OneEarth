import type {Coordinate} from "../src/domain/types";

/** An explicit "move the view to X" request. Only these may become a place lookup;
 *  ordinary questions that happen to mention a city must keep their existing route. */
export type NavigationTarget={verb:string;place:string};
const verbs="定位|导航|飞到|飞往|前往|移动到|移到|带我去|带我到";
const navigationPattern=new RegExp("^(?:(?:请|请求|麻烦|帮我|能否|可以)\\s*)*(?:在(?:地图|地球|球)上\\s*)?(?:(?:把|将|让)\\s*)?(?:地图|地球|球|视图|视角)?\\s*("+verbs+")\\s*(?:到|至|往|去)?\\s*(.+)$","u");
const englishNavigation=/^(?:please\s+)?(?:fly|go|navigate|pan|move|zoom)\s+to\s+(.+)$/i;
/** A map move is not a data request; these words mean the turn is about sources. */
const sourceWords=/(?:数据|资料|论文|文献|数据集|影像|观测|变量|产品|来源|下载|检索|搜索)|\b(?:data|dataset|datasets|paper|papers|literature|image|images|observation|observations|variable|product|source|download|search)\b/iu;
/** "把地图定位到杭州后帮我分析森林" is a compound request, not a pure map move. */
const extraRequest=/(?:然后|接着|并且|帮我|帮忙|分析|研究|查看|告诉|解释|比较|生成|导出|讲解)/u;
const pronouns=/^(?:那边|那里|这儿|这里|这片|那片|这个|那个|这|那)$/u;

export function navigationTarget(query:string):NavigationTarget|null{
  const text=query.trim().replace(/[。.!！?？\s]+$/u,"");
  if(/[？?]/u.test(text)||/(?:哪些|什么|怎么|为什么|是否|多少)/u.test(text))return null;
  const english=text.match(englishNavigation);
  const match=english?null:text.match(navigationPattern);
  const raw=english?english[1]:match?.[2];
  if(!raw)return null;
  const place=raw.trim().replace(/^[「『“‘"']+|[」』”‘"']+$/gu,"").trim();
  if(!place||place.length>40||pronouns.test(place)||sourceWords.test(place)||extraRequest.test(place))return null;
  return {verb:english?"fly":match![1],place};
}

const numberPattern="(-?\\d{1,3}(?:\\.\\d+)?)";
const decimal=(value:string,sign:string)=>{
  const number=Number(value);
  if(!Number.isFinite(number))return null;
  return /[SW南西]/i.test(sign)?-number:number;
};
const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));
const fmt=(value:number,digits=2)=>Math.abs(value).toFixed(digits);
function coordinateLabel(center:Coordinate){
  return (center[1]>=0?"北纬 ":"南纬 ")+fmt(center[1])+"°，"+(center[0]>=0?"东经 ":"西经 ")+fmt(center[0])+"°";
}
function parseZoom(text:string):number|null{
  const match=text.match(/(?:zoom|缩放|比例尺|z)\s*[=:：]?\s*(\d{1,4}(?:\.\d+)?)/i);
  const value=match?Number(match[1]):NaN;
  return Number.isFinite(value)?clamp(value,1,2200):null;
}
/** Decimal, degree-minute-second and labeled Chinese/English coordinates. */
export function parseCoordinates(text:string):{center:Coordinate;zoom:number|null;label:string}|null{
  const value=text.normalize("NFKC").replace(/[，]/g,",").replace(/[（）()\[\]【】]/g,"").replace(/[′’]/g,"'").replace(/[″”]/g,'"');
  let latitude:number|null=null,longitude:number|null=null;
  const labeledLat=value.match(new RegExp("(?:北纬|南纬|纬度|lat(?:itude)?)\\s*[:：]?\\s*"+numberPattern+"\\s*(?:°|度)?\\s*([NS北南])?","i"));
  const labeledLon=value.match(new RegExp("(?:东经|西经|经度|lon(?:gitude)?|lng)\\s*[:：]?\\s*"+numberPattern+"\\s*(?:°|度)?\\s*([EW东西])?","i"));
  if(labeledLat&&labeledLon){
    latitude=decimal(labeledLat[1],labeledLat[2]||(/南纬/i.test(labeledLat[0])?"S":""));
    longitude=decimal(labeledLon[1],labeledLon[2]||(/西经/i.test(labeledLon[0])?"W":""));
  }
  if(latitude===null||longitude===null){
    const dms=/(\d{1,3})\s*[°度]\s*(?:(\d{1,2})\s*(?:'|′|分)\s*)?(?:(\d{1,2}(?:\.\d+)?)\s*(?:"|″|秒)\s*)?([NS])/i.exec(value);
    if(dms){latitude=(Number(dms[1])+Number(dms[2]||0)/60+Number(dms[3]||0)/3600)*(/S/i.test(dms[4])?-1:1);}
    const dmsLon=/(\d{1,3})\s*[°度]\s*(?:(\d{1,2})\s*(?:'|′|分)\s*)?(?:(\d{1,2}(?:\.\d+)?)\s*(?:"|″|秒)\s*)?([EW])/i.exec(value);
    if(dmsLon){if(longitude===null)longitude=(Number(dmsLon[1])+Number(dmsLon[2]||0)/60+Number(dmsLon[3]||0)/3600)*(/W/i.test(dmsLon[4])?-1:1);}
  }
  if(latitude===null||longitude===null){
    const suffixedLat=new RegExp(numberPattern+"\\s*(?:°|度)?\\s*([NS])\\b","i").exec(value);
    const suffixedLon=new RegExp(numberPattern+"\\s*(?:°|度)?\\s*([EW])\\b","i").exec(value);
    if(suffixedLat&&suffixedLon){
      latitude=decimal(suffixedLat[1],suffixedLat[2]);
      longitude=decimal(suffixedLon[1],suffixedLon[2]);
    }
  }
  if(latitude===null||longitude===null){
    const prefixedLat=new RegExp("([NS])\\s*[:：]?\\s*"+numberPattern,"i").exec(value);
    const prefixedLon=new RegExp("([EW])\\s*[:：]?\\s*"+numberPattern,"i").exec(value);
    if(prefixedLat&&prefixedLon){
      latitude=decimal(prefixedLat[2],prefixedLat[1]);
      longitude=decimal(prefixedLon[2],prefixedLon[1]);
    }
  }
  if(latitude===null||longitude===null){
    const pair=value.match(new RegExp("^\\s*([+-]?\\d+(?:\\.\\d+)?)\\s*,\\s*([+-]?\\d+(?:\\.\\d+)?)\\s*$"));
    if(pair){
      const first=Number(pair[1]),second=Number(pair[2]);
      // "30.3, 120.2" is latitude first; "120.2, 30.3" is longitude first.
      if(Math.abs(first)<=90&&Math.abs(second)>90){latitude=first;longitude=second;}
      else if(Math.abs(first)>90&&Math.abs(second)<=90){latitude=second;longitude=first;}
      else {longitude=first;latitude=second;}
    }
  }
  if(latitude===null||longitude===null)return null;
  if(![latitude,longitude].every(Number.isFinite)||Math.abs(latitude)>90||Math.abs(longitude)>180)return null;
  const center:Coordinate=[longitude,latitude];
  return {center,zoom:parseZoom(text),label:coordinateLabel(center)};
}

export type PlaceHit={label:string;center:Coordinate;zoom:number;detail:string;source:"photon"|"wikipedia";weak?:boolean;type?:string;province?:string;city?:string;countryCode?:string};
type PhotonFeature={geometry?:{coordinates?:unknown};properties?:Record<string,unknown>};
const typeWeight:Record<string,number>={country:9,state:7,region:6,county:6,city:8,district:5,locality:3,other:2,street:1,house:.5};
const adminTypes=new Set(["country","state","region","county","city","district","locality"]);
/** Drop Tibetan/Burmese script tails from OSM names when the user wrote Han characters. */
const displayName=(value:string,query:string)=>{
  if(!/\p{Script=Han}/u.test(query))return value;
  const han=value.match(/^[\p{Script=Han}]+/u)?.[0];
  return han&&han.length>=2?han:value;
};
const normalizePlace=(value:string)=>value.normalize("NFKC").toLowerCase()
  .replace(/[^\p{Script=Han}a-z0-9]+/gu,"")
  .replace(/(?:市|县|区|镇|村|街道)$/u,"");

/** A name-only match is not enough: "长江口" must not silently become "长江口水库". */
function photonScore(feature:PhotonFeature,key:string,index:number){
  const properties=feature.properties||{};
  const name=typeof properties.name==="string"?properties.name:"";
  const normalized=normalizePlace(name);
  if(!key||!normalized)return null;
  let match=0;
  if(normalized===key)match=10;
  // Only a result that extends the query counts as a prefix match. A shorter
  // result ("长江河村" after suffix stripping) must not become "长江河口".
  else if(normalized.startsWith(key))match=6;
  else if(normalized.includes(key)||key.includes(normalized))match=4;
  else return null;
  const type=String(properties.type||"");
  return {score:match+(typeWeight[type]??1)/4-index*.01,strong:match===10||(match>=6&&adminTypes.has(type))};
}

/** Prefer an exact name over a longer feature that merely contains it. */
export function rankPhoton(features:PhotonFeature[],query:string):number{
  const key=normalizePlace(query);
  let best=-1,bestScore=-Infinity;
  features.forEach((feature,index)=>{
    const scored=photonScore(feature,key,index);
    if(scored&&scored.score>bestScore){bestScore=scored.score;best=index;}
  });
  return best;
}

const defaultZoom:Record<string,number>={country:2,state:20,region:40,city:70,county:120,district:200,locality:300,other:300,street:600,house:700};
/** Picture a city's urban area rather than its whole prefecture boundary. */
export function photonCamera(feature:PhotonFeature):{center:Coordinate;zoom:number}|null{
  const properties=feature.properties||{};
  const coordinates=Array.isArray(feature.geometry?.coordinates)?feature.geometry!.coordinates as number[]:[];
  let center:Coordinate|null=coordinates.length>=2&&Number.isFinite(coordinates[0])&&Number.isFinite(coordinates[1])?[coordinates[0],coordinates[1]]:null;
  const extent=Array.isArray(properties.extent)&&properties.extent.length===4&&(properties.extent as unknown[]).every(value=>typeof value==="number")?properties.extent as number[]:null;
  if(!center&&!extent)return null;
  if(extent){
    const [west,north,east,south]=extent;
    if(!center||center[0]<west||center[0]>east||center[1]<south||center[1]>north)center=[(west+east)/2,(south+north)/2];
  }
  const type=typeof properties.type==="string"?properties.type:"other";
  let zoom=defaultZoom[type]??300;
  if(extent){
    const [west,north,east,south]=extent;
    const span=Math.abs(north-south),width=Math.abs(east-west)*Math.max(.15,Math.cos((center![1]*Math.PI)/180));
    const fitted=55/Math.max(.002,span,width);
    zoom=/^country$/.test(type)?clamp(fitted,1,3)
      :/^(?:state|region)$/.test(type)?clamp(fitted,2,70)
      :/^county$/.test(type)?clamp(fitted,40,300)
      :/^city$/.test(type)?clamp(fitted,45,120)
      :/^district$/.test(type)?clamp(fitted,70,500)
      :clamp(fitted,20,900);
  }
  return {center:center!,zoom};
}

/** Generic basin/region suffixes hide the real name from gazetteers ("雅江流域" → "雅江"). */
export function placeVariants(place:string):string[]{
  const base=place.trim();
  if(!base)return [];
  const values=[base];
  const stripped=base.replace(/(?:流域|地区|区域|一带|河谷|平原|盆地|高原|山脉|水系|河段|干流|全流域)$/u,"").trim();
  if(stripped&&!values.includes(stripped))values.push(stripped);
  const reach=base.replace(/(?:上|中|下)游$/u,"").trim();
  if(reach&&!values.includes(reach))values.push(reach);
  return values.slice(0,3);
}

type FetchJson=(url:string,signal:AbortSignal)=>Promise<unknown>;
const userAgent="OneEarthPrototype/0.1 (place lookup)";
const fetchJson:FetchJson=async(url,signal)=>{
  const response=await fetch(url,{signal,redirect:"error",headers:{"user-agent":userAgent,"accept":"application/json"}});
  if(!response.ok)throw Error("地名服务返回 HTTP "+response.status);
  return response.json();
};
const photonCache=new Map<string,{at:number;hit:PlaceHit|null}>();
const wikiCache=new Map<string,{at:number;hit:PlaceHit|null}>();
let photonLast=0,wikiLast=0,wikiCooldownUntil=0;
async function throttle(last:number,spacing=300){const wait=Math.max(0,spacing-(Date.now()-last));if(wait)await new Promise(resolve=>setTimeout(resolve,wait));}
export function geocoderEnabled(){return process.env.ONEEARTH_GEOCODER!=="off";}
export function geocoderUrl(){return (process.env.ONEEARTH_GEOCODER_URL||"https://photon.komoot.io/api/").replace(/\/?$/,"/");}

/** Online geocoder for anything the local gazetteer cannot name. Results are cached
 *  for an hour and requests are spaced so a burst of chat turns cannot hammer it. */
export async function photonLookup(query:string,signal:AbortSignal,fetcher:FetchJson=fetchJson):Promise<PlaceHit|null>{
  const key=normalizePlace(query);
  const cached=photonCache.get(key);
  if(cached&&Date.now()-cached.at<3600000)return cached.hit;
  await throttle(photonLast);
  signal.throwIfAborted();
  photonLast=Date.now();
  const data=await fetcher(geocoderUrl()+"?q="+encodeURIComponent(query)+"&limit=5",AbortSignal.any([signal,AbortSignal.timeout(6000)])) as {features?:PhotonFeature[]};
  const features=Array.isArray(data?.features)?data.features:[];
  const index=rankPhoton(features,query);
  let hit:PlaceHit|null=null;
  if(index>=0){
    const feature=features[index],properties=feature.properties||{},camera=photonCamera(feature),scored=photonScore(feature,key,index);
    if(camera){
      const rawName=typeof properties.name==="string"&&properties.name?properties.name:query;
      const name=displayName(rawName,query);
      const parts=[properties.city,properties.county,properties.state,properties.country]
        .map(part=>typeof part==="string"?displayName(part,query):"")
        .filter((part):part is string=>!!part&&part!==name)
        .filter((part,position,all)=>all.indexOf(part)===position);
      hit={label:name,center:camera.center,zoom:camera.zoom,detail:parts.join(" · "),source:"photon",weak:!scored?.strong,
        type:typeof properties.type==="string"?properties.type:undefined,
        province:typeof properties.state==="string"?displayName(properties.state,query):undefined,
        city:typeof properties.city==="string"?displayName(properties.city,query):typeof properties.county==="string"?displayName(properties.county,query):undefined,
        countryCode:typeof properties.countrycode==="string"?properties.countrycode:undefined};
    }
  }
  photonCache.set(key,{at:Date.now(),hit});
  if(photonCache.size>500)photonCache.delete(photonCache.keys().next().value!);
  return hit;
}

function cjkCharacters(text:string){return new Set([...text.matchAll(/\p{Script=Han}/gu)].map(match=>match[0]));}
/** Wikipedia search is fuzzy; require at least half the query's Han characters. */
function sharesCharacters(title:string,query:string){
  const asked=cjkCharacters(query);
  if(!asked.size)return true;
  const found=cjkCharacters(title);
  let shared=0;
  for(const character of asked)if(found.has(character))shared++;
  return shared/asked.size>=.5;
}
function wikipediaZoom(title:string){
  if(/(?:省|自治区|特别行政区)$/.test(title))return 4;
  if(/(?:市)$/.test(title))return 45;
  if(/(?:县|区|镇|乡|村|岛|港|站|机场)$/.test(title))return 90;
  if(/(?:江|河|湖|海|山|岭|峰|高原|盆地|平原|沙漠|峡谷|流域|水系|工程|电站|大坝|渠|口|湾|三角洲|自然保护区)$/.test(title))return 12;
  return 20;
}
type WikiPage={title?:string;index?:number;coordinates?:{lat?:number;lon?:number}[];pageprops?:{wikibase_item?:string}};
async function wikidataCenter(id:string,signal:AbortSignal,fetcher:FetchJson):Promise<Coordinate|null>{
  const data=await fetcher("https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids="+encodeURIComponent(id),
    AbortSignal.any([signal,AbortSignal.timeout(6000)])) as {entities?:Record<string,{claims?:Record<string,{mainsnak?:{datavalue?:{value?:{latitude?:number;longitude?:number}}}}[]>}>};
  const value=data?.entities?.[id]?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
  return value&&Number.isFinite(value.latitude)&&Number.isFinite(value.longitude)?[value.longitude!,value.latitude!]:null;
}

/** Encyclopedic fallback for basin names, projects and shorthands that OSM lacks
 *  ("雅下", "雅江流域"). Page coordinates come from Wikipedia, then Wikidata. */
export async function wikipediaLookup(query:string,signal:AbortSignal,fetcher:FetchJson=fetchJson):Promise<PlaceHit|null>{
  const key=normalizePlace(query);
  const cached=wikiCache.get(key);
  if(cached&&Date.now()-cached.at<86400000)return cached.hit;
  if(Date.now()<wikiCooldownUntil)return null;
  await throttle(wikiLast,1000);
  signal.throwIfAborted();
  wikiLast=Date.now();
  let search:{query?:{pages?:Record<string,WikiPage>}};
  try{
    search=await fetcher("https://zh.wikipedia.org/w/api.php?action=query&generator=search&gsrlimit=5&prop=coordinates|pageprops&format=json&gsrsearch="+encodeURIComponent(query),
      AbortSignal.any([signal,AbortSignal.timeout(8000)])) as {query?:{pages?:Record<string,WikiPage>}};
  }catch(error){
    if(/\b429\b/.test(String(error)))wikiCooldownUntil=Date.now()+60000;
    throw error;
  }
  // Only the top search result: lower-ranked pages drift to broader or unrelated places.
  const pages=Object.values(search?.query?.pages||{}).filter((page):page is WikiPage&{title:string}=>typeof page?.title==="string"&&!!page.title)
    .sort((a,b)=>(a.index??99)-(b.index??99)).slice(0,1);
  let hit:PlaceHit|null=null;
  for(const page of pages){
    if(!sharesCharacters(page.title,query))continue;
    const coordinates=page.coordinates?.[0],lat=coordinates?.lat,lon=coordinates?.lon;
    const center:Coordinate|null=Number.isFinite(lat)&&Number.isFinite(lon)?[lon!,lat!]:null;
    const resolved=center||(page.pageprops?.wikibase_item?await wikidataCenter(page.pageprops.wikibase_item,signal,fetcher):null);
    if(!resolved)continue;
    hit={label:page.title,center:resolved,zoom:wikipediaZoom(page.title),detail:"维基百科",source:"wikipedia"};
    break;
  }
  wikiCache.set(key,{at:Date.now(),hit});
  if(wikiCache.size>500)wikiCache.delete(wikiCache.keys().next().value!);
  return hit;
}

export const placeLookupInstructions=`把用户给出的模糊地名、区域俗称或简称，解析为可以在地图上定位的规范地理名称。
只依据公开、确定的地理知识；只返回名称，不返回坐标、边界或解释。优先给出最贴近原意的具体地名，不要用省、国家等更宽泛的上级行政区替代明确地点。
示例：雅下 → 雅鲁藏布江下游水电工程；雅江流域 → 雅砻江；三峡库区 → 长江三峡；长白山天池 → 长白山天池。
如果无法确定，或可能指两个互不相邻的地方，返回空数组。
只输出 JSON {"candidates":[...],"note":"..."}；candidates 最多两个，按可能性排序。`;
export const placeLookupSchema={type:"object",additionalProperties:false,required:["candidates","note"],properties:{
  candidates:{type:"array",maxItems:2,items:{type:"string",minLength:1,maxLength:120}},note:{type:"string",maxLength:300}}};
/** The model only standardizes the name; coordinates still come from a geocoder. */
export async function canonicalPlaceNames(place:string,run:(prompt:string)=>Promise<string>):Promise<string[]>{
  try{
    const raw=await run(placeLookupInstructions+"\n"+JSON.stringify({place}));
    const value=JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/gi,""));
    const list:string[]=Array.isArray(value?.candidates)
      ?value.candidates.filter((item:unknown):item is string=>typeof item==="string"&&!!item.trim()&&item.trim().length<=120)
      :[];
    return [...new Set(list.map(item=>item.trim()))].slice(0,2);
  }catch{return [];}
}
