import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Database, Globe, SlidersHorizontal } from "lucide-react";
import { readChatModel, rememberedModel, rememberedService, saveChatModel, validChatModel, type ChatModel } from "../domain/chat-model";
import { useWorkspace } from "../domain/store";
import { useWindTheme } from "../domain/wind-theme";
import { assets } from "../domain/datasets";
import { products } from "../domain/product-distribution";
import { useCatalogRevision } from "./use-catalog-revision";
import {DeepSeekToolsSettings} from "./DeepSeekToolsSettings";
import {ChatHomeSettings} from "./ChatHomeSettings";
import {useDataAccessNavigation} from "./use-data-access-navigation";
import {version} from "../../package.json";

export function SettingsPage({onBack,resetLayout}:{onBack:()=>void;resetLayout:()=>void}) {
  const { state,patch } = useWorkspace();
  const [dataAccessNavigation,setDataAccessNavigation] = useDataAccessNavigation();
  const revision=useCatalogRevision();
  const catalogCounts=useMemo(()=>({products:products(assets).size,papers:products(assets.filter(a=>a.origins.includes("paper"))).size}),[revision]);
  const [executor,setExecutor] = useState(()=>readChatModel().executor);
  const [models,setModels] = useState(()=>{
    const active=readChatModel();
    return {codex:rememberedModel("codex"),claude:rememberedModel("claude"),[active.executor]:active.model};
  });
  const [provider,setProvider]=useState<NonNullable<ChatModel["provider"]>>(()=>readChatModel().provider || "native");
  const [endpoint,setEndpoint]=useState(()=>readChatModel().endpoint || "");
  const [apiKey,setApiKey]=useState("");
  const [keyBusy,setKeyBusy]=useState(false);
  const config:ChatModel={executor,provider,model:models[executor].trim(),...(provider==="custom"?{endpoint:endpoint.trim()}: {})};
  function switchService(nextExecutor:ChatModel["executor"],nextProvider:typeof provider){
    clearTest();setApiKey("");setChoices([]);setCustom(false);
    const saved=rememberedService(nextExecutor,nextProvider);
    setExecutor(nextExecutor);setProvider(nextProvider);setEndpoint(saved.endpoint || "");
    setModels(previous=>({...previous,[nextExecutor]:saved.model}));
  }
  async function applyKey(){
    if(!apiKey.trim() || !validChatModel(config))return;
    setKeyBusy(true);clearTest();
    try {
      const res=await fetch("/api/models/service/key",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({config,key:apiKey})});
      if(!res.ok)throw Error((await res.json()).error);
      setApiKey("");setAttempt(n=>n+1);setNotice("密钥已用于当前服务进程。");
    } catch(err){setError(err instanceof Error?err.message:"设置密钥失败。");}
    finally {setKeyBusy(false);}
  }
  const [windTheme,setWindTheme] = useWindTheme();
  const [notice,setNotice] = useState("");
  const [error,setError] = useState("");
  const [choices,setChoices] = useState<{id:string;label:string}[]>([]);
  const [listStatus,setListStatus] = useState("正在读取模型列表…");
  const [attempt,setAttempt] = useState(0);
  const [custom,setCustom] = useState(false);
  const [testing,setTesting] = useState(false);
  const [feedback,setFeedback] = useState("");
  const testRequest = useRef<AbortController|null>(null);
  function clearTest() {
    testRequest.current?.abort();
    setTesting(false);setFeedback("");setNotice("");setError("");
  }
  useEffect(()=>{
    const controller=new AbortController();
    setChoices([]);setListStatus("正在读取模型列表…");
    (async()=>{
      try {
        if(provider==="custom" && !validChatModel({...config,model:""})){setListStatus("请输入兼容服务的 API 基础地址。");return;}
        const response=provider==="native" ? await fetch("/api/models/"+executor,{signal:controller.signal})
          : await fetch("/api/models/service/list",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({config:{...config,model:""}}),signal:controller.signal});
        const result=await response.json();
        if(!response.ok)throw Error(result.error);
        if(!controller.signal.aborted){setChoices(result.models);setListStatus(result.models.length?"":"执行器未列出具名模型，可使用默认模型。");}
      } catch(err){if(!controller.signal.aborted)setListStatus(err instanceof Error?err.message:"无法读取模型列表。");}
    })();
    return ()=>controller.abort();
  },[executor,provider,endpoint,attempt]);
  useEffect(()=>()=>testRequest.current?.abort(),[]);
  async function testConnection(){

    if(!validChatModel(config) || (provider!=="native" && !config.model)){setFeedback("请检查服务地址并选择模型。");return;}
    const controller=new AbortController();
    testRequest.current?.abort();testRequest.current=controller;
    setTesting(true);setFeedback("正在等待模型回复…");
    try{
      const response=await fetch("/api/models/test",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(config),signal:controller.signal});
      const result=await response.json();
      if(!response.ok)throw Error(result.error || "测试失败。");
      if(!controller.signal.aborted)setFeedback("连接成功 · "+(config.model || (executor==="codex" && provider==="native" ? "gpt-6-luna" : "执行器默认模型"))+" · "+(result.elapsedMs/1000).toFixed(1)+" 秒");
    } catch(err){if(!controller.signal.aborted)setFeedback(err instanceof Error?err.message:"连接失败。");}
    finally{if(!controller.signal.aborted)setTesting(false);}
  }
  return <main className="settings-page" aria-labelledby="settings-heading">
    <header><img src="/brand/OneEarth-lockup-light-transparent@1x.png" alt="OneEarth"/>
      <button onClick={onBack}><ArrowLeft size={16}/>返回工作区</button></header>
    <div className="settings-content">
      <h1 id="settings-heading">设置</h1>
      <p className="settings-version">OneEarth v{version}</p>
      <ChatHomeSettings/>
      <section><h2><SlidersHorizontal size={19}/>模型与执行器</h2>
        <form onSubmit={e=>{
          e.preventDefault();
          const names={codex:models.codex.trim(),claude:models.claude.trim()};
          if (!validChatModel(config) || (provider!=="native" && !config.model)) {
            setError("请检查服务地址并选择有效的模型。");return;
          }
          try {saveChatModel(config,names);setError("");setNotice("已保存，下次提问使用 "+(executor==="claude"?"Claude Code":"Codex")+"。");}
          catch {setError("浏览器未能保存设置，请检查本地存储权限。");}
        }}>
          <label>当前执行器<select aria-label="执行器" value={executor} onChange={e=>{switchService(e.target.value as ChatModel["executor"],provider);}}>
            <option value="codex">Codex</option><option value="claude">Claude Code</option></select></label>
          <label>模型服务<select aria-label="模型服务" value={provider} onChange={e=>switchService(executor,e.target.value as typeof provider)}>
            <option value="native">执行器原有服务</option><option value="deepseek">DeepSeek</option><option value="custom">自定义兼容服务</option>
          </select></label>
          {provider==="custom" && <label>API 基础地址<input key={executor+provider} defaultValue={endpoint} placeholder={executor==="codex"?"https://…/v1（Responses）":"https://…（Anthropic Messages）"} onChange={e=>{clearTest();setEndpoint(e.target.value);}}/></label>}
          {provider!=="native" && <><label>服务 API Key<input type="password" autoComplete="off" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="填写或更换密钥"/></label>
            <button type="button" disabled={keyBusy || !apiKey.trim() || !validChatModel({...config,model:""})} onClick={applyKey}>应用密钥</button>
            <small>{provider==="deepseek"?"优先使用已应用的密钥，也支持服务端 DEEPSEEK_API_KEY。":"密钥仅用于此服务地址。"} 页面输入的密钥保存在服务进程内存中。</small></>}
          <label>模型<select aria-label="模型" value={custom?"@custom":models[executor]} onChange={e=>{
            clearTest();setCustom(e.target.value==="@custom");
            if(e.target.value!=="@custom")setModels({...models,[executor]:e.target.value});
          }}>
            <option value="">{provider==="native"?(executor==="codex"?"OneEarth 默认 · GPT-6-Luna":"使用执行器默认模型"):"选择模型"}</option>
            {choices.map(m=><option key={m.id} value={m.id}>{m.label===m.id ? m.id : m.label+" · "+m.id}</option>)}
            {models[executor] && !choices.some(m=>m.id===models[executor]) && <option value={models[executor]}>{models[executor]}（当前配置）</option>}
            <option value="@custom">自定义模型名称…</option>
          </select></label>
          {custom && <label>自定义模型名称<input value={models[executor]} maxLength={100} onChange={e=>{clearTest();setModels({...models,[executor]:e.target.value});}}/></label>}
          {listStatus && <small role="status">{listStatus} {listStatus!=="正在读取模型列表…" && <button type="button" onClick={()=>setAttempt(attempt+1)}>重新读取</button>}</small>}
          <button type="button" disabled={testing} onClick={testConnection}>{testing?"正在测试…":"测试连接"}</button>
          <small role="status">{feedback || "测试将通过当前选择的模型发送一条简短请求。"}</small>
          {error && <p role="alert">{error}</p>}
          <button type="submit" className="settings-save">保存设置</button>
        </form>
      </section>
      <DeepSeekToolsSettings keyRevision={attempt}/>
      <section><h2><Globe size={19}/>地球与工作区</h2>
        <label>在主导航显示「数据触达」<input type="checkbox" checked={dataAccessNavigation}
          aria-describedby="data-access-navigation-help" onChange={e=>setDataAccessNavigation(e.target.checked)}/></label>
        <small id="data-access-navigation-help">此设置仅控制当前浏览器中的主导航入口。已打开的数据触达页面和直接链接仍可使用。</small>
        <label>当前网格体系<select value={state.gridSystem} onChange={e=>patch({gridSystem:e.target.value as "h3"|"s2",selection:null})}>
          <option value="h3">H3</option><option value="s2">S2</option></select></label>
        <label>显示网格线<input type="checkbox" checked={state.mesh} onChange={e=>patch({mesh:e.target.checked})}/></label>
        <label>风场底图<select value={windTheme} onChange={e=>setWindTheme(e.target.value==="dark"?"dark":"light")}><option value="light">浅色</option><option value="dark">深色</option></select></label>
        <div className="settings-row"><span>对话窗口布局</span><button onClick={()=>{resetLayout();setNotice("已恢复对话窗口的默认大小和位置。");}}>恢复默认布局</button></div>
      </section>
      <section aria-labelledby="catalog-settings-heading"><h2 id="catalog-settings-heading"><Database size={19}/>数据目录与分布</h2>
        <dl className="settings-catalog-stats">
          <div><dt>目录产品</dt><dd>{catalogCounts.products.toLocaleString()}<span>种</span></dd></div>
          <div><dt>其中论文研究数据</dt><dd>{catalogCounts.papers.toLocaleString()}<span>个</span></dd></div>
        </dl>
        <small>统计当前已载入的目录，按数据集身份去重，不随地图筛选变化。</small>
        {state.paperFeed?.loading && <small role="status">正在载入论文研究数据详情（{state.paperFeed.loaded.toLocaleString()} / {state.paperFeed.total.toLocaleString()}）</small>}
        {state.paperFeed?.error && <small role="status">{state.paperFeed.error}</small>}
        {state.hainaFeed && <small>海纳地学专区接口：{state.hainaFeed.total.toLocaleString()} 条；最近同步 {state.hainaFeed.synced?new Date(state.hainaFeed.synced).toLocaleString():"尚未完成"}。</small>}
        {state.hainaFeed?.warning && <small role="status">{state.hainaFeed.warning}</small>}
        <p className="settings-distribution-note">网格分布以绿色深浅表示格内可定位数据集数；热力图和等值线使用同一份网格计数。全球覆盖与目录外包框等元数据范围另行关联，不计入格内精确数量。</p>
        <small>三体星座的蓝色轮廓表示已上报观测的实际足迹。</small>
      </section>
      <p role="status" className="settings-status">{notice}</p>
    </div>
  </main>;
}
