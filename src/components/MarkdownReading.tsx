import { memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default memo(function MarkdownReading({body, url}: {body: string; url: string}) {
  return <article className="markdown-reading" data-source-kind="markdown">
    <Markdown remarkPlugins={[remarkGfm]} skipHtml
      urlTransform={raw => {
        try {
          const target = new URL(raw, url);
          return /^https?:$/.test(target.protocol) && !target.username && !target.password ? target.href : "";
        } catch { return ""; }
      }}
      components={{
        img: ({src, alt}) => typeof src === "string" && src ? <a href={src} data-external target="_blank" rel="noreferrer">{alt || "查看图片"} ↗</a> : null,
        table: ({children}) => <div className="markdown-table"><table>{children}</table></div>,
      }}
    >{body}</Markdown>
  </article>;
});
