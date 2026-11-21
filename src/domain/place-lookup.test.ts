import test from "node:test";
import assert from "node:assert/strict";
import {navigationTarget,parseCoordinates,rankPhoton,photonCamera,photonLookup,wikipediaLookup,placeVariants,canonicalPlaceNames} from "../../server/place-lookup";

test("only explicit map-move commands become place lookups",()=>{
 for(const [query,place] of [
  ["定位到杭州市","杭州市"],
  ["请求把地图定位到杭州","杭州"],
  ["飞到杭州市","杭州市"],
  ["导航到上海","上海"],
  ["在球上定位到浙江省","浙江省"],
  ["带我去莫干山","莫干山"],
  ["fly to Hangzhou","Hangzhou"],
 ])assert.equal(navigationTarget(query)?.place,place,query);
 for(const query of ["定位到杭州的数据","飞到杭州能看到哪些数据？","杭州有哪些数据","为什么飞到杭州要这么久","帮我找杭州的影像","定位到那边","把地图定位到杭州后帮我分析森林","飞到杭州，然后查看数据","你好"])
  assert.equal(navigationTarget(query),null,query);
});

test("decimal, labeled and DMS coordinates parse without guessing provenance",()=>{
 const cases:[string,[number,number]][] = [
  ["120.2E, 30.3N",[120.2,30.3]],
  ["30.3N 120.2E",[120.2,30.3]],
  ["北纬30.3 东经120.2",[120.2,30.3]],
  ["南纬 33.9 东经 18.4",[18.4,-33.9]],
  ["120.2,30.3",[120.2,30.3]],
  ["30.3,120.2",[120.2,30.3]],
  ["30°18′N 120°09′E",[120.15,30.3]],
  ["N30.3 E120.2",[120.2,30.3]],
  ["（120.2E, 30.3N）",[120.2,30.3]],
 ];
 for(const [text,center] of cases){
  const parsed=parseCoordinates(text);
  assert.ok(parsed,text);
  assert.ok(Math.abs(parsed!.center[0]-center[0])<1e-6,text);
  assert.ok(Math.abs(parsed!.center[1]-center[1])<1e-6,text);
 }
 const southern=parseCoordinates("33.9S 18.4E");
 assert.equal(southern?.label,"南纬 33.90°，东经 18.40°");
 assert.equal(parseCoordinates("1998年长江口光学卫星影像"),null);
 assert.equal(parseCoordinates("30.3N"),null);
 const zoomed=parseCoordinates("120.2E 30.3N zoom 8");
 assert.equal(zoomed?.zoom,8);
});

test("an exact feature name outranks a longer feature that contains it",()=>{
 const features=[
  {properties:{name:"杭州市中医院",type:"house"},geometry:{coordinates:[120.1496944,30.271813]}},
  {properties:{name:"杭州市",type:"city",state:"浙江省",country:"中国",extent:[118.3396948,30.5648514,120.7254851,29.1888286]},geometry:{coordinates:[120.2052342,30.2489634]}},
 ];
 assert.equal(rankPhoton(features,"杭州市"),1);
 const camera=photonCamera(features[1])!;
 assert.deepEqual(camera.center,[120.2052342,30.2489634]);
 assert.ok(camera.zoom>=45&&camera.zoom<=120,"city zoom should frame the urban area, got "+camera.zoom);
 const poi=photonCamera(features[0])!;
 assert.ok(poi.zoom>=600,"a small POI should zoom in, got "+poi.zoom);
});

test("the online lookup caches results and tolerates unreachable services",async()=>{
 const calls:string[]=[];
 const fetcher=async(url:string)=>{calls.push(url);return {features:[
  {properties:{name:"杭州东站",type:"house",state:"浙江省",country:"中国"},geometry:{coordinates:[120.213,30.291]}},
 ]};};
 const hit=await photonLookup("杭州东站",new AbortController().signal,fetcher);
 assert.equal(hit?.label,"杭州东站");
 assert.equal(hit?.detail,"浙江省 · 中国");
 const cached=await photonLookup("杭州东站",new AbortController().signal,fetcher);
 assert.equal(cached?.label,"杭州东站");
 assert.equal(calls.length,1,"second lookup must use the cache");
 const failure=await photonLookup("不存在的地方",new AbortController().signal,async()=>{throw Error("network down")}).then(()=>null,error=>error as Error);
 assert.ok(failure);
 assert.match(failure.message,/network down/);
});

