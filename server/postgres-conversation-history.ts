import type { Pool } from "pg";
import type { AnswerReference, EvidenceStage } from "../src/domain/types";
import {taskIdPattern,type ConversationHistoryTurn} from "./task-store";
import {conversationTokenLimit,type ConversationHistoryRequest} from "./conversation-history";

// Text rows predate this projection. A value unrepresentable as jsonb must
// not hold up admission of unrelated messages or an index over old records.
const conversationKey = (column: "body" | "m.body" | "t.body") =>
  `(runtime_history_json(${column})->>'conversationId')`;
export const conversationHistorySchema = `
  CREATE OR REPLACE FUNCTION runtime_history_json(raw text) RETURNS jsonb
  LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
  BEGIN
    RETURN raw::jsonb;
  EXCEPTION WHEN data_exception THEN
    RETURN NULL;
  END;
  $$;
  CREATE INDEX IF NOT EXISTS runtime_chat_history_conversation ON runtime_chat_messages (${conversationKey("body")},created);
  CREATE INDEX IF NOT EXISTS runtime_task_history_conversation ON runtime_tasks (${conversationKey("body")},created);
`;

type HistoryRow = Omit<ConversationHistoryTurn,"submittedAt"|"question"|"assistantText"|"references"> & {
  submittedAt: string;
  question: string | null;
  assistantText: string | null;
  references: AnswerReference[] | null;
  webStages: [string,EvidenceStage][] | null;
};

