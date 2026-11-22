import type {SearchRun} from "../src/domain/types";

export function sourceReadReceipts(runs:SearchRun[]){
  return runs.filter(run=>["原站读取","PDF 原文","DeepSeek Fetch"].includes(run.engine)&&
    run.status!=="running"&&!run.cacheStoredAt).map(run=>({
      source:run.requestUrl||run.query,engine:run.engine,status:run.status,
      excerpts:run.hits.filter(hit=>!!hit.pageExcerpt&&!hit.previousRead).length,
    }));
}

export class SourceReadClaimError extends Error {
  constructor(message="答复称本轮打开或读取来源，但没有对应的当轮读取事件。"){super(message);}
}

/** The events are authoritative for an action the assistant claims it performed. */
export function validateSourceReadClaim(answer:{message:string;limitation:string;followUp:string},receipts:ReturnType<typeof sourceReadReceipts>,searched=false){
  const claim=/(?:本轮|此次|这次|刚刚)(?:(?:我|系统|助手|实际|已经|已|尝试|也|又|重新|直接|先)\s*){0,6}(?:打开|访问|读取|查阅|核读|读过|读了|看过|查看了)|\b(?:I|we)\s+(?:actually\s+|just\s+)?(?:opened|read|accessed|visited)\b[^.!?\n]{0,90}\b(?:this turn|this time|just now)\b/i;
  const text=[answer.message,answer.limitation,answer.followUp].join("\n");
  if(!receipts.length&&claim.test(text))throw new SourceReadClaimError();
  const searchClaim=/(?:补充|定向|进一步|再次|本轮(?:我|已)?)\s*(?:检索|搜索|查找)[^。！？\n]{0,24}(?:返回|查到|搜到|命中|结果)|\b(?:I|we)\s+(?:also\s+|then\s+)?(?:searched|looked for)\b/i;
  if(!searched&&searchClaim.test(text))throw new SourceReadClaimError("答复描述了未发生的检索，请只报告实际原文读取或历史证据。");
}
