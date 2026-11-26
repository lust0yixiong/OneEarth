import {useState} from "react";
import type {QuestionCheck as Check,QuestionDecision} from "../domain/types";
import "../styles/question-check.css";

const closedLabels = {
  readonly:"历史记录 · 仅供查看",
  resolved:"已继续此问题",
  cancelled:"已放弃问题确认",
  unavailable:"此问题确认已不可用",
} as const;

export function QuestionCheck({check,pending,closed,terminal,onChoose}:{
  check:Check;pending:boolean;closed?:QuestionDecision|keyof typeof closedLabels;
  terminal?:"failed"|"cancelled";
  onChoose:(choice:QuestionDecision["choice"]|"abandon",edited?:string)=>Promise<boolean>;
}){
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState(check.proposedQuestion);
  const [submitting,setSubmitting]=useState(false);
  const [error,setError]=useState(false);
  const disabled=pending || submitting;
  async function choose(choice:QuestionDecision["choice"]|"abandon",edited?:string){
    if(disabled)return;
    setSubmitting(true);
    setError(false);
    try{setError(!await onChoose(choice,edited));}
    finally{setSubmitting(false);}
  }
  return <section className="question-check" aria-label="确认问题理解">
    <p>你是想问这个数据问题吗？</p>
    <blockquote>{check.proposedQuestion}</blockquote>
    <details><summary>查看原问题</summary><p>{check.originalQuestion}</p></details>
    {closed?<small role="status">
      {typeof closed==="string" ? closedLabels[closed] : closed.choice==="original" ? "已按原问题继续" : "已按确认的问题继续"}
      {terminal && (terminal==="failed" ? " · 续答失败" : " · 续答已取消")}
    </small>:<>
      {editing && <form onSubmit={event=>{event.preventDefault();if(draft.trim())void choose("edited",draft);}}>
        <label>我想问的是<textarea autoFocus aria-label="修改数据问题" rows={3} value={draft} maxLength={4000}
          onChange={event=>setDraft(event.target.value)} disabled={disabled}/></label>
        <div className="question-check-actions">
          <button type="submit" disabled={disabled || !draft.trim()} className="question-check-primary">确认修改并继续</button>
          <button type="button" disabled={disabled} onClick={()=>setEditing(false)}>取消修改</button>
        </div>
      </form>}
      {!editing && <div className="question-check-actions">
        <button disabled={disabled} className="question-check-primary" onClick={()=>void choose("proposed")}>按这个理解继续</button>
        <button disabled={disabled} onClick={()=>setEditing(true)}>修改后继续</button>
      </div>}
      <button className="question-check-original" disabled={disabled} onClick={()=>void choose("original")}>按原问题继续</button>
      <button className="question-check-original" disabled={disabled} onClick={()=>void choose("abandon")}>放弃确认</button>
      {error && <small role="alert">暂时无法确认这次选择，请查看原问题状态。</small>}
    </>}
  </section>;
}
