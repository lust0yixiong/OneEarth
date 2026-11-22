import {useMemo} from "react";
import {MapPin,LocateFixed} from "lucide-react";
import {useWorkspace} from "../domain/store";
import {answerEvidence,evidenceCamera,evidenceAction,coverageTimeNote,type MappedEvidence} from "../domain/answer-map";
import type {Message} from "../domain/types";
export function AnswerMapContext({message,locations:savedLocations,cellCount,loading,error,showCellRelation=true}:{message:Message;locations:Map<string,MappedEvidence>;cellCount:number;loading:boolean;error:string;showCellRelation?:boolean}) {
  const {state:s,activateAnswer,flyToGrid,flyToEvidence,patch}=useWorkspace();
  const currentBatch=useMemo(()=>s.mapResult?{...s.mapResult,filters:s.filters,layer:s.layer}:null,[s.mapResult,s.filters,s.layer]);
  const active=s.mapResult?.answerId===message.id;
  const locations=useMemo(()=>active && currentBatch?answerEvidence(currentBatch):savedLocations,[active,currentBatch,savedLocations]);
  if(!message.candidates)return null;
  const local=[...locations.values()].filter(e=>e.kind==="local").length;
  const range=[...locations.values()].filter(e=>e.kind==="range").length;
  const global=[...locations.values()].filter(e=>e.kind==="global").length;
  const unlocated=[...locations.values()].filter(e=>e.kind==="unlocated").length;
  const mapped=local+range+global;
  const unverified=[...locations.values()].filter(e=>e.coverageTime==="unverified").length;
  const outside=[...locations.values()].filter(e=>e.coverageTime==="outside").length;
  const focusTarget=active && currentBatch && s.mapFocus?evidenceCamera(currentBatch,s.mapFocus.assetId,s.gridSystem):null;
  const focusEvidence=s.mapFocus?locations.get(s.mapFocus.assetId):undefined;
  const focusKind=focusEvidence?.kind;
  return <div className={"answer-map-context"+(active?" active":"")} data-answer-map={message.id}>
    <div><MapPin size={14}/><span>{active?(mapped?"本轮结果已显示在球上":locations.size?"本轮资料位置待核":"正在核对资料位置"):"本轮结果"}</span>
      <button onClick={()=>activateAnswer(message,!active,true)}>{active?(mapped?"重新显示":"查看关联资料"):"在球上查看"}</button>
      {(!!local || !!range || !!global) && <button onClick={()=>activateAnswer(message,true,true)} title="定位本轮数据位置"><LocateFixed size={13}/>定位范围</button>}
      {message.candidates.selection && <button onClick={()=>{if(!active)activateAnswer(message,false,true);flyToGrid(message.candidates!.selection!);}}>定位原网格</button>}
    </div>
    <small>{locations.size?[local?local+" 项数据位置":"",range?range+" 项目录范围":"",global?global+" 项全球覆盖":"",unlocated?unlocated+" 项位置待核":""].filter(Boolean).join(" · ") || "本轮资料的数据位置待核":"正在读取资料的空间范围…"}。{local || range ? "球上编号对应正文引用。" : global ? "全球覆盖资料以球体外圈标示。" : ""}</small>
    {(!!unverified || !!outside) && <p className="answer-location-note" role="status">{[unverified?unverified+" 项官方覆盖时段未核":"",outside?outside+" 项官方覆盖时段与当前时段不匹配":""].filter(Boolean).join("；")}。官方位置或空间范围仍可查看，不代表当前时段有观测，亦不计为格内实测。</p>}
    {showCellRelation && active && s.selection && s.mapResult?.metric!=="scenes" && <p className="answer-cell-relation" role="status">{error?error:loading?"正在核对所选网格与本轮资料…":"所选网格关联 "+cellCount+" 项本轮资料，已标记对应引用"}</p>}
    {active && focusKind==="unlocated" && <p className="answer-location-note" role="status">这份资料尚无已核实的坐标或覆盖范围，暂不能定位。</p>}
    {active && coverageTimeNote(focusEvidence) && <p className="answer-location-note" role="status">{coverageTimeNote(focusEvidence)}</p>}
    {focusTarget && s.mapFocus?.locked && <button onClick={()=>flyToEvidence(message,s.mapFocus!.assetId)}><LocateFixed size={13}/>{evidenceAction(focusEvidence)}</button>}
    {active && s.mapFocus?.locked && <button className="answer-focus-clear" onClick={()=>patch({mapFocus:null})}>取消资料高亮</button>}
  </div>;
}
