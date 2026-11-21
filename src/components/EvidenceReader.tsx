import {literatureDisplay} from "../domain/literature-label";
import {SourcePreviewSurface,usePreviewPosition} from "./SourcePreviewHost";
import type {SourceQuote} from "../domain/source-preview";
import {WebSourceReader} from "./WebSourceReader";
import {webUrl} from "../domain/web-preview";
import {useWebPreview} from "./use-web-preview";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Expand,
  Minimize2,
  ExternalLink,
  Quote,
  FileText,
  Table2,
  Code2,
  ListTree,
  Copy,
  Download,
  Check,
  Plus,
  Minus,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useWorkspace } from "../domain/store";
import type { EvidenceDocument } from "../domain/types";
import { citeMaterial, materialUrl, tablePageSize } from "../domain/evidence-citation";
export function EvidenceReader() {
  const { state } = useWorkspace();
  return state.evidence ? (
    <SourcePreviewSurface><Reader
      key={state.evidence.id + state.evidence.scope}
      doc={state.evidence}
    /></SourcePreviewSurface>
  ) : null;
}
function Reader({ doc: storedDoc }: { doc: EvidenceDocument }) {
  const doc=useMemo(()=>literatureDisplay(storedDoc),[storedDoc]);
  const { state: s, patch } = useWorkspace();
  const previewWeb=useWebPreview();
  const positionStyle=usePreviewPosition(s.inspector?110:0);
  const position = s.readerPosition;
  const tab = Math.min(position?.tab ?? Math.max(0, doc.tabs.findIndex(t => t.kind === s.previewKind)), doc.tabs.length - 1);
  const setPage = (page: number) => patch({ readerPosition: { tab, page } });
  const [loadedSource,setLoadedSource]=useState<{tab:number;quote:SourceQuote|null}>();
  const [expanded, setExpanded] = useState(false);
  const [pdfZoom, setPdfZoom] = useState(1);
  const [imageError, setImageError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const oldFocus = useRef<Element | null>(document.activeElement);
  const part = doc.tabs[tab];
  const remoteSource=part.kind==="web" || (part.kind==="pdf"&&!part.pages?.length);
  const pageSize = tablePageSize;
  const sourceQuote=loadedSource?.tab===tab?loadedSource.quote:null;
  const setSourceQuote=(quote:SourceQuote|null)=>setLoadedSource({tab,quote});
  const maxPage = part.kind === "pdf" ? (part.pages?.length || 1) - 1 : Math.ceil((part.rows?.length || 1) / pageSize) - 1;
  const page = Math.max(0, Math.min(position?.page || 0, maxPage));
  const rows = part.rows?.slice(page * pageSize, (page + 1) * pageSize) || [];
  useEffect(() => {
    host.current
      ?.querySelector<HTMLElement>("button")
      ?.focus({ preventScroll: true });
    return () => {
      if (oldFocus.current?.isConnected)
        (oldFocus.current as HTMLElement).focus({ preventScroll: true });
    };
  }, []);
  function closePreview() {
    // Closing is also a navigation boundary: an old animation must never
    // remove a source the user has just reopened.
    patch({evidence:null});
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if(host.current?.closest("dialog.oe-source-drawer"))e.preventDefault();
        if (expanded) setExpanded(false);
        else closePreview();
      }
      if (e.key === "Tab" && expanded) {
        const items = Array.from(
          host.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),a[href],select",
          ) || [],
        );
        if (e.shiftKey && document.activeElement === items[0]) {
          e.preventDefault();
          items.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
          e.preventDefault();
          items[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [expanded, patch]);
  function cite() {
    const citationPart=remoteSource && sourceQuote?{...part,kind:"text" as const,label:sourceQuote.label,body:sourceQuote.body,quote:sourceQuote.body,url:sourceQuote.url,sourcePage:sourceQuote.page}:part;
    patch({ citation: citeMaterial(doc, citationPart, page), evidence: null, chatOpen: true });
  }
  const original = materialUrl(doc, part, page);
  return (
    <div
      ref={host} onClick={previewWeb}
      style={expanded?undefined:positionStyle}
      className={"evidence-reader" + (expanded ? " expanded" : "")}
      role={expanded ? "dialog" : "region"}
      aria-modal={expanded ? true : undefined}
      aria-label="原始证据预览"
    >
      <div className="evidence-top">
        <span className="eyebrow">
          <FileText size={13} />
          内容预览
        </span>
        <div className="icon-actions">
          <button
            aria-label={expanded ? "缩回预览" : "放大预览"}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <Minimize2 size={16} /> : <Expand size={16} />}
          </button>
          <button
            aria-label="关闭预览"
            onClick={closePreview}
          >
            <X size={17} />
          </button>
        </div>
      </div>
      <h2>{doc.title}</h2>
      <div className="evidence-scope">
        {doc.scope} · {doc.source}
      </div>
      {(doc.tabs.length > 1 || doc.fullSource) && <div className="evidence-tabs">
        {doc.fullSource && (
          <button
            onClick={() =>
              patch({ evidence: doc.fullSource!, previewKind: null })
            }
          >
            查看来源材料（不限区域）
          </button>
        )}
        {doc.tabs.map((t, i) => (
          <button
            key={i}
            aria-pressed={tab === i}
            onClick={() => {
              patch({readerPosition: {tab: i, page: 0}});
              setImageError(false);
              setCopied(false);
              setCopyError(false);
            }}
          >
            {t.kind === "table" ? (
              <Table2 size={12} />
            ) : t.kind === "code" ? (
              <Code2 size={12} />
            ) : t.kind === "trace" ? (
              <ListTree size={12} />
            ) : (
              <FileText size={12} />
            )}{" "}
            {doc.tabs.filter((p) => p.kind === t.kind).length > 1
              ? t.label
              : {
                  table: "表格",
                  web: "网页",
                  pdf: "PDF 引用页",
                  text: "文字片段",
                  code: t.label,
                  trace: t.label,
                }[t.kind]}
          </button>
        ))}
      </div>}
      <div className="evidence-body" key={tab}>
        {part.kind === "code" ? (
          <div className="code-preview">
            <div className="code-toolbar">
              <span>
                {part.language || "text"} · {part.label}
              </span>
              <div className="icon-actions">
                <button
                  aria-label="复制代码"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(part.body || "");
                      setCopied(true);
                      setCopyError(false);
                    } catch {
                      setCopyError(true);
                    }
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "已复制" : "复制"}
                </button>
                <button
                  aria-label="下载代码"
                  onClick={() => {
                    const url = URL.createObjectURL(
                      new Blob([part.body || ""], {
                        type: "text/plain;charset=utf-8",
                      }),
                    );
                    const link = document.createElement("a");
                    link.href = url;
                    link.download =
                      "oneearth-preview." +
                      (part.language === "json"
                        ? "json"
                        : part.language === "javascript"
                          ? "js"
                          : "txt");
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  <Download size={14} />
                  下载
                </button>
              </div>
            </div>
            {copyError && (
              <p role="status">浏览器未能复制，可以选中文字复制或下载文件。</p>
            )}
            <pre tabIndex={0}>
              <code>{part.body}</code>
            </pre>
          </div>
        ) : part.kind === "trace" ? (
          <ol className="execution-trace">
            {part.steps?.map((step, index) => (
              <li key={index}>
                <span className="trace-number">{index + 1}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : part.kind === "table" ? (
          <>
            <table>
              <caption>
                {part.label} · {part.rows!.length.toLocaleString()} 行
              </caption>
              <thead>
                <tr>
                  {part.columns!.map((col, i) => (
                    <th key={i}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((v, j) => (
                      <td key={j} className={v === null ? "missing-value" : ""}>
                        {typeof v === "string" && /^https?:\/\//i.test(v)
                          ? <a href={v} target="_blank" rel="noreferrer">打开原始条目</a>
                          : v === null || v === "" ? "缺测" : String(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <div className="empty-state">
                当前条件下没有可展示的原始表行。
              </div>
            )}
          </>
        ) : part.kind === "pdf" && !part.pages?.length && webUrl(original) ? (
          <WebSourceReader key={original} url={original!} title={doc.title} snippet={part.body} onContent={setSourceQuote}/>
        ) : part.kind === "pdf" && !!part.pages?.length ? (
          <>
            <div className="pdf-pages">
              {part.pages!.map((p, i) => (
                <button
                  key={i}
                  aria-pressed={page === i}
                  onClick={() => {
                    setPage(i);
                    setImageError(false);
                  }}
                >
                  第 {p.number} 页 · {p.label}
                </button>
              ))}
              <div className="pdf-zoom">
                <button
                  aria-label="缩小 PDF"
                  disabled={pdfZoom <= 1}
                  onClick={() => setPdfZoom(Math.max(1, pdfZoom - 0.25))}
                >
                  <Minus size={13} />
                </button>
                <button
                  title="适应宽度"
                  aria-label="PDF 适应宽度"
                  onClick={() => setPdfZoom(1)}
                >
                  {Math.round(pdfZoom * 100)}%
                </button>
                <button
                  aria-label="放大 PDF"
                  disabled={pdfZoom >= 3}
                  onClick={() => setPdfZoom(Math.min(3, pdfZoom + 0.25))}
                >
                  <Plus size={13} />
                </button>
              </div>
            </div>
            {imageError ? (
              <p>引用页图像暂时无法加载，可以打开原始 PDF 查看。</p>
            ) : (
              <div
                className="pdf-image"
                style={{ width: `${pdfZoom * 100}%`, maxWidth: "none" }}
              >
                <img
                  src={"/evidence/" + part.pages![page].image}
                  alt={
                    doc.title + " · PDF 第 " + part.pages![page].number + " 页"
                  }
                  onError={() => setImageError(true)}
                />
                {part.pages![page].box && (
                  <span
                    className="pdf-highlight"
                    style={{
                      left: part.pages![page].box![0] * 100 + "%",
                      top: part.pages![page].box![1] * 100 + "%",
                      width: part.pages![page].box![2] * 100 + "%",
                      height: part.pages![page].box![3] * 100 + "%",
                    }}
                  />
                )}
              </div>
            )}
          </>
        ) : part.kind === "text" ? (
          <>
            <p>{part.before}</p>
            <blockquote>{part.quote || part.body}</blockquote>
            <p>{part.after}</p>
          </>
        ) : part.kind==="web" && webUrl(original) ? (
          <WebSourceReader key={original} url={original!} title={doc.title} snippet={part.body} onContent={setSourceQuote}/>

        ) : (
          <p className="evidence-explanation">
            {part.body
              ?.split(/(https?:\/\/[^\s，。；、）]+)/)
              .map((chunk, i) =>
                /^https?:/.test(chunk) ? (
                  <a key={i} href={chunk} target="_blank" rel="noreferrer">
                    来源链接 ↗
                  </a>
                ) : (
                  chunk
                ),
              )}
          </p>
        )}
      </div>
      <div className="evidence-bottom">
        {original && (
          <a href={original} title={doc.title} data-external={remoteSource?true:undefined} target="_blank" rel="noreferrer">
            {remoteSource?"在新标签页打开原始来源":"预览原始来源"}
            <ExternalLink size={12} />
          </a>
        )}
        {part.kind === "table" && part.rows!.length > pageSize && (
          <div className="table-pagination">
            <button
              aria-label="上一组"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft size={14} />
            </button>
            <span>
              {page * pageSize + 1}–
              {Math.min((page + 1) * pageSize, part.rows!.length)} /{" "}
              {part.rows!.length.toLocaleString()}
            </span>
            <button
              aria-label="下一组"
              disabled={(page + 1) * pageSize >= part.rows!.length}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}
        <button
          className="cite-button"
          disabled={(part.kind === "table" && !rows.length) || (remoteSource && !sourceQuote)}
          onClick={cite}
        >
          <Quote size={13} />
          引用到 Chat
        </button>
      </div>
    </div>
  );
}
