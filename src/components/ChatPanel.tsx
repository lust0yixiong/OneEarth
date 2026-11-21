import { loadRemoteAssetIds } from "../domain/datasets";
import {QuestionScope} from "./QuestionScope";
import {scopeKey} from "../domain/question-scope";
import {useWebPreview} from "./use-web-preview";
import {CopyButton,RunDetails} from "./RunDetails";
import {QuestionCheck} from "./QuestionCheck";
import { AnswerBody } from "./AnswerBody";
import { SourceDrawer } from "./SourceDrawer";
import { sourcesFor } from "../domain/answer-sources";
import { literatureDisplay } from "../domain/literature-label";
import { useCatalogRevision } from "./use-catalog-revision";
import { sceneDocument } from "../domain/earth-search";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  MapPin,

  ChevronDown,
  ChevronRight,
  ListChecks,
  Clock3,
  Check,
  ExternalLink,
  Plus,
  X,
  Quote,
  ListTree,
  GripHorizontal,
  History,
  RotateCcw,
} from "lucide-react";
import { useWorkspace } from "../domain/store";
import { caseById } from "../domain/catalog";
import { emptyFilters } from "../domain/spatial";
import type { SessionSummary } from "../domain/session-storage";
import type { Message } from "../domain/types";
import "../styles/research-chat.css";
import { assetById } from "../domain/datasets";
import { NeedList } from "./NeedList";
import { ChatResizeHandles, type ChatLayout } from "./ChatBoundary";
import {reloadChatHome,useChatHome} from "./use-chat-home";

function AnswerAuthor({message}:{message:Message}) {
  const intent=message.researchIntent ?? message.candidates?.researchRecord?.intent;
  const region=intent?.region?.trim() || "未指定地区";
  const time=(intent?.time?.trim() || "未指定时间")
    .replace(/^(\d{4})\s*年?\s*[—–\-~～至到]\s*(\d{4})\s*年?$/, "$1年-$2年");
  return <><img className="chat-author-mark" src="/brand/OneEarth-wordmark-black-red.svg" alt="OneEarth" />
    <span className="chat-answer-scope" aria-label="本轮研究范围" title={region+" / "+time}><span aria-hidden="true">·</span><span aria-label="空间位置">{region}</span><span aria-hidden="true">/</span><span aria-label="时间范围">{time}</span></span>
  </>;
}

