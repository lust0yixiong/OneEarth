import { validPaperRecord } from "../src/domain/paper-record";
import type { paperCache } from "./earthnano";

type Query = (sql: string) => Promise<{rows: Record<string, unknown>[]}>;
type Cache = Pick<ReturnType<typeof paperCache>, "needsCatalogRecovery" | "restoreFromDiscovery">;

export async function restoreDiscoveryPaperCache(cache: Cache, query: Query) {
  const history = (await query("SELECT record FROM discovery_papers")).rows
    .map(row => row.record).filter(validPaperRecord);
  // The exact-ID table retains the first copy of an ID and has no publication order.
  // Only completed discovery events can reconstruct the order of replayable results.
  // Direct catalogue publications absent from SQLite cannot be recovered from these events.
  const terminalRecords = cache.needsCatalogRecovery()
    ? (await query(`
        SELECT terminal.payload->'result'->'papers' AS papers
        FROM discovery_tasks task
        JOIN LATERAL (
          SELECT seq,payload FROM discovery_events WHERE id=task.id ORDER BY seq DESC LIMIT 1
        ) terminal ON true
        WHERE task.status='complete' AND jsonb_typeof(terminal.payload->'result'->'papers')='array'
        ORDER BY terminal.seq
      `)).rows.flatMap(row => Array.isArray(row.papers) ? row.papers.filter(validPaperRecord) : [])
    : [];
  cache.restoreFromDiscovery(history, terminalRecords);
}
