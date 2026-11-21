import {useEffect,useRef,useState} from "react";
import {ArrowUp,ArrowDown,ChevronDown,MessageCircle,Plus,Trash2} from "lucide-react";
import {maxHomeQuestions,maxHomeQuestionLength,type ChatHomeConfig} from "../domain/chat-home";
import {reloadChatHome,saveChatHome,useChatHome} from "./use-chat-home";
import "../styles/chat-home-settings.css";

export function ChatHomeSettings(){
  const {config,loading,error:loadError}=useChatHome();
  const [base,setBase]=useState<ChatHomeConfig|null>(config),[draft,setDraft]=useState<string[]>(config?.questions || []);
  const [saving,setSaving]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const fields=useRef<(HTMLTextAreaElement|null)[]>([]);
  const dirty=!!base && JSON.stringify(draft)!==JSON.stringify(base.questions);
  useEffect(()=>{if(config && !dirty){setBase(config);setDraft(config.questions);}},[config,dirty]);
  function change(next:string[]){setDraft(next);setError("");setNotice("");}
  function move(index:number,delta:number){
    const next=[...draft];[next[index],next[index+delta]]=[next[index+delta],next[index]];change(next);
    requestAnimationFrame(()=>fields.current[index+delta]?.focus());
  }
  return <section aria-labelledby="chat-home-heading" className="chat-home-settings">
    <h2 id="chat-home-heading"><MessageCircle size={19}/>Chat 首页</h2>
    <details><summary>配置首页问题<span>{config?config.questions.length+" 个问题":""}</span><ChevronDown size={15}/></summary>
      <p className="chat-home-help">设置空白对话中展示的问题。保存后对当前部署的所有访问者生效。</p>
      {loadError && <p role="alert">{loadError} <button type="button" onClick={()=>void reloadChatHome()}>重新读取</button></p>}
      {loading && !config && <p role="status">正在读取首页问题…</p>}
      <form onSubmit={async e=>{
        e.preventDefault();if(!base || saving)return;
        setSaving(true);setError("");setNotice("");
        try{const saved=await saveChatHome(draft,base.revision);setBase(saved);setDraft(saved.questions);setNotice("首页问题已保存。");}
        catch(err){setError(err instanceof Error?err.message:"保存失败，请重试。");}
        finally{setSaving(false);}
      }}>
        <fieldset disabled={saving || !base}>
          <ol>{draft.map((question,index)=><li key={index}>
            <div className="chat-home-question-tools"><label htmlFor={"home-question-"+index}>问题 {index+1}</label><div>
              <button type="button" aria-label={"上移问题 "+(index+1)} title="上移" disabled={index===0} onClick={()=>move(index,-1)}><ArrowUp size={14}/></button>
              <button type="button" aria-label={"下移问题 "+(index+1)} title="下移" disabled={index===draft.length-1} onClick={()=>move(index,1)}><ArrowDown size={14}/></button>
              <button type="button" aria-label={"删除问题 "+(index+1)} title="删除" onClick={()=>change(draft.filter((_,i)=>i!==index))}><Trash2 size={14}/></button>
            </div></div>
            <textarea id={"home-question-"+index} ref={el=>{fields.current[index]=el;}} rows={3} maxLength={maxHomeQuestionLength} value={question}
              placeholder="填写一个完整问题" onChange={e=>change(draft.map((text,i)=>i===index?e.target.value:text))}/>
          </li>)}</ol>
          {!draft.length && base && <p className="chat-home-help">暂未配置首页问题，可以继续自由提问。</p>}
          <button type="button" disabled={draft.length>=maxHomeQuestions} onClick={()=>{
            change([...draft,""]);requestAnimationFrame(()=>fields.current[draft.length]?.focus());
          }}><Plus size={15}/>添加问题</button>
          {error && <p role="alert">{error}</p>}
          <div className="chat-home-actions"><button type="submit" className="settings-save" disabled={!dirty}>{saving?"正在保存…":"保存首页问题"}</button>
            {dirty && <button type="button" onClick={()=>{if(config){setBase(config);setDraft(config.questions);}setError("");setNotice("");}}>取消修改</button>}
            {notice && <span role="status">{notice}</span>}
          </div>
        </fieldset>
      </form>
    </details>
  </section>;
}