// The 8k history estimate admits at most four ASCII bytes per token on
// alphanumeric runs. Greater strings cannot fit intact in this history zone.
const historyTextBytes=conversationTokenLimit*4;
const indexTurns=32,recentTurns=3,referenceCount=32,referenceBytes=4096;
export function postgresConversationHistory(pool:Pool) {
  return async (conversationId:string,currentTaskId:string,request?:ConversationHistoryRequest):Promise<ConversationHistoryTurn[]> => {
    if(!conversationId||!taskIdPattern.test(currentTaskId))return [];
    const selections=request?.mode==="read"?request.selections:undefined;
    if(selections&&(!selections.length||selections.length>3||selections.some(s=>!taskIdPattern.test(s.taskId))))return [];
    const ids=selections?.map(s=>s.taskId)??null,limit=ids?ids.length:indexTurns+1;
    const {rows}=await pool.query<HistoryRow>(`
      WITH current_admission AS (
        SELECT (
          SELECT seq FROM runtime_chat_events e WHERE e.id=m.id ORDER BY seq LIMIT 1
        ) AS admitted
        FROM runtime_chat_messages m WHERE id=$2 AND ${conversationKey("body")}=$1
      ), prior AS (
        SELECT m.id,m.created,first_event.seq AS admitted,false AS legacy
        FROM current_admission c
        JOIN runtime_chat_messages m ON ${conversationKey("m.body")}=$1 AND ($4::uuid[] IS NULL OR m.id=ANY($4))
          AND (m.handoff->>'kind'='workspace-discovery') IS NOT TRUE
          AND (m.terminal->'result' ? 'workspaceDiscovery') IS NOT TRUE
        JOIN LATERAL (
          SELECT seq FROM runtime_chat_events e WHERE e.id=m.id ORDER BY seq LIMIT 1
        ) first_event ON first_event.seq<c.admitted
        UNION ALL
        SELECT t.id,t.created,first_event.seq,true
        FROM current_admission c
        JOIN runtime_tasks t ON t.task_type='run' AND ${conversationKey("t.body")}=$1 AND ($4::uuid[] IS NULL OR t.id=ANY($4))
        JOIN LATERAL (
          SELECT seq FROM runtime_events e WHERE e.id=t.id ORDER BY seq LIMIT 1
        ) first_event ON first_event.seq<c.admitted
        WHERE NOT EXISTS (SELECT 1 FROM runtime_chat_messages m WHERE m.id=t.id)
      ), chosen AS MATERIALIZED (
        SELECT * FROM prior ORDER BY admitted DESC,id LIMIT $3
      ), saved AS (
        SELECT c.id,c.created,c.admitted,row_number() OVER(ORDER BY c.admitted DESC,c.id) AS position,
          COALESCE(t.status,CASE m.status WHEN 'planning' THEN 'running' WHEN 'handed_off' THEN 'queued' ELSE m.status END) AS status,
          runtime_history_json(CASE WHEN c.legacy THEN t.body ELSE m.body END) AS body,
          COALESCE(last_event.payload,m.terminal)->'result' AS result
        FROM chosen c
        LEFT JOIN runtime_chat_messages m ON m.id=c.id AND NOT c.legacy
        LEFT JOIN runtime_tasks t ON t.id=c.id
        LEFT JOIN LATERAL (
          SELECT payload FROM runtime_events e WHERE e.id=t.id AND t.status IN ('complete','failed','cancelled')
          ORDER BY seq DESC LIMIT 1
        ) last_event ON true
      ), guarded AS (
        SELECT *, $4::uuid[] IS NULL AND position>$5 AS thin,
          COALESCE(
            body ? 'observationCheck'
            OR jsonb_typeof(body#>'{context,caseObservationRef}')='object'
            OR jsonb_typeof(body#>'{context,layerObservationRef}')='object'
            OR body @> '{"context":{"attachedScope":[{"kind":"observation"}]}}'
            OR body @> '{"context":{"attachedScope":[{"reference":{"evidenceLevel":"observation-file"}}]}}'
            OR result ? 'observationCheckResult'
            OR result ? 'caseObservation'
            OR result ? 'layerObservation'
            OR result @> '{"answerNotes":{"references":[{"evidenceLevel":"observation-file"}]}}',
            false
          ) AS restricted
        FROM saved
      ), readable AS (
        SELECT *,CASE WHEN NOT restricted THEN body->>'query' END AS question,
          CASE WHEN NOT restricted AND NOT thin THEN result->>'message' END AS answer
        FROM guarded
        WHERE jsonb_typeof(body->'query')='string'
          AND (result ? 'workspaceDiscovery') IS NOT TRUE
          AND ($4::uuid[] IS NULL OR EXISTS (
            SELECT 1 FROM unnest($4::uuid[],$6::text[]) AS expected(id,turn)
            WHERE expected.id=guarded.id AND (expected.turn IS NULL OR expected.turn=body->>'turnId')
          ))
      )
      SELECT id AS "taskId",body->>'turnId' AS "turnId",created AS "submittedAt",status AS "taskState",
        CASE WHEN octet_length(question)<=CASE WHEN thin THEN 512 ELSE $7 END THEN question END AS question,
        CASE WHEN octet_length(answer)<=$7 THEN answer END AS "assistantText",
        refs.items AS "references", refs.stages AS "webStages",restricted AS "observationRestricted",
        thin AS "indexOnly",NOT restricted AND (thin OR (COALESCE(octet_length(question)>$7,false) OR COALESCE(octet_length(answer)>$7,false))) AS "bodyOmitted"
      FROM readable
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(ref ORDER BY ordinal) AS items,
          jsonb_agg(jsonb_build_array(ref->>'url',(
            SELECT source->>'stage' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(result#>'{answerNotes,webSources}')='array'
              THEN result#>'{answerNotes,webSources}' ELSE '[]'::jsonb END) WITH ORDINALITY AS sources(source,seq)
            WHERE source->>'url'=ref->>'url' AND source->>'stage' IN ('search-snippet','abstract','page-excerpt','pdf-excerpt')
            ORDER BY seq DESC LIMIT 1
          ))) FILTER (WHERE ref->>'kind'='web') AS stages
        FROM (
          SELECT ref,ordinal FROM jsonb_array_elements(CASE WHEN NOT restricted AND jsonb_typeof(result#>'{answerNotes,references}')='array'
            THEN result#>'{answerNotes,references}' ELSE '[]'::jsonb END) WITH ORDINALITY AS all_refs(ref,ordinal)
          WHERE ref->>'kind' IN ('asset','web') AND octet_length(ref::text)<=$8
          ORDER BY ordinal LIMIT CASE WHEN thin THEN 8 ELSE $9 END
        ) selected_refs
      ) refs ON true
      ORDER BY admitted,id`,
      [conversationId,currentTaskId,limit,ids,recentTurns,selections?.map(s=>s.turnId)??null,historyTextBytes,referenceBytes,referenceCount]);
    const windowLimited=!selections&&rows.length>indexTurns;
    return (windowLimited?rows.slice(-indexTurns):rows).map(({taskId,turnId,submittedAt,question,taskState,assistantText,references,webStages,observationRestricted,indexOnly,bodyOmitted},index)=>{
      const saved={taskId,...(turnId?{turnId}:{}),submittedAt:Number(submittedAt),taskState,observationRestricted};
      const flags={...(windowLimited&&index===0?{windowLimited:true as const}:{}),...(indexOnly?{indexOnly:true as const}:{}),...(bodyOmitted?{bodyOmitted:true as const}:{})};
      if(observationRestricted)return {...saved,...flags,question:"观测材料历史由独立授权路径提供。"};
      const stages=new Map(webStages||[]);
      return {...saved,...flags,question:question??"",
        ...(assistantText?{assistantText}:{}),
        ...(Array.isArray(references)?{references:references.map(reference=>{
          const stage=reference?.kind==="web"?stages.get(reference.url):undefined;
          return stage?{...reference,webEvidenceStage:stage}:reference;
        })}:{}),
      };
    });
  };
}
