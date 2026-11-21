import {literatureDisplay} from "../domain/literature-label";
import {loadRemoteAssetIds} from "../domain/datasets";
import "../styles/research-list.css";
import { useEffect, useState } from "react";
import type { CandidateSet } from "../domain/types";
import { caseById } from "../domain/catalog";
import {
  createResearchList,
  listKey,
  listMarkdown,
  parseResearchList,
  persistResearchList,
  readResearchLists,
  unavailableItems,
  researchProducts,
  researchNote,
  updateResearchNote,
  type ResearchList,
} from "../domain/research-list";
import { originLabel, scopeTerms } from "../domain/batch-context";
import { useWorkspace } from "../domain/store";

function download(list: ResearchList, type: "md" | "json") {
  const content =
    type === "md" ? listMarkdown(list) : JSON.stringify(list, null, 2);
  const url = URL.createObjectURL(
    new Blob([content], {
      type: type === "md" ? "text/markdown;charset=utf-8" : "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download =
    "OneEarth-" +
    (list.batch.caseId || "研究清单") +
    "-" +
    list.id.slice(0, 8) +
    "." +
    type;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "读取研究清单失败。";
export function BatchContext({ batch }: { batch: CandidateSet }) {
  const terms = scopeTerms(batch);
  return (
    <div className="batch-context" aria-label="这批资料的来源与范围">
      <strong>
        {batch.restoredFrom ? "已保存清单 · " : ""}
        {originLabel(batch)}
      </strong>
      <span>{caseById(batch.caseId)?.title || "全部研究"}</span>
      <span>{terms.join(" · ") || "未限定区域和时段"}</span>
      <span>{batch.ids.length} 项资料</span>
    </div>
  );
}
export function SaveResearchList({
  batch,
  selected = false,
  single = false,
}: {
  batch: CandidateSet;
  selected?: boolean;
  single?: boolean;
}) {
  const { patch } = useWorkspace();
  const [saved, setSaved] = useState("");
  const [busy,setBusy]=useState(false);
  const key = JSON.stringify(batch);
  if (!batch.ids.length) return null;
  return (
    <span className="save-list-control">
      <button
        type="button"
        disabled={key === saved||busy}
        onClick={async () => {
          setBusy(true);
          try {
            await loadRemoteAssetIds(batch.ids);
            persistResearchList(createResearchList(batch), localStorage);
            setSaved(key);
            window.dispatchEvent(new Event("oneearth-list-changed"));
          } catch (e) {
            patch({ error: errorText(e) });
          }finally{setBusy(false);}
        }}
      >
        {busy?"正在读取资料…":key === saved
          ? "已保存到研究清单"
          : single ? "保存这份资料到研究清单"
          : selected
            ? "保存已选清单"
            : "保存研究清单"}
      </button>
    </span>
  );
}
export function ResearchListLibrary() {
  const { showCandidates, patch, switchSession } = useWorkspace();
  const [lists, setLists] = useState<ResearchList[]>([]);
  const [notice, setNotice] = useState("");
  function refresh() {
    try {
      const next=readResearchLists(localStorage);
      setLists(literatureDisplay(next));
      const missing=next.flatMap(l=>unavailableItems(l).map(i=>i.id)).filter(id=>id.startsWith("constellation:") || id.startsWith("earthnano:"));
      if(missing.length) void loadRemoteAssetIds(missing).then(()=>setLists(literatureDisplay(readResearchLists(localStorage)))).catch(()=>{});
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  useEffect(() => {
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("oneearth-list-changed", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("oneearth-list-changed", refresh);
    };
  }, []);
  return (
    <section className="research-library" aria-label="研究清单">
      <header>
        <h2>研究清单</h2>
        <label className="import-list">
          导入研究清单
          <input
            type="file"
            aria-label="导入研究清单"
            accept=".json,application/json"
            onChange={async (e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (!file) return;
              try {
                if (file.size > 8 * 1024 * 1024)
                  throw Error("清单文件超过 8 MB。");
                const list = parseResearchList(await file.text());
                persistResearchList(list, localStorage);
                refresh();
                setNotice("已导入「" + list.batch.title + "」。");
              } catch (err) {
                setNotice(errorText(err));
              }
            }}
          />
        </label>
      </header>
      {notice && <p role="status">{notice}</p>}
      {!lists.length && (
        <p>选择研究资料后，可将候选、使用条件与判断依据一起保存到此浏览器。</p>
      )}
      <div className="research-products">{researchProducts(lists).map(product=><details className="research-product" key={product.key}>
        <summary><span><b>{product.item.title}</b><small>{product.versions.length>1?product.versions.length+" 个版次":product.item.version || "版次待核"} · {product.entries.length} 次加入</small></span></summary>
        {product.entries.map(({list,item})=>{
          const record=list.researchRecord,intent=record?.intent;
          return <section className="research-record" key={list.id}>
            <h3>{record?.question || list.question}</h3>
            <div className="research-record-scope"><span>关注区域　{intent?.region || list.batch.filters.place || "未指定"}</span>
              <span>研究时段　{intent?.time || scopeTerms({...list.batch,selection:null,filters:{...list.batch.filters,place:""}}).join(" · ") || "未指定"}</span>
              {product.versions.length>1 && <span>资料版次　{item.version || "待核"}</span>}</div>
            <ResearchNote key={list.id+item.id+researchNote(list,item.id)} value={researchNote(list,item.id)} save={value=>{
              try{updateResearchNote(list,item.id,value,localStorage);window.dispatchEvent(new Event("oneearth-list-changed"));}
              catch(e){setNotice(errorText(e));}
            }}/>
            <div className="research-record-tools"><small>加入于 {new Date(list.createdAt).toLocaleString()}</small>
              {record?.sessionId && <button onClick={async()=>{
                if(await switchSession(record.sessionId)){
                  patch({chatOpen:true});
                  requestAnimationFrame(()=>document.getElementById("message-"+record.messageId)?.scrollIntoView({block:"center"}));
                }
              }}>回到原回答</button>}
              {item.url && <a href={item.url} target="_blank" rel="noreferrer">来源入口 ↗</a>}
            </div>
          </section>;
        })}
      </details>)}</div>
      {!!lists.length && <details className="saved-batches"><summary>已保存批次与导出（{lists.length}）</summary>
      {lists.map((list) => {
        const missing = unavailableItems(list);
        const unavailable =
          missing.length > 0 ||
          !!(list.batch.caseId && !caseById(list.batch.caseId));
        return (
          <article key={list.id} className="research-list-item">
            <h3>{list.batch.title}</h3>
            <small>
              {list.items.length} 项 ·{" "}
              {new Date(list.createdAt).toLocaleString()} ·{" "}
              {originLabel(list.batch)}
            </small>
            <p>{list.assessment.summary}</p>
            <details>
              <summary>保存时的资料与判断</summary>
              <BatchContext batch={list.batch} />
              <ol>
                {list.items.map((i) => (
                  <li key={i.id}>
                    <b>{i.title}</b> · {i.version || "版次待核"} · {i.role}
                    <p>
                      {i.source} · {i.access}
                    </p>
                    {i.reference && <p>引用原件 · {i.reference.url
                      ? <a href={i.reference.url} target="_blank" rel="noreferrer">{i.reference.title}</a>
                      : i.reference.title}</p>}
                  </li>
                ))}
              </ol>
              {list.assessment.findings.map((f) => (
                <p key={f.id}>
                  <strong>
                    {f.title} · {f.status}
                  </strong>
                  　{f.detail}
                </p>
              ))}
            </details>
            {unavailable && (
              <p>
                当前目录无法完整匹配保存时的版本。可查看或导出原始清单。
                {missing.map((i) => i.title).join("、")}
              </p>
            )}
            <div className="list-tools">
              <button
                disabled={unavailable}
                onClick={() =>
                  showCandidates({ ...list.batch, restoredFrom: list.id })
                }
              >
                恢复这份清单
              </button>
              <button onClick={() => download(list, "md")}>
                导出 Markdown
              </button>
              <button onClick={() => download(list, "json")}>导出 JSON</button>
              <button
                onClick={() => {
                  try {
                    localStorage.removeItem(listKey(list.id));
                    refresh();
                  } catch (e) {
                    patch({ error: errorText(e) });
                  }
                }}
              >
                从本机移除
              </button>
            </div>
          </article>
        );
      })}</details>}
    </section>
  );
}

function ResearchNote({value,save}:{value:string;save:(value:string)=>void}) {
  const [editing,setEditing]=useState(false),[draft,setDraft]=useState(value);
  return <div className="research-note"><label>研究备注</label>{editing?<>
    <textarea aria-label="编辑研究备注" value={draft} maxLength={2400} onChange={e=>setDraft(e.target.value)}/>
    <button onClick={()=>{save(draft);setEditing(false);}}>保存备注</button>
    <button onClick={()=>{setDraft(value);setEditing(false);}}>取消</button>
  </>:<><p>{value}</p><button onClick={()=>setEditing(true)}>编辑备注</button></>}</div>;
}
