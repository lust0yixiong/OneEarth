import type {Pool,PoolClient} from "pg";
import type {ToolCall} from "@ag-ui/core";
import {
  cataloguePresentationTarget,type CataloguePresentation,type CataloguePresentationWrite,
} from "../src/domain/catalogue-presentation";
import {matchesWorkspaceToolCall,workspaceToolCall} from "../src/domain/native-workspace-tool";
import type {DiscoveryResponse} from "../src/domain/types";
import {TaskConflict} from "./task-store";

export const cataloguePresentationSchema=`
  CREATE TABLE IF NOT EXISTS runtime_catalogue_presentations (
    run_id uuid PRIMARY KEY REFERENCES runtime_agui_runs(id),
    presentation jsonb NOT NULL
  );
`;

type Transaction=<T>(work:(db:PoolClient)=>Promise<T>)=>Promise<T>;
type Query=Pick<Pool,"query">;
type Owner={conversationId:string;turnId:string};

async function savedPresentation(db:Query,id:string) {
  const {rows:[saved]}=await db.query<{presentation:CataloguePresentation}>(
    "SELECT presentation FROM runtime_catalogue_presentations WHERE run_id=$1",[id]);
  return saved?.presentation;
}

async function completedResult(db:PoolClient,id:string) {
  const {rows:[row]}=await db.query<{body:string;result:DiscoveryResponse|null}>(`
    SELECT COALESCE(t.body,m.body) AS body,
      CASE WHEN t.status='complete' THEN (
        SELECT e.payload->'result' FROM runtime_events e
        WHERE e.id=t.id AND NOT(e.payload ? 'cancellationReceipt')
          AND NOT(e.payload ? 'remoteStop' AND NOT(e.payload ? 'error' OR e.payload ? 'result'))
        ORDER BY e.seq DESC LIMIT 1
      ) WHEN t.id IS NULL AND m.status='complete' THEN m.terminal->'result' END AS result
    FROM runtime_chat_messages m LEFT JOIN runtime_tasks t ON t.id=m.id WHERE m.id=$1
  `,[id]);
  return row?.result ? {body:JSON.parse(row.body) as Owner,result:row.result} : undefined;
}

export function postgresCataloguePresentation(pool:Pool,transaction:Transaction) {
  return {
    read:(id:string)=>savedPresentation(pool,id),
    async write(id:string,input:CataloguePresentationWrite):Promise<CataloguePresentation|undefined> {
      return transaction(async db=>{
        // Every writer serializes on the original native run, including the first insert.
        const {rows:[run]}=await db.query<Owner&{workspaceCall:ToolCall|null}>(`
          SELECT thread_id AS "conversationId",turn_id AS "turnId",workspace_call AS "workspaceCall"
          FROM runtime_agui_runs WHERE id=$1 AND terminal FOR UPDATE
        `,[id]);
        if(!run||run.conversationId!==input.conversationId||run.turnId!==input.turnId||!run.workspaceCall)return;
        const {conversationId,turnId,workspaceCall}=run;
        const completed=await completedResult(db,id);
        if(!completed||completed.body.conversationId!==conversationId||completed.body.turnId!==turnId)return;
        const target=cataloguePresentationTarget(completed.result,{runId:id,conversationId,turnId});
        if(!target||input.batchId!==target.batchId||input.coverageRevision!==target.coverageRevision)return;
        const operation=completed.result.workspaceOperation;
        const expected=workspaceToolCall(id,completed.result);
        if(operation?.kind!=="present-catalogue"||operation.batchId!==target.batchId||!expected||
          !matchesWorkspaceToolCall(workspaceCall,expected))return;
        const allowed=new Map(target.items.map(item=>[item.datasetId,item.version]));
        const latest=Date.now()+10_000;
        if(input.items.some(item=>allowed.get(item.datasetId)!==item.version||item.observedAt>latest))return;

        const prior=await savedPresentation(db,id);
        const collected=new Map(prior?.items.map(item=>[item.datasetId,item]));
        if(input.items.some(item=>{
          const previous=collected.get(item.datasetId);
          return previous && previous.state!==item.state;
        }))throw new TaskConflict("原目录项已有不同终态，整份回执未写入。");
        for(const item of input.items)if(!collected.has(item.datasetId))collected.set(item.datasetId,item);
        if(prior && collected.size===prior.items.length)return prior;

        const presentation:CataloguePresentation={...target,
          items:target.items.flatMap(item=>collected.get(item.datasetId)??[])};
        await db.query(`INSERT INTO runtime_catalogue_presentations(run_id,presentation) VALUES($1,$2)
          ON CONFLICT(run_id) DO UPDATE SET presentation=EXCLUDED.presentation`,[id,presentation]);
        return presentation;
      });
    },
  };
}

export type CataloguePresentationStore=ReturnType<typeof postgresCataloguePresentation>;
