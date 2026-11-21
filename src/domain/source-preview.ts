export type SourceQuote={body:string;label:string;url:string;page?:number};
type PreviewBase={originalUrl:string;url:string;title:string;fetchedAt:string;bytes:number};
export type SourcePreview =
  | PreviewBase & {kind:"html";paragraphs:string[];label:string;truncated:boolean;canEmbed:boolean;links:{title:string;url:string}[];pdfLinks:{title:string;url:string}[]}
  | PreviewBase & {kind:"markdown";body:string;truncated:boolean}
  | PreviewBase & {kind:"pdf";fileUrl:string;range?:boolean};

export function readSourcePreview(value:unknown):SourcePreview{
  const v=value as SourcePreview|null;
  if(!v || !['html','pdf','markdown'].includes(v.kind) || typeof v.title!=="string" || typeof v.url!=="string" || typeof v.originalUrl!=="string" || typeof v.fetchedAt!=="string")throw Error("来源预览返回格式异常。");
  if(v.kind==="pdf"){
    if(!/^\/api\/source-preview\/files\/[a-f0-9]{64}\.pdf$/.test(v.fileUrl))throw Error("PDF 预览地址无效。");
  }else if(v.kind==="markdown"){
    if(typeof v.body!=="string")throw Error("Markdown 内容返回格式异常。");
  }else if(!Array.isArray(v.paragraphs) || !v.paragraphs.every(p=>typeof p==="string") || !Array.isArray(v.pdfLinks) || !Array.isArray(v.links))throw Error("网页内容返回格式异常。");
  return v;
}
