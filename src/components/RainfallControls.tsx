import {useEffect} from "react";
import {Pause,Play} from "lucide-react";
import type {XY} from "../domain/regional-cases";
import {rainBreaks,rainCell,rainGrid,rainColor,rainColors,rainFactors} from "../domain/rainfall";
import type {RainTiles} from "../globe/rain-tiles";
import {publishedRainPeriod} from "../domain/rain-catalog";
import {globeCases} from "../domain/regional-cases";
import {rainCoverageLabel} from "./use-rain-catalog";
import "../styles/rainfall.css";

type Props={
  grid:RainTiles;month:number;playing:boolean;point?:XY;
  choose:(month:number)=>void;chooseYear:(year:number,month:number)=>void;toggle:()=>void;
};
const fmt=(n:number)=>n.toLocaleString("zh-CN",{maximumFractionDigits:2});
const latName=(lat:number)=>fmt(Math.abs(lat))+"°"+(lat>0?"N":lat<0?"S":"");
export function RainfallControls({grid,month,playing,point,choose,chooseYear,toggle}:Props){
  useEffect(()=>{grid.select(point);return ()=>grid.select(undefined);},[grid,point?.[0],point?.[1]]);
  const {year,months,bands}=grid.manifest;
  const current=months[month],source=current?.source;
  const values=point?grid.series(point):null;
  const peak=values?.reduce<number>((found,v,i)=>typeof v==="number" && (found===-1 || v>values[found]!)?i:found,-1)??-1;
  const cell=point && rainCell(point),centerLon=cell?cell.west+rainGrid.step/2:0;
  const high=peak>=0?values![peak]!:0;
  const describe=(m:number,value:number|null|undefined)=>!months[m]?"暂无数据":value===undefined?"载入中":value===null?"此格缺测":fmt(value)+" mm/天";
  function changeYear(year:number){
    const period=publishedRainPeriod(grid.catalog,year,month);
    if(period)chooseYear(period.year,period.frame);
  }
  return <section className="rain-panel" aria-label="全球降水">
    <div className="rain-head">
      <div><small>GPM IMERG {source?(source.run==="Derived"?"· NASA "+source.version:source.run+" · "+source.version):""} · 0.1°</small><h2>{globeCases.rain.title}</h2>
        <small>{rainCoverageLabel({status:"ready",catalog:grid.catalog})}</small></div>
      <button aria-label={playing?"暂停图层":"播放图层"} onClick={toggle}>{playing?<Pause size={15}/>:<Play size={15}/>} {month+1} 月</button>
    </div>
    <div className="rain-band-title">
      <label className="rain-year">年份 <select aria-label="降水年份" value={year} onChange={event=>changeYear(+event.target.value)}>
        {[...grid.catalog.years].reverse().map(entry=><option key={entry.year} value={entry.year}>
          {entry.year} 年{entry.months.length<12?" · "+entry.months.length+" 个月":""}
        </option>)}
      </select></label>
      <small>月平均日降水量 · mm/天</small>
    </div>
    <div className="rain-chart">
      <div className="rain-lat"><span>90°N</span><span>赤道</span><span>90°S</span></div>
      <div className="rain-months">{bands.map((column,m)=><button key={m} disabled={!months[m]} aria-label={months[m]?`查看 ${m+1} 月降水`:`${m+1} 月暂无数据`} aria-pressed={m===month} onClick={()=>choose(m)}>
        <span className="rain-column">{column.map((v,i)=><i key={i}
          title={months[m]?latName(90-i*10)+" 至 "+latName(80-i*10)+" · "+(v===null?"缺测":fmt(v)+" mm/天")+" · "+(months[m]!.source.run==="Derived"?"NASA POWER":"IMERG "+months[m]!.source.run):year+" 年 "+(m+1)+" 月暂无数据"}
          style={{backgroundColor:v===null?"#e5e6e4":rainColor(v)}}/>)}</span>
        <small>{m+1}</small>
      </button>)}</div>
    </div>
    <div className="rain-legend"><span>月平均日降水量</span>{rainBreaks.map((v,i)=><span key={v}><i style={{background:rainColors[i]}}/>{i===4?"15+":v}</span>)}<span><i style={{background:"#e5e6e4"}}/>缺测</span></div>
    {cell && values?<div className="rain-location">
      <strong>格心 {Math.abs(centerLon).toFixed(2)}°{centerLon<0?"W":"E"} {latName(cell.north-rainGrid.step/2)}</strong>
      <output aria-label="图层取值">{year} 年 {month+1} 月 · {describe(month,values[month])}</output>
      {peak>=0 && <>
        <div className="rain-series" aria-label="所选格点各月降水">{values.map((v,m)=><button key={m} disabled={!months[m]}
          aria-label={`${m+1} 月 · ${describe(m,v)}`} aria-pressed={m===month} onClick={()=>choose(m)}>
          <i style={{height:v==null?1:Math.max(2,25*v/(high||1)),background:v==null?"#ddd":rainColor(v)}}/>
        </button>)}</div>
        <small>{values.some((v,m)=>!!months[m] && v===undefined)?"已载入月份最高":months.some(m=>!m || !m.complete)?"已发布月份最高":"全年最高月均值"} · {peak+1} 月 {fmt(high)} mm/天</small>
      </>}
    </div>:<small className="rain-hint">点选月份切换地图，点选海陆格点查看该年降水。</small>}
    {current && !current.complete && <small className="rain-period">截至 {current.through} · 月内已观测数据</small>}
    {source?.run==="Late" && <small className="rain-period">本月采用 IMERG Late 近实时处理结果。</small>}
    {source?.run==="Derived" && <small className="rain-period">NASA POWER 派生月值{source.status==="reviewing"?" · 预览数据":""}</small>}
    <small className="rain-status" role="status">显示 {rainFactors[grid.level]*rainGrid.step}°{grid.loading?" · 细节载入中…":""}
      {grid.error && <button onClick={()=>grid.retry()}>部分数据载入失败 · 重试</button>}
    </small>
    <details><summary>数据与方法</summary>
      <p>NASA GPM IMERG，全球海陆 0.1° 网格。按月份标明 Final、Late 或 NASA POWER 派生月值及版本，统一为月平均日降水量，保留至 0.01 mm/天。概览与纬度图按有效格面积加权，源文件中的缺测留空；点选始终读取该年月的 0.1° 数值。</p>
      {source?.run==="Derived" && <p>本月直接读取 NASA POWER 发布的 IMERG_PRECTOT 月平均场，未经空间插值。该派生产品的时间汇总与 Final 月产品不同，提供方标记为 reviewing，当前用于可视化预览。</p>}
      <a href="https://gpm.nasa.gov/data/imerg" target="_blank" rel="noreferrer">NASA 产品说明 ↗</a>
      {source && <> · <a href={source.url} target="_blank" rel="noreferrer">{year} 年 {month+1} 月数据来源 ↗</a></>}
    </details>
  </section>;
}
