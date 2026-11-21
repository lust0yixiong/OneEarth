// Initial resolution is a camera decision. The cells used for counting are
// still computed independently from the evidence at each H3 resolution.
import {geoBounds,geoDistance} from 'd3-geo';
import {zoomBands} from './globe-navigation.mjs';

const innerRadius=.80;
export function initialGrid(points,{maxLevel=7,overview=[52,52]}={}){
  if(!points.length)return null;
  const [[west,south],[east,north]]=geoBounds({type:'MultiPoint',coordinates:points});
  const span=(east-west+360)%360;
  const center=[(west+span/2+540)%360-180,(south+north)/2];
  const radius=points.reduce((max,p)=>Math.max(max,geoDistance(center,p)),0);
  const km=Math.ceil(radius*6371);
  for(let level=maxLevel;level>=2;level--){
    if(radius<Math.PI/2&&zoomBands[level-2]*Math.sin(radius)<=innerRadius){
      return {level,center,z:zoomBands[level-2],km,
        why:'最远证据距视图中心约 '+km.toLocaleString()+' km；R'+level+
          (level===maxLevel?' 已达到本次显示上限。':' 是保留显示边距后能容纳全部定位证据的最细档。')};
    }
  }
  return {level:2,center:overview,z:1,km,why:'定位证据分布跨度大，采用全球总览；转动地球可查看另一侧。'};
}
