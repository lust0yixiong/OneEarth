import {useId,useLayoutEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {X} from "lucide-react";
import {clarificationAnswerText,type ClarificationAnswer,type ClarificationKind,type ClarificationPrompt} from "../domain/clarification";
import "../styles/clarification-dialog.css";

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

export function ClarificationDialog({sessionId,parentTaskId,prompt,seed,close,submit,restoreFocus}:{
  sessionId:string;
  parentTaskId:string;
  prompt:ClarificationPrompt;
  seed?:Draft;
  close:()=>void;
  submit:(answer:ClarificationAnswer)=>boolean;
  restoreFocus:()=>void;
}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const initialFocus=useRef<HTMLElement|null>(null);
  const questionId=useId(), helpId=useId();
  const key="oneearth.clarification-draft.v1."+sessionId+"."+parentTaskId;
  const [draft,setDraft]=useState(()=>readDraft(key,prompt,seed));
  const [error,setError]=useState("");
  const options=prompt.options || [];
  const confirming=prompt.kind==="confirmation";
  const text=draft.text?.trim();
  const conflict=confirming && !!draft.optionId && !!text;
  const answer:ClarificationAnswer={parentTaskId,
    ...(draft.optionId ? {optionId:draft.optionId} : {}),
    ...(text ? {text} : {}),
  };
  const ready=!!clarificationAnswerText(prompt,answer);
  const fallbackFocus=useRef(restoreFocus);
  fallbackFocus.current=restoreFocus;

  useLayoutEffect(()=>{
    const element=dialog.current;
    if (!element) return;
    const previous=document.activeElement;
    element.showModal();
    initialFocus.current?.focus({preventScroll:true});
    return ()=>{
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected && previous!==document.body)
        previous.focus({preventScroll:true});
      else fallbackFocus.current();
    };
  },[]);

  function change(draft:Draft) {
    setDraft(draft);
    setError("");
    saveDraft(key,draft);
  }

  function postpone() {
    if (draft.optionId || draft.text) saveDraft(key,draft);
    close();
  }

  return createPortal(<dialog className="oe-clarification-dialog" ref={dialog}
    aria-labelledby={questionId} aria-describedby={helpId}
    onCancel={event=>{event.preventDefault();postpone();}}>
    <form onSubmit={event=>{
      event.preventDefault();
      if (!ready) return;
      if (submit(answer)) {
        saveDraft(key);
        close();
      } else setError("此问题暂时无法回复。请回到原消息查看它的状态。");
    }}>
      <header>
        <span>{kindLabel[prompt.kind]}</span>
        <button type="button" aria-label="关闭追问" onClick={postpone}><X size={19}/></button>
        <h2 id={questionId}>{prompt.question}</h2>
      </header>
      {options.length>0 && <fieldset>
        <legend className="oe-clarification-sr-only">{confirming?"请选择是否执行":"请选择一个选项"}</legend>
        {options.map((option,index)=><label className="oe-clarification-option" key={option.id}>
          <input type="radio" name="clarification-option" value={option.id} checked={draft.optionId===option.id}
            ref={index===0 ? element=>{initialFocus.current=element;} : undefined}
            onChange={()=>change({...draft,optionId:option.id})}/>
          <span>{option.label}</span>
        </label>)}
        {draft.optionId && <button type="button" className="oe-clarification-clear"
          onClick={()=>change({...draft,optionId:undefined})}>取消选择</button>}
      </fieldset>}
      <label className="oe-clarification-text">
        <span>{confirming?"补充条件":options.length?"补充说明":"你的回复"}</span>
        <textarea rows={3} maxLength={4000} value={draft.text || ""}
          ref={!options.length ? element=>{initialFocus.current=element;} : undefined}
          onChange={event=>change({...draft,text:event.target.value})}/>
      </label>
      <p id={helpId} className="oe-clarification-help">{confirming?"可以选择是否执行，也可以只补充条件。"
        :options.length?"可以选择一项、填写说明，或两者一起提交。":"填写后提交回复。"}</p>
      {conflict && <p className="oe-clarification-error" role="status">提交前请取消选择，或清空补充条件。</p>}
      {!conflict && text && !ready && <p className="oe-clarification-error" role="status">请缩短回复后再提交。</p>}
      {error && <p className="oe-clarification-error" role="alert">{error}</p>}
      <footer>
        <button type="button" onClick={postpone}>稍后回答</button>
        <button type="submit" disabled={!ready}>提交回复</button>
      </footer>
    </form>
  </dialog>,document.body);
}
