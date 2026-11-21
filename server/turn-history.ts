import {validResearchIntent,type ResearchIntent} from "../src/domain/research-intent";
import {validReadEvidence} from "../src/domain/read-evidence";
import {validConversationReferences} from "../src/domain/reference-memory";
import {validAssertionEvidenceMemory,type AssertionEvidenceMemory} from "../src/domain/assertion-evidence-memory";
import type { AnswerReference, ReadEvidence } from "../src/domain/types";

export type TurnHistoryEntry = {researchIntent?:ResearchIntent;role:"assistant" | "user"; text:string; assetIds?:string[];conversationContext?:string;conversationEvidence?:ReadEvidence[];conversationAssertionEvidence?:AssertionEvidenceMemory[];conversationReferences?:AnswerReference[]};
export function validHistory(x:unknown): x is TurnHistoryEntry[] {
  return Array.isArray(x) && x.length <= 8 && validConversationReferences(x.flatMap(t=>Array.isArray(t?.conversationReferences)?t.conversationReferences:[])) && x.every(t=>t && ["user","assistant"].includes(t.role) && typeof t.text==="string" && t.text.length<=1600 &&
    (t.researchIntent===undefined || (t.role==="assistant" && validResearchIntent(t.researchIntent))) &&
    (t.conversationContext===undefined || (t.role==="assistant" && typeof t.conversationContext==="string" && t.conversationContext.length<=1600)) &&
    (t.conversationEvidence===undefined || (t.role==="assistant" && validReadEvidence(t.conversationEvidence))) &&
    (t.conversationAssertionEvidence===undefined || (t.role==="assistant" && validAssertionEvidenceMemory(t.conversationAssertionEvidence))) &&
    (t.conversationReferences===undefined || (t.role==="assistant" && validConversationReferences(t.conversationReferences))) &&
    (t.assetIds===undefined || (Array.isArray(t.assetIds) && t.assetIds.length<=100 && t.assetIds.every((id:unknown)=>typeof id==="string" && id.length<=500))));
}