function ResearchRows({ message }: { message: Message }) {
  const { inspectAsset, inspectCandidates } = useWorkspace();
  const result = message.research!;
  const filters = message.candidates?.filters || emptyFilters();
  const selection = message.candidates?.selection || null;
  const ordinal = new Map(message.candidates?.ids.map((id, i) => [id, i + 1]));
  const displayed = new Set(message.answerNotes?.sources.filter(source=>assetById.has(source.id)).map(source=>source.id));
  const rows = result.rows.flatMap(row=>{
    const ids = row.ids.filter(id=>!displayed.has(id));
    return ids.length || !row.ids.length || row.references?.length ? [{...row,ids}] : [];
  });
  const compareSeptember = result.caseId === "Q08" && message.candidates?.ids.includes("Q08-0") && message.candidates.ids.includes("Q08-1");
  if (!rows.length && !compareSeptember) return null;
  const content = (
    <div className="chat-research-results">
      {rows.map((row) => (
        <details
          className="chat-role"
          key={row.index}
          open={
            result.rows.length === 1 ||
            result.intent === "coverage" ||
            result.intent === "access" ||
            result.intent === "gap" ||
            undefined
          }
        >
          <summary>
            <span className="chat-role-label">
              {row.name}
              {row.ids.length > 0 && (
                <em>{assetById.get(row.ids[0])?.title}</em>
              )}
            </span>
            <small>
              {row.ids.length
                ? row.ids.length + " 份资料"
                : row.references?.length
                  ? "时段待核"
                  : "待补资料"}
            </small>
            <ChevronDown size={12} />
          </summary>
          <div className="chat-role-body">
            <div>{row.detail}</div>
            {row.references?.map((id) => {
              const asset = assetById.get(id);
              return (
                asset?.url && (
                  <div className="chat-role-item" key={id}>
                    <small>待核研究期的来源</small>
                    <a href={asset.url} target="_blank" rel="noreferrer">
                      {asset.title} <ExternalLink size={11} />
                    </a>
                  </div>
                )
              );
            })}
            {row.ids.map((id) => {
              const asset = assetById.get(id);
              if (!asset) return null;
              return (
                <div className="chat-role-item" key={id}>
                  <button
                    onClick={() =>
                      inspectAsset(id, filters, selection, message.candidates)
                    }
                  >
                    <span>{ordinal.get(id)}.</span> {asset.title}{" "}
                    <ArrowUpRight size={12} />
                  </button>
                  <small>
                    {asset.status} · {asset.source}
                  </small>
                  {asset.url && (
                    <a href={asset.url} target="_blank" rel="noreferrer">
                      发布方入口 <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      ))}
      {compareSeptember && (
        <button className="chat-compare" onClick={() => inspectCandidates(message.candidates!)}>
          对照 9 月时间序列 <ArrowUpRight size={12} />
        </button>
      )}
    </div>
  );
  return message.answerNotes ? <details className="chat-role"><summary>查看研究需求与候选资料 <ChevronDown size={12}/></summary>{content}</details> : content;
}
export function ChatPanel({ layout }: { layout: ChatLayout }) {
  const home=useChatHome();
  const {
    state: s,
    patch,
    flyToResearchRegion,
    send,
    confirmQuestion,
    attachScope,
    retry,
    switchSession,
    retrySessionSave,
    sessionSummaries,
    inspectAsset,
  } = useWorkspace();
  const previewWeb=useWebPreview(s.messages.flatMap(m=>m.answerNotes?.webSources || []));
  const historyIds=useMemo(()=>new Set(s.messages.map(m=>m.id)),[s.sessionId]);
  const revision=useCatalogRevision();
  const [readyAnswers,setReadyAnswers]=useState<ReadonlySet<string>>(()=>new Set());
  const answerReady=useCallback((id:string)=>setReadyAnswers(ids=>ids.has(id)?ids:new Set(ids).add(id)),[]);
  const latest=s.messages.at(-1);
  const latestReady=latest?.role==="assistant" && !latest.failed && !latest.clarification && !latest.questionCheck
    && !s.pending && (historyIds.has(latest.id) || readyAnswers.has(latest.id));
  const latestSources=useMemo(()=>latestReady?sourcesFor(literatureDisplay(latest!)).refs:[],[latest,latestReady,revision]);
  const [composerSources,setComposerSources]=useState<Message|null>(null);
  useEffect(()=>setComposerSources(null),[s.sessionId]);
  const questions=useMemo(()=>{
    let last:Message|undefined;
    const byId=new Map(s.messages.filter(m=>m.role==="user").map(m=>[m.id,m]));
    const preceding:Message[]=[],byAnswer=new Map<string,Message>();
    for(const m of s.messages) {
      if(m.role==="user"){last=m;preceding.push(m);}
      else {
        // Exact reply IDs take precedence. Legacy late replies carry the
        // original question in context; never jump to a newer, unrelated one.
        const question=m.replyTo?byId.get(m.replyTo):m.context?.startsWith("原问题 · ")
          ?preceding.slice().reverse().find(q=>m.context!.startsWith("原问题 · "+q.text+" · ")):last;
        if(question)byAnswer.set(m.id,question);
      }
    }
    return byAnswer;
  },[s.messages]);
  const [text, setText] = useState("");
  const conversation = useRef<HTMLDivElement>(null);
  const locateQuestion=useCallback((id:string)=>{
    const question=document.getElementById("message-"+id);
    if(!question || !conversation.current?.contains(question))return;
    question.scrollIntoView({block:"center",behavior:"instant"});
    question.focus({preventScroll:true});
  },[]);
  const input = useRef<HTMLTextAreaElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRows, setHistoryRows] = useState<SessionSummary[]>([]);
  const [historyStatus, setHistoryStatus] = useState("");
  const historyButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!historyOpen) return;
    let active = true;
    setHistoryStatus("正在读取会话…");
    void sessionSummaries().then(rows => {
      if (active) { setHistoryRows(rows); setHistoryStatus(""); }
    }).catch(() => { if (active) setHistoryStatus("浏览器暂时无法读取历史会话。"); });
    return () => { active = false; };
  }, [historyOpen, sessionSummaries]);
  async function chooseSession(id?: string) {
    if (!await switchSession(id)) return;
    setText("");
    setHistoryOpen(false);
    input.current?.focus();
  }
  useEffect(()=>{if(s.draftScope?.length && s.chatOpen)input.current?.focus({preventScroll:true});},[s.draftScope,s.chatOpen]);
  const c = caseById(s.caseId);
  useEffect(() => {
    const latest = conversation.current?.lastElementChild;
    if (latest && s.messages.length)
      latest.scrollIntoView({ block: "start", behavior: "instant" });
    else conversation.current?.closest(".chat-scroll")?.scrollTo(0, 0);
  }, [s.messages.length, s.pending]);
  const regionsByQuestion=useMemo(()=>{
    const regions=new Map(s.messages.flatMap(m=>m.replyTo && m.researchRegion?[[m.replyTo,m.researchRegion] as const]:[]));
    if(s.researchRegion)regions.set(s.researchRegion.messageId,s.researchRegion.region);
    return regions;
  },[s.messages,s.researchRegion]);
  const renderedMessages=useMemo(()=>s.messages.map((m) => (
            <article
              key={m.id}
              id={"message-"+m.id}
              data-message-id={m.id}
              tabIndex={m.role==="user"?-1:undefined}
              className={"message " + m.role + (m.failed ? " failed" : "")}
            >
              <small className={m.role==="assistant"?"answer-author":undefined}>
                {m.role === "user" ? "你" : <AnswerAuthor message={m}/>}
                {m.role==="user" && regionsByQuestion.has(m.id)?<> · <button className="question-region-link"
                  disabled={regionsByQuestion.get(m.id)!.status!=="located"}
                  title={regionsByQuestion.get(m.id)!.note}
                  aria-label={"定位研究区域："+regionsByQuestion.get(m.id)!.label}
                  onClick={()=>flyToResearchRegion(regionsByQuestion.get(m.id)!,m.id)}>
                  <MapPin size={11}/><span>{regionsByQuestion.get(m.id)!.label}</span>
                  {regionsByQuestion.get(m.id)!.status!=="located"?" · 待定位":regionsByQuestion.get(m.id)!.precision==="approximate"?" · 示意范围":""}
                </button></>:m.role==="user" && m.context && " · " + m.context}
              </small>
              {m.role==="assistant" && (m.historicalReply || m.context?.startsWith("原问题 · ")) && <div className="answer-reply-context">
                <span>保持当前地图</span><span aria-hidden="true">·</span>
                <button disabled={!questions.has(m.id)} aria-controls={questions.has(m.id)?"message-"+questions.get(m.id)!.id:undefined}
                  title={questions.has(m.id)?"定位到这条回答对应的提问":"这条历史记录未保存对应提问"}
                  onClick={()=>{const question=questions.get(m.id);if(question)locateQuestion(question.id);}}>查看对应提问</button>
              </div>}
              {m.citation && (
                <div className="message-citation">
                  <Quote size={12} />
                  {m.citation.excerpt ? (
                    <button
                      onClick={() =>
                        patch({
                          evidence: m.citation!.excerpt!,
                          previewKind: null,
                        })
                      }
                    >
                      {m.citation.title}
                    </button>
                  ) : (
                    m.citation.title
                  )}
                </div>
              )}
              {m.role==="user" && <><p>{m.text}</p><QuestionScope items={m.attachedScope || []}/>
                <footer className="question-meta" aria-label="提问时间与复制">
                  <time dateTime={new Date(m.time).toISOString()} title={new Date(m.time).toLocaleString("zh-CN")}>{new Date(m.time).toLocaleTimeString("zh-CN",{hour:"numeric",minute:"2-digit",hour12:false})}</time>
                  <CopyButton text={m.text} label="复制问题"/>
                </footer>
              </>}
              {m.id === s.unansweredQuestionId && m === s.messages.at(-1) && !s.pending && (
                <button className="activity-link" onClick={() => { setText(m.text); patch({draftScope:m.attachedScope || null,citation:m.citation || null}); input.current?.focus(); }}>
                  这条问题未收到回答，重新提问
                </button>
              )}
              {m.role==="assistant" && m.questionCheck && <QuestionCheck check={m.questionCheck} pending={s.pending}
                closed={s.messages.find(next=>next.role==="user" && next.time>m.time)?.questionDecision ||
                  (s.messages.some(next=>next.role==="user" && next.time>m.time)?"superseded":undefined)}
                onChoose={(choice,edited)=>void confirmQuestion(m.id,choice,edited)}/>}
              {m.role==="assistant" && !m.questionCheck && <AnswerBody message={m} animate={!historyIds.has(m.id) && Date.now()-m.time<3000} onReady={answerReady}
                question={questions.get(m.id)?.text || "OneEarth 研究记录"} onQuote={(reference,number)=>{
                  const item={kind:"reference" as const,reference,number,messageId:m.id};
                  attachScope(item);
                  input.current?.focus({preventScroll:true});
                }}>
              {m.answerNotes && m.runTrace && !m.failed &&
                <CopyButton text={new URL("?research="+m.id,location.href).href} label="复制研究记录链接"/>}
              {m.catalogMatch && !m.answerNotes && m.candidates?.ids.map(id => (
                <button className="candidate-link" key={id} onClick={() =>
                  inspectAsset(id, m.candidates!.filters, null, m.candidates)}>
                  {assetById.get(id)?.title} · 数据速览 <ArrowUpRight size={12} />
                </button>
              ))}
              {m.catalogMatch?.lookups?.filter(l => l.items.length).map(l => (
                <button key={l.url} className="activity-link" onClick={() => patch({evidence: sceneDocument(l), previewKind: "table"})}>
                  查看 {l.assetId.replace("earth-search:", "")} 影像条目（{l.items.length}）<ArrowUpRight size={12} />
                </button>
              ))}
              {m.catalogMatch?.rejected.map(r => (
                <a key={r.url} className="activity-link" href={r.url} target="_blank" rel="noreferrer">
                  {r.title} · 核对发布方记录 <ExternalLink size={12} />
                </a>
              ))}
              {!m.answerNotes && m.dataSupport?.candidates.map((c) => (
                <button
                  className="candidate-link"
                  key={c.assetId}
                  onClick={() =>
                    inspectAsset(c.assetId, emptyFilters(), null, {
                      title: m.text.split("\n")[0],
                      ids: m.dataSupport!.candidates.map((r) => r.assetId),
                      caseId: null,
                      originKind: "chat",
                      filters: emptyFilters(),
                      selection: null,
                      layer: "all",
                      camera: s.camera,
                      gridSystem: s.gridSystem,
                    })
                  }
                >
                  {c.input} · {c.title} <ArrowUpRight size={12} />
                </button>
              ))}
              {m.research && <ResearchRows message={m}/>}
              </AnswerBody>}
              {m.failed && (m.retry ? (
                <button disabled={s.pending} onClick={() => retry(m.retry!)}>重试</button>
              ) : <small>旧记录没有保存完整请求，可重新提问。</small>)}
            </article>
          )),[s.messages,s.unansweredQuestionId,s.pending,s.camera,s.gridSystem,historyIds,questions,patch,confirmQuestion,attachScope,retry,inspectAsset,answerReady,regionsByQuestion,flyToResearchRegion,locateQuestion]);
  if (!s.chatOpen) return null;
  const examples =
    c?.id === "wind"
      ? ["切换到 250 hPa 高空风", "查看风场原网格内容"]
      : c?.id === "Q19"
        ? ["只看 0–200 米的温盐剖面", "共同使用还缺什么？"]
        : c?.id === "Q02"
          ? ["DEM 和冰川边界是否同地？", "限定 DEM 为 10 米以内"]
          : ["这批资料有哪些可核对的内容？", "怎么获取这些资料？", "查看覆盖范围"];
  return (
    <aside
      id="oneearth-chat-panel"
      className="chat-panel"
      aria-label="数据探索对话"
      style={layout.panelStyle}
    >
      <button
        className="chat-move-handle"
        aria-label="移动 Chat 窗口"
        title="拖动移动 Chat，双击恢复默认布局"
        {...layout.pointerHandlers("move")}
        onKeyDown={layout.keyboard("move")}
        onDoubleClick={layout.reset}
      >
        <GripHorizontal size={18} />
      </button>
      <ChatResizeHandles layout={layout} />
      <div className="chat-tools" role="toolbar" aria-label="对话操作">
        <div className="icon-actions">
          <button ref={historyButton} className="session-history-toggle" aria-expanded={historyOpen}
            onClick={() => setHistoryOpen(!historyOpen)} aria-label="历史会话">
            <History size={14} />历史会话
          </button>
          <button
            aria-label="恢复 Chat 默认布局"
            title="恢复 Chat 默认位置和大小"
            onClick={layout.reset}
          >
            <RotateCcw size={14} />
          </button>
          <button
            title="开始新对话"
            aria-label="开始新对话"
            onClick={() => void chooseSession()}
          >
            <Plus size={17} />
          </button>
        </div>
      </div>
      {historyOpen && (
        <section className="session-history" aria-label="历史会话列表" onKeyDown={event => {
          if (event.key === "Escape") { setHistoryOpen(false); historyButton.current?.focus(); }
        }}>
          <div className="session-history-head"><strong>历史会话</strong>
            <button aria-label="关闭历史会话" onClick={() => { setHistoryOpen(false); historyButton.current?.focus(); }}><X size={15} /></button>
          </div>
          {historyStatus && <p role="status">{historyStatus}</p>}
          {historyRows.map(row => (
            <button key={row.id} className="session-history-item" data-session-id={row.id} aria-current={row.id === s.sessionId || undefined}
              onClick={() => void chooseSession(row.id)}>
              <span>{row.title}</span>
              <small>{!row.firstQuestion && "未提问 · "}{row.id === s.sessionId && "当前 · "}{new Date(row.updatedAt).toLocaleString("zh-CN", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit" })}</small>
            </button>
          ))}
        </section>
      )}
      <div className="chat-scroll" onClick={previewWeb}>
        {!s.messages.length && <div className="chat-greeting">
          <h2>{c ? c.title : "你想研究什么问题？"}</h2>
          <p>
            {c
              ? "讨论本题的数据、方法与依据，也可继续限定区域和时段。"
              : "可以讨论数据的含义、差异与关系，也可以查找资料或在地球上查看。"}
          </p>
        </div>}
        {s.messages.length === 0 && !c && (
          <div className="suggested-queries">
            {(home.config?.questions || []).map(question=><button key={question} onClick={() => send(question)}>
              <span>{question}</span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </button>)}
            {!home.config && <p className="suggested-queries-status" role={home.error?"alert":"status"}>
              {home.error?"首页问题暂时无法读取。":"正在读取首页问题…"}
              {home.error && <button type="button" onClick={()=>void reloadChatHome()}>重试</button>}
            </p>}
          </div>
        )}
        <div
          ref={conversation}
          className="messages"
          role="log"
          aria-live="polite"
        >
          {renderedMessages}
        </div>
        {s.pending && <div className="live-search pending" role="status"><RunDetails working trace={s.liveTrace} stage={s.chatStage} runs={s.liveSearches} openFinding={id=>void loadRemoteAssetIds([id]).then(()=>inspectAsset(id,s.filters,s.selection)).catch(()=>patch({error:"暂时无法打开这条线索。"}))}/></div>}
        <NeedList />
        {c && (
          <div className="followup-suggestions">
            {examples.map((q) => (
              <button key={q} disabled={s.pending} onClick={() => send(q)}>
                {q}
                <ArrowUpRight size={12} />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="chat-compose">
        {s.sessionError && <p className="session-storage-error" role="alert">{s.sessionError} <button onClick={() => void retrySessionSave()}>重试保存会话</button></p>}
        {latestReady && latestSources.length>0 && <div className="composer-sources-row">
          <button type="button" className="composer-sources" title={questions.get(latest!.id)?.text}
            aria-haspopup="dialog" onClick={()=>setComposerSources(literatureDisplay(latest!))}>
            <span className="composer-sources-icon" aria-hidden="true"><ListChecks size={14}/><Clock3 className="composer-sources-recent" size={8}/></span>本轮来源与依据 · <span>{latestSources.length}</span><ChevronRight size={13} aria-hidden="true"/>
          </button>
        </div>}
        <div className={"chat-composer-input"+(s.citation || s.draftScope?.length ? " composer-with-reference" : "")}>
        {(s.citation || !!s.draftScope?.length) && <div className="composer-references">
        <QuestionScope items={s.draftScope || []} remove={key=>patch({draftScope:(s.draftScope || []).filter(i=>scopeKey(i)!==key)})}/>
        {s.citation && (
          <div className="citation-attachment" role="group" aria-label="本次提问引用的材料">
            <Quote size={13} />
            <span title={s.citation.title}>{s.citation.title}</span>
            <button
              aria-label="移除引用"
              onClick={() => { patch({ citation: null }); input.current?.focus(); }}
            >
              <X size={13} />
            </button>
          </div>
        )}
        </div>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim() || s.pending) return;
            void send(text);
            setText("");
          }}
        >
          <textarea
            ref={input}
            aria-label="向 OneEarth 提问"
            rows={2}
            placeholder="描述研究问题，或追问数据来源与使用条件…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="compose-bottom">
            <small>Enter 发送 · Shift + Enter 换行</small>
            <button
              disabled={!text.trim() || s.pending}
              type="submit"
              aria-label="发送消息"
            >
              <ArrowUp size={18} />
            </button>
          </div>
        </form>
        </div>
        
      </div>
      {composerSources && <SourceDrawer refs={sourcesFor(composerSources).refs} message={composerSources}
        title="本条回答的来源与依据" question={questions.get(composerSources.id)?.text} close={()=>setComposerSources(null)}/>}
    </aside>
  );
}
