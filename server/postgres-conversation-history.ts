import type { Pool } from "pg";
import type { AnswerReference, EvidenceStage } from "../src/domain/types";
import {taskIdPattern,type ConversationHistoryTurn} from "./task-store";

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

type HistoryRow = Omit<ConversationHistoryTurn,"submittedAt"|"references"> & {
  submittedAt: string;
  references: AnswerReference[] | null;
  webStages: [string,EvidenceStage][] | null;
};

export function postgresConversationHistory(pool:Pool) {
  return async (conversationId:string,currentTaskId:string):Promise<ConversationHistoryTurn[]> => {
    if(!conversationId||!taskIdPattern.test(currentTaskId))return [];
    const {rows}=await pool.query<HistoryRow>(`
      WITH current_admission AS (
        SELECT (
          SELECT seq FROM runtime_chat_events e WHERE e.id=m.id ORDER BY seq LIMIT 1
        ) AS admitted
        FROM runtime_chat_messages m WHERE id=$2 AND ${conversationKey("body")}=$1
      ), prior AS (
        SELECT m.id,m.body,m.created,
          COALESCE(t.status,CASE m.status WHEN 'planning' THEN 'running' WHEN 'handed_off' THEN 'queued' ELSE m.status END) AS status,
          COALESCE(last_event.payload,m.terminal) AS terminal,first_event.seq AS admitted
        FROM current_admission c
        JOIN runtime_chat_messages m ON ${conversationKey("m.body")}=$1
        JOIN LATERAL (
          SELECT seq FROM runtime_chat_events e WHERE e.id=m.id ORDER BY seq LIMIT 1
        ) first_event ON first_event.seq<c.admitted
        LEFT JOIN runtime_tasks t ON t.id=m.id
        LEFT JOIN LATERAL (
          SELECT payload FROM runtime_events e WHERE e.id=t.id AND t.status IN ('complete','failed','cancelled')
          ORDER BY seq DESC LIMIT 1
        ) last_event ON true
        UNION ALL
        SELECT t.id,t.body,t.created,t.status,last_event.payload,first_event.seq
        FROM current_admission c
        JOIN runtime_tasks t ON ${conversationKey("t.body")}=$1
        JOIN LATERAL (
          SELECT seq FROM runtime_events e WHERE e.id=t.id ORDER BY seq LIMIT 1
        ) first_event ON first_event.seq<c.admitted
        LEFT JOIN LATERAL (
          SELECT payload FROM runtime_events e WHERE e.id=t.id AND t.status IN ('complete','failed','cancelled')
          ORDER BY seq DESC LIMIT 1
        ) last_event ON true
        WHERE NOT EXISTS (SELECT 1 FROM runtime_chat_messages m WHERE m.id=t.id)
      ), saved AS (
        SELECT id,created,admitted,status,runtime_history_json(body) AS body,terminal->'result' AS result
        FROM prior
      )
      SELECT id AS "taskId",body->>'turnId' AS "turnId",created AS "submittedAt",status AS "taskState",
        body->>'query' AS question,result->>'message' AS "assistantText",
        result#>'{answerNotes,references}' AS "references",
        (SELECT jsonb_agg(jsonb_build_array(source->>'url',source->>'stage'))
         FROM jsonb_array_elements(CASE WHEN jsonb_typeof(result#>'{answerNotes,webSources}')='array'
           THEN result#>'{answerNotes,webSources}' ELSE '[]'::jsonb END) AS source
         WHERE source->>'stage' IN ('search-snippet','abstract','page-excerpt','pdf-excerpt')) AS "webStages",
        COALESCE(
          body ? 'observationCheck'
          OR body @> '{"context":{"attachedScope":[{"kind":"observation"}]}}'
          OR body @> '{"context":{"attachedScope":[{"reference":{"evidenceLevel":"observation-file"}}]}}'
          OR result ? 'observationCheckResult'
          OR result @> '{"answerNotes":{"references":[{"evidenceLevel":"observation-file"}]}}',
          false
        ) AS "observationRestricted"
      FROM saved WHERE jsonb_typeof(body->'query')='string' ORDER BY admitted`,
      [conversationId,currentTaskId]);
    return rows.map(({taskId,turnId,submittedAt,question,taskState,assistantText,references,webStages,observationRestricted})=>{
      const saved={taskId,...(turnId?{turnId}:{}),submittedAt:Number(submittedAt),taskState,observationRestricted};
      if(observationRestricted)return {...saved,question:"观测材料历史由独立授权路径提供。"};
      const stages=new Map(webStages||[]);
      return {...saved,question,
        ...(assistantText?{assistantText}:{}),
        ...(Array.isArray(references)?{references:references.map(reference=>{
          const stage=reference?.kind==="web"?stages.get(reference.url):undefined;
          return stage?{...reference,webEvidenceStage:stage}:reference;
        })}:{}),
      };
    });
  };
}
