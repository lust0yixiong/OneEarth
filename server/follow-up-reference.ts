import type { AnswerReference, DiscoveryResponse } from "../src/domain/types";

export type NumberedReference = {
  ordinal:number;
  scope:"literature"|"citations";
  reference:AnswerReference | undefined;
};

const chinese="零一二三四五六七八九";
function positiveOrdinal(raw:string) {
  if(/^\d+$/.test(raw))return Number(raw);
  if(raw==="两")return 2;
  if(raw.includes("十")){
    const [tens,ones]=raw.split("十");
    return (tens ? chinese.indexOf(tens) : 1)*10 + (ones ? chinese.indexOf(ones) : 0);
  }
  return chinese.indexOf(raw);
}

/** Resolve a single explicit reference against the server's stored answer. */
export function numberedReference(question:string,prior?:DiscoveryResponse):NumberedReference|undefined{
  const refs=prior?.answerNotes?.references;
  if(!refs)return;
  const q=question.normalize("NFKC");
  const markers=/第\s*([零一二两三四五六七八九十\d]{1,3})\s*(?:(篇|条|个|项|号)\s*)?(论文|文献|文章|引用|来源|依据)|(?:引用|来源|依据)\s*(?:编号\s*)?(?:#\s*)?(\d{1,3})|〔(\d{1,3})〕|\b(?:reference|citation|source)\s*#\s*(\d{1,3})\b/giu;
  const matches=[...q.matchAll(markers)];
  if(matches.length!==1)return;
  const match=matches[0];
  const ordinal=positiveOrdinal(match[1]||match[4]||match[5]||match[6]);
  if(!Number.isInteger(ordinal)||ordinal<1)return;
  const scope=match[3]&&/论文|文献|文章/.test(match[3]) ? "literature" : "citations";
  const ordered=scope==="literature" ? refs.filter(ref=>ref.kind==="asset"&&ref.sourceChannel==="assertion") : refs;
  return {ordinal,scope,reference:ordered[ordinal-1]};
}
