import type {SearchRun} from "../src/domain/types";

export function sourceReadReceipts(runs:SearchRun[]){
  return runs.filter(run=>["原站读取","PDF 原文","DeepSeek Fetch"].includes(run.engine)&&
    run.status!=="running"&&!run.cacheStoredAt).map(run=>({
      source:run.requestUrl||run.query,engine:run.engine,status:run.status,
      excerpts:run.hits.filter(hit=>!!hit.pageExcerpt&&!hit.previousRead).length,
    }));
}

export class SourceReadClaimError extends Error {
  constructor(){super("答复称本轮打开或读取来源，但没有对应的当轮读取事件。");}
}

/** The events are authoritative for an action the assistant claims it performed. */
export function validateSourceReadClaim(answer:{message:string;limitation:string;followUp:string},receipts:ReturnType<typeof sourceReadReceipts>){
  if(receipts.length)return;
  const claim=/(?:本轮|此次|这次|刚刚)(?:(?:我|系统|助手|实际|已经|已|尝试|也|又|重新|直接|先)\s*){0,6}(?:打开|访问|读取|查阅|核读|读过|读了|看过|查看了)|\b(?:I|we)\s+(?:actually\s+|just\s+)?(?:opened|read|accessed|visited)\b[^.!?\n]{0,90}\b(?:this turn|this time|just now)\b/i;
  if(claim.test([answer.message,answer.limitation,answer.followUp].join("\n")))throw new SourceReadClaimError();
}
