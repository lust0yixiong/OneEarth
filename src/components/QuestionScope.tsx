import {CalendarRange,Database,Hexagon,Quote,X} from "lucide-react";
import {scopeDetail,scopeKey,scopeLabel,type ScopeItem} from "../domain/question-scope";

export function QuestionScope({items,remove}:{items:ScopeItem[];remove?:(key:string)=>void}){
  if(!items.length)return null;
  return <div className="question-scope" role="group" aria-label={remove?"本轮提问引用":"提问时引用"}>
    {items.map(item=>{
      const Icon=item.kind==="grid"?Hexagon:item.kind==="time"?CalendarRange:item.kind==="reference"?Quote:Database;
      const label=scopeLabel(item),key=scopeKey(item);
      return <div className="scope-chip" key={key}>
        <details><summary title={label}><Icon size={13}/><span>{label}</span></summary>
          <small title={item.kind==="grid" ? item.coverageScope?.summary?.candidateIdentity ?? undefined : undefined}>{scopeDetail(item)}</small>
        </details>
        {remove && <button type="button" aria-label={"移除"+label} onClick={()=>remove(key)}><X size={13}/></button>}
      </div>;
    })}
  </div>;
}
