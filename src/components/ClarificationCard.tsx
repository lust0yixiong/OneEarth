import {useId,useLayoutEffect,useRef,useState} from "react";
import {Check, Pencil} from "lucide-react";
import {clarificationAnswerText,type ClarificationAnswer,type ClarificationKind,type ClarificationPrompt} from "../domain/clarification";
import "../styles/clarification-card.css";

const kindLabel:Record<ClarificationKind,string>={
  chat:"补充信息",
  confirmation:"确认操作",
  research:"补充研究信息",
};
type Draft = Pick<ClarificationAnswer,"optionId"|"text">;
const drafts=new Map<string,Draft>();

function readDraft(key:string,prompt:ClarificationPrompt,seed?:Draft):Draft {
  let draft=seed ?? drafts.get(key);
  if (!draft) {
    try { draft=JSON.parse(sessionStorage.getItem(key) || "null") ?? undefined; }
    catch { /* Drafts remain available in this tab when storage is unavailable. */ }
  }
  return {
    optionId:prompt.options?.find(option=>option.id===draft?.optionId)?.id,
    text:typeof draft?.text==="string" ? draft.text.slice(0,4000) : "",
  };
}

function saveDraft(key:string,draft?:Draft) {
  if (draft) drafts.set(key,draft);
  else drafts.delete(key);
  try {
    if (draft) sessionStorage.setItem(key,JSON.stringify(draft));
    else sessionStorage.removeItem(key);
  } catch { /* The in-memory draft still supports closing and reopening. */ }
}

export function ClarificationCard({id,sessionId,parentTaskId,prompt,seed,focusOnOpen,close,submit,openOrigin}:{
  id:string;
  sessionId:string;
  parentTaskId:string;
  prompt:ClarificationPrompt;
  seed?:Draft;
  focusOnOpen:boolean;
  close:()=>void;
  submit:(answer:ClarificationAnswer)=>Promise<boolean>;
  openOrigin?:()=>void;
}) {
  const questionId=useId();
  const firstInput=useRef<HTMLElement|null>(null);
  const key="oneearth.clarification-draft.v1."+sessionId+"."+parentTaskId;
  const [draft,setDraft]=useState(()=>readDraft(key,prompt,seed));
  const [error,setError]=useState("");
  const [submitting,setSubmitting]=useState(false);
  const submittingRef=useRef(false);
  const options=prompt.options || [];
  const confirming=prompt.kind==="confirmation";
  const text=draft.text?.trim();
  const answer:ClarificationAnswer={parentTaskId,
    ...(draft.optionId ? {optionId:draft.optionId} : {}),
    ...(text ? {text} : {}),
  };
  const ready=!!clarificationAnswerText(prompt,answer);

  useLayoutEffect(()=>{
    if(focusOnOpen)firstInput.current?.focus({preventScroll:true});
  },[focusOnOpen]);

  function change(draft:Draft) {
    setDraft(draft);
    setError("");
    saveDraft(key,draft);
  }

  return <section id={id} className="oe-clarification-card" aria-labelledby={questionId}
    onKeyDown={event=>{
      if(event.key==="Escape" && !event.nativeEvent.isComposing){
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    }}>
    <form onSubmit={async event=>{
      event.preventDefault();
      if (!ready || submittingRef.current) return;
      submittingRef.current=true;
      setSubmitting(true);
      try {
        if(await submit(answer))saveDraft(key);
        else setError("此问题暂时无法回复，请回到原消息查看状态。");
      }finally{
        submittingRef.current=false;
        setSubmitting(false);
      }
    }}>
      <div className="oe-clarification-body">
        <header>
          <div className="oe-clarification-meta">
            <span>{kindLabel[prompt.kind]}</span>
            {openOrigin && <button type="button" onClick={openOrigin}>查看原问题</button>}
          </div>
          <h2 id={questionId}>{prompt.question}</h2>
        </header>
        {!!options.length && <div role="group" aria-label={confirming?"确认选项":"答复选项"} className="oe-clarification-options">
          {options.map((option,index)=>{
            const selected=draft.optionId===option.id;
            return <button type="button" key={option.id} aria-pressed={selected}
              ref={index===0 ? element=>{firstInput.current=element;} : undefined}
              className="oe-clarification-option"
              onClick={()=>change({optionId:selected?undefined:option.id,text:confirming && !selected?"":draft.text})}>
              <span className="oe-clarification-choice-mark" aria-hidden="true">{selected?<Check size={14}/>:index+1}</span>
              <span>{option.label}</span>
            </button>;
          })}
        </div>}
        <label className="oe-clarification-text">
          <Pencil size={15} aria-hidden="true"/>
          <span className="oe-clarification-sr-only">{confirming?"补充条件":"你的回复"}</span>
          <textarea rows={1} maxLength={4000} value={draft.text || ""}
            placeholder={confirming?"也可以补充条件…":options.length?(draft.optionId?"补充说明（可选）…":"也可以自己填写…"):"填写回复…"}
            ref={!options.length ? element=>{firstInput.current=element;} : undefined}
            onChange={event=>change({optionId:confirming?undefined:draft.optionId,text:event.target.value})}/>
        </label>
        {text && !ready && <p className="oe-clarification-error" role="status">请缩短回复后再提交。</p>}
        {error && <p className="oe-clarification-error" role="alert">{error}</p>}
      </div>
      <footer>
        <button type="button" onClick={close}>稍后回答</button>
        <button type="submit" disabled={!ready || submitting}>提交回复</button>
      </footer>
    </form>
  </section>;
}
