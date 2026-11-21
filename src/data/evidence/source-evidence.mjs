import footprints from './glacier-evidence.json';
import {cases} from './station-cases.mjs';

const article='https://essd.copernicus.org/articles/14/683/2022/';
const paper=article+'essd-14-683-2022.pdf';
const pdfPages={
  apcc:[{number:7,label:'表 2 · 冰川采样位置',image:'apcc-7.jpg',box:[.10,.129,.80,.30]},{number:19,label:'第 5 节 · 数据入口',image:'apcc-19.jpg',box:[.10,.593,.39,.031]}],
  manaus:[{number:26,label:'表 3 · 最低水位',image:'manaus-26.jpg',box:[.143,.539,.72,.018]},{number:33,label:'站点记录说明',image:'manaus-33.jpg',box:[.14,.535,.73,.078]}]
};
const table=(label,columns,rows)=>({kind:'table',label,columns,rows});
const passage=(label,before,quote,after)=>({kind:'text',label,before,quote,after});
const publication=(url,pages)=>({kind:'pdf',label:'PDF 引用页',url,pages});

export function sourceEvidence(id,scope,subset){
  if(id==='apcc')return {title:'APCC · 第三极冰川采样证据',scope,source:'Kang 等，Earth System Science Data，2022',url:article,tabs:[
    publication(paper,pdfPages.apcc),
    table('采样位置（表 2 节选）',['冰川','经度 °E','纬度 °N'],(subset??footprints.samples).map(([name,x,y])=>[name,x,y])),
    passage('第 5 节 · 数据可用性','作者将公开数据按采样介质和测量项目分组。冰川与积雪对应其中的 I-2 子集。','glacier and snow cover BC, WIOC, and WSOC data and MAC values of WSOC (APCC dataset I-2)','可从论文的数据可用性章节核对该子集的变量与下载 DOI。')
  ]};
  if(id==='fog')return {title:'WGMS · 质量平衡观测目录',scope,source:'World Glacier Monitoring Service · FoG 观测目录',url:'https://wgms.ch/data-exploration/',tabs:[
    table('目录记录',['冰川','WGMS ID','国家','经度 °','纬度 °','列名观测者'],(subset??footprints.wgms).map(([x,y,name,code,country,observer])=>[name,code,country,x,y,observer||'未列出']))
  ]};
  if(id==='rgi6')return {title:'RGI 6.0 · 边界样本目录',scope,source:'Randolph Glacier Inventory 6.0 · OGGM 边界样本',url:'https://doi.org/10.7265/4M1F-GD79',tabs:[
    table('冰川边界记录',['冰川','RGI 标识','中心经度 °','中心纬度 °'],(subset??footprints.rgi).map(r=>[r.name,r.code,...r.center]))
  ]};
  if(id==='portal')return {title:'GLIMS · 检索入口',scope,source:'Global Land Ice Measurements from Space',url:'https://www.glims.org/maps/textsearch/',tabs:[{kind:'web',label:'网页线索',body:'该链接通向资料检索页。具体产品及其空间范围仍待核实。'}]};
  const site=cases[id];if(!site)return null;
  const tabs=[table('水位记录',['日期 / 年份','水位（米）','记录含义'],site.readings.map(r=>[r.date,r.value.replace(' 米',''),r.text]))];
  if(id==='manaus')tabs.unshift(publication(site.url,pdfPages.manaus));
  tabs.push(id==='manaus'?passage('年报 · 马瑙斯港站','该段汇报内格罗河马瑙斯港站的最低水位与出现日期。','registrou a mínima histórica de 12,11 m em 02/11/24','后文与 2023 年低水位比较；两年相差 59 厘米。'):passage('湖南省水利厅 · 年报发布说明','该段先给出城陵矶站年最高水位及其相应水面面积，再给出当年的最低值。','全年最低水位为19.12米（11月12日）','同一段记载相应水面面积为 311 平方公里。'));
  return {title:site.site+' · 水位依据',scope,source:site.source,url:site.url,tabs};
}
