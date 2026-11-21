import {useState} from "react";
import type {QuestionCheck as Check,QuestionDecision} from "../domain/types";
import "../styles/question-check.css";

export function QuestionCheck({check,pending,closed,onChoose}:{
  check:Check;pending:boolean;closed?:QuestionDecision|"superseded";
  onChoose:(choice:QuestionDecision["choice"],edited?:string)=>void;
}){
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState(check.proposedQuestion);
  return <section className="question-check" aria-label="确认问题理解">
    <p>你是想问这个数据问题吗？</p>
    <blockquote>{check.proposedQuestion}</blockquote>
    <details><summary>查看原问题</summary><p>{check.originalQuestion}</p></details>
    {closed?<small role="status">{closed==="superseded"?"已继续新的问题":closed.choice==="original"?"已按原问题继续":"已按确认的问题继续"}</small>:<>
      {editing && <form onSubmit={event=>{event.preventDefault();if(draft.trim())onChoose("edited",draft);}}>
        <label>我想问的是<textarea autoFocus aria-label="修改数据问题" rows={3} value={draft} maxLength={4000}
          onChange={event=>setDraft(event.target.value)} disabled={pending}/></label>
        <div className="question-check-actions">
          <button type="submit" disabled={pending || !draft.trim()} className="question-check-primary">确认修改并继续</button>
          <button type="button" disabled={pending} onClick={()=>setEditing(false)}>取消修改</button>
        </div>
      </form>}
      {!editing && <div className="question-check-actions">
        <button disabled={pending} className="question-check-primary" onClick={()=>onChoose("proposed")}>按这个理解继续</button>
        <button disabled={pending} onClick={()=>setEditing(true)}>修改后继续</button>
      </div>}
      <button className="question-check-original" disabled={pending} onClick={()=>onChoose("original")}>按原问题继续</button>
    </>}
  </section>;
}
