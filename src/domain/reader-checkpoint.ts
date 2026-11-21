import type { EvidenceDocument } from "./types";

type Position = { tab: number; page: number } | null;
const key = "oneearth.reader-position.v1";

function documentKey(doc: EvidenceDocument) {
  return JSON.stringify([doc.id, doc.version, doc.scope, doc.url, doc.tabs.map(t => [t.kind, t.label, t.version, t.url])]);
}

// IndexedDB may still be committing the full workspace when the user reloads.
// This tab-local record only restores the same session and material.
export function saveReaderCheckpoint(sessionId: string, doc: EvidenceDocument | null, position: Position) {
  const checkpoint = { sessionId, document: doc ? documentKey(doc) : null, position };
  sessionStorage.setItem(key, JSON.stringify(checkpoint));
}

export function restoreReaderCheckpoint(sessionId: string, doc: EvidenceDocument | null, saved: Position) {
  let checkpoint;
  try {
    checkpoint = JSON.parse(sessionStorage.getItem(key) || "null");
  } catch {
    return saved;
  }
  if (!doc || checkpoint?.sessionId !== sessionId || checkpoint.document !== documentKey(doc)) return saved;
  const position = checkpoint.position;
  return position === null || (Number.isSafeInteger(position?.tab) && position.tab >= 0 &&
    position.tab < doc.tabs.length && Number.isSafeInteger(position.page) && position.page >= 0) ? position as Position : saved;
}
