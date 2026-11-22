import {lazy, Suspense, useEffect, useRef, useState} from "react";
import {BookOpen, Code2, RotateCw} from "lucide-react";
import {readSourcePreview, type SourcePreview, type SourceQuote} from "../domain/source-preview";

const SourcePdf = lazy(() => import("./SourcePdf"));
const MarkdownReading = lazy(() => import("./MarkdownReading"));

export function WebSourceReader({url, title, snippet, onContent}: {
  url: string; title: string; snippet?: string; onContent?: (quote: SourceQuote | null) => void;
}) {
  const [source, setSource] = useState<SourcePreview>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [showMarkdownSource, setShowMarkdownSource] = useState(false);
  const contentCallback = useRef(onContent);
  contentCallback.current = onContent;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setSource(undefined);
    setLoading(true);
    setError("");
    setShowMarkdownSource(false);
    const snippetQuote = snippet?.trim() ? {body: snippet, label: "已保存的检索线索（未读取原页）", url} : null;
    contentCallback.current?.(snippetQuote);
    const timeout = setTimeout(() => controller.abort(), 90000);
    async function read() {
      const response = await fetch("/api/source-preview", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({url, refresh: attempt > 0}), signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error || "来源读取失败。");
      const preview = readSourcePreview(body);
      if (!active) return;
      setSource(preview);
      if (preview.kind === "pdf") contentCallback.current?.(null);
      else {
        const text = preview.kind === "markdown" ? preview.body : preview.paragraphs.join("\n\n");
        const label = preview.kind === "markdown" ? "Markdown 原文摘录" : preview.label;
        contentCallback.current?.(text.trim() ? {body: text.slice(0,16000), label, url: preview.url} : snippetQuote);
      }
    }
    void read().catch(reason => {
      if (active) setError(controller.signal.aborted ? "来源读取超时，请重试或打开原网页。" : reason.message || "来源读取失败。");
    }).finally(() => {clearTimeout(timeout); if (active) setLoading(false);});
    return () => { active = false; controller.abort(); clearTimeout(timeout); };
  }, [url, attempt, snippet]);

  const retry = () => setAttempt(n => n + 1);
  return <section className="web-source-preview" aria-busy={loading}>
    {loading && <p className="reader-status" role="status">正在读取来源…</p>}
    {error && <div className="source-read-error">
      <p role="status">{error}</p>
      <button onClick={retry}>重试读取</button>
    </div>}
    {source?.kind === "html" && (source.canEmbed ?
      <iframe src={source.url + new URL(url).hash} title={title+" · 网页预览"} sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="no-referrer"/> :
      <p className="reader-status" role="status">该网站限制嵌入，请在新标签页打开原始来源。</p>)}
    {source?.kind === "pdf" &&
      <Suspense fallback={<p className="reader-status">正在加载 PDF 阅读器…</p>}>
        <SourcePdf key={source.fileUrl+source.fetchedAt} url={source.fileUrl} rangeSize={source.range ? source.bytes : undefined}
          publicUrl={source.url} title={title} onContent={quote => contentCallback.current?.(quote)} onRetry={retry}/>
      </Suspense>}
    {source?.kind === "markdown" &&
      <><nav aria-label="Markdown 查看方式">
          <button aria-pressed={!showMarkdownSource} onClick={() => setShowMarkdownSource(false)}><BookOpen size={14}/>阅读</button>
          <button aria-pressed={showMarkdownSource} onClick={() => setShowMarkdownSource(true)}><Code2 size={14}/>源文</button>
          <button className="reader-reload" onClick={retry} aria-label="重新读取" title="重新读取"><RotateCw size={14}/></button>
        </nav>
        <div className="reader-stamp">Markdown{source.truncated && " · 内容已截取"}</div>
        {showMarkdownSource ? <pre className="markdown-raw"><code>{source.body}</code></pre> :
          <Suspense fallback={<p className="reader-status">正在排版…</p>}><MarkdownReading body={source.body} url={source.url}/></Suspense>}
      </>}
  </section>;
}