test("basin and shorthand suffixes expose a resolvable core name",()=>{
 assert.deepEqual(placeVariants("雅江流域"),["雅江流域","雅江"]);
 assert.deepEqual(placeVariants("大兴安岭地区"),["大兴安岭地区","大兴安岭"]);
 assert.deepEqual(placeVariants("长江下游"),["长江下游","长江"]);
 assert.deepEqual(placeVariants("杭州市"),["杭州市"]);
});

test("the encyclopedia resolves basin names and shorthands that OSM lacks",async()=>{
 const asked:string[]=[];
 const fetcher=async(url:string)=>{
  asked.push(url);
  if(url.includes("zh.wikipedia.org"))return {query:{pages:{
   "1":{title:"雅砻江",index:1,coordinates:[{lat:29.9077755,lon:99.992514}],pageprops:{wikibase_item:"Q876857"}},
   "2":{title:"汉江 (中国)",index:2,pageprops:{wikibase_item:"Q875573"}},
  }}};
  if(url.includes("wikidata.org"))return {entities:{Q135416141:{claims:{P625:[{mainsnak:{datavalue:{value:{latitude:29.5,longitude:94.83}}}}]}}}};
  throw Error("unexpected url "+url);
 };
 const hit=await wikipediaLookup("雅江流域",new AbortController().signal,fetcher);
 assert.equal(hit?.label,"雅砻江");
 assert.equal(hit?.source,"wikipedia");
 assert.ok(hit!.zoom>=4&&hit!.zoom<=30);
 assert.ok(asked[0].includes("gsrsearch="));
 const shorthand=await wikipediaLookup("雅下",new AbortController().signal,async(url:string)=>{
  if(url.includes("zh.wikipedia.org"))return {query:{pages:{
   "9":{title:"雅鲁藏布江下游水电工程",index:1,pageprops:{wikibase_item:"Q135416141"}},
  }}};
  return {entities:{Q135416141:{claims:{P625:[{mainsnak:{datavalue:{value:{latitude:29.5,longitude:94.83}}}}]}}}};
 });
 assert.equal(shorthand?.label,"雅鲁藏布江下游水电工程");
 assert.deepEqual(shorthand?.center,[94.83,29.5]);
});

test("the model only standardizes a fuzzy name and empty answers stay empty",async()=>{
 const names=await canonicalPlaceNames("雅下",async()=>JSON.stringify({candidates:["雅鲁藏布江下游水电工程","墨脱县"],note:"简称"}));
 assert.deepEqual(names,["雅鲁藏布江下游水电工程","墨脱县"]);
 const none=await canonicalPlaceNames("不存在的地方",async()=>JSON.stringify({candidates:[],note:"无法确定"}));
 assert.deepEqual(none,[]);
 const failed=await canonicalPlaceNames("坏掉的模型",async()=>{throw Error("429");});
 assert.deepEqual(failed,[]);
});

test("a merely similar OSM feature is marked weak instead of being flown to",async()=>{
 const reservoir=await photonLookup("长江口",new AbortController().signal,async()=>({features:[
  {properties:{name:"长江口水库",type:"other",state:"广西壮族自治区",country:"中国"},geometry:{coordinates:[110.121,25.107]}},
 ]}));
 assert.equal(reservoir?.label,"长江口水库");
 assert.equal(reservoir?.weak,true);
 const county=await photonLookup("雅江县",new AbortController().signal,async()=>({features:[
  {properties:{name:"雅江县 ཉག་ཆུ།",type:"city",state:"四川省",country:"中国"},geometry:{coordinates:[101.013,30.035]}},
 ]}));
 assert.equal(county?.label,"雅江县");
 assert.equal(county?.weak,false);
});
