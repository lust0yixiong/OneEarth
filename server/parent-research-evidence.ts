import type {AssertionEvidenceMemory} from "../src/domain/assertion-evidence-memory";
import type {AnswerReference,DiscoveryResponse,ReadEvidence} from "../src/domain/types";
import type {TurnPlan} from "./turn-planning";

export type ParentResearchEvidence = {
  references: AnswerReference[];
  readings: ReadEvidence[];
  assertions: AssertionEvidenceMemory[];
};

const normalizedName = (name:string) => name.normalize("NFKC").toLowerCase().replace(/\s+/gu," ").trim();

export function parentResearchEvidence(prior:DiscoveryResponse|undefined,plan:TurnPlan,question:string):ParentResearchEvidence|undefined {
  if (plan.action!=="respond" || plan.evidenceNeed!=="existing" || !prior?.answerNotes?.references) return;
  const priorRefs=prior.answerNotes.references;
  const selectedIds=new Set(plan.targets.flatMap(target=>target.id?[target.id]:[]));
  const selectedUrls=new Set(plan.targets.flatMap(target=>target.url?[target.url]:[]));
  const normalizedQuestion=normalizedName(question);
  const namedRefs=priorRefs.filter(ref=>{
    const title=normalizedName(ref.title);
    return title.length>=4 && normalizedQuestion.includes(title);
  });
  const candidates=plan.targets.length ? priorRefs.filter(ref=>ref.kind==="asset"?selectedIds.has(ref.id):selectedUrls.has(ref.url))
    : namedRefs.length?namedRefs:priorRefs;
  const ids=new Set(candidates.flatMap(ref=>ref.kind==="asset"?[ref.id]:[]));
  const urls=new Set(candidates.flatMap(ref=>ref.kind==="web"?[ref.url]:[]));
  const readings=(prior.conversationEvidence||[]).filter(read=>urls.has(read.url)&&read.stage!=="search-snippet"&&!!read.excerpt.trim());
  const assertions=(prior.conversationAssertionEvidence||[]).filter(read=>ids.has(read.assetId)&&!!read.quote.trim());
  const references=candidates.filter(ref=>ref.kind==="asset"?assertions.some(read=>read.assetId===ref.id):readings.some(read=>read.url===ref.url));
  return references.length?{references,readings,assertions}:undefined;
}
