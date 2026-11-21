import type { Message } from "./types";
import type { WorkspaceSnapshot } from "./store";

const databaseName = "oneearth.sessions.v1";
export const legacySession = "legacy-workspace-v1";

export interface SessionSummary {
  id: string;
  title: string;
  firstQuestion?: string;
  updatedAt: number;
}
export interface SessionRecord {
  workspace: WorkspaceSnapshot;
  messages: Message[];
}

let connection: Promise<IDBDatabase> | undefined;
function database() {
  if (!connection) {
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(databaseName, 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore("sessions", { keyPath: "id" });
        db.createObjectStore("workspaces");
        const messages = db.createObjectStore("messages", { keyPath: ["session", "id"] });
        messages.createIndex("session", "session");
        db.createObjectStore("favorites");
      };
      open.onsuccess = () => {
        open.result.onversionchange = () => { open.result.close(); connection = undefined; };
        resolve(open.result);
      };
      open.onerror = () => reject(open.error);
    }).catch((error) => { connection = undefined; throw error; });
  }
  return connection;
}
function completed(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || Error("会话存储写入中断"));
    tx.onerror = () => reject(tx.error);
  });
}
function result<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function mergeMessages(existing: Message[], incoming: Message[]) {
  const ids = new Set(existing.map((m) => m.id));
  const additions = incoming.filter((m) => !ids.has(m.id));
  return additions.length
    ? [...existing, ...additions].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
    : existing;
}
export async function sessionSummaries(): Promise<SessionSummary[]> {
  const db = await database();
  const rows: SessionSummary[] = await result(db.transaction("sessions").objectStore("sessions").getAll());
  return rows.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}
function messagesIn(tx: IDBTransaction, id: string): Promise<Message[]> {
  return result(tx.objectStore("messages").index("session").getAll(id)).then((rows) =>
    mergeMessages([], rows.map((row) => row.message)),
  );
}
export async function sessionMessages(id: string) {
  const db = await database();
  return messagesIn(db.transaction("messages"), id);
}
export async function readSessionMessage(sessionId: string, id: string): Promise<Message | null> {
  const db = await database();
  const row = await result(db.transaction("messages").objectStore("messages").get([sessionId, id]));
  return row?.message || null;
}
export async function readSession(id: string): Promise<SessionRecord | null> {
  const db = await database();
  const tx = db.transaction(["workspaces", "messages"]);
  const [workspace, messages] = await Promise.all([
    result(tx.objectStore("workspaces").get(id)), messagesIn(tx, id),
  ]);
  return workspace ? { workspace, messages } : null;
}

// Each message has its own primary key. Two tabs can commit to the same
// conversation without replacing either the other tab's log or its workspace.
export async function writeSession(
  id: string, title: string, workspace?: WorkspaceSnapshot, messages: Message[] = [], migrate = false,
) {
  const db = await database();
  const stores = ["sessions", ...(workspace ? ["workspaces"] : []), ...(messages.length ? ["messages"] : []), ...(migrate ? ["favorites"] : [])];
  const tx = db.transaction(stores, "readwrite");
  const summaries = tx.objectStore("sessions");
  const previous = summaries.get(id);
  let written = false;
  previous.onsuccess = () => {
    const old: SessionSummary | undefined = previous.result;
    if (migrate && old) return;
    written = true;
    if (workspace) tx.objectStore("workspaces").put(workspace, id);
    for (const message of messages) tx.objectStore("messages").put({ session: id, id: message.id, message });
    if (migrate) for (const key of workspace?.saved || []) tx.objectStore("favorites").put(true, key);
    const firstQuestion = old?.firstQuestion || messages.find((m) => m.role === "user")?.text.slice(0, 100);
    summaries.put({ id, firstQuestion, title: firstQuestion || title || old?.title || "新对话", updatedAt: Date.now() });
  };
  await completed(tx);
  return written;
}

export async function readFavorites(): Promise<string[]> {
  const db = await database();
  return (await result(db.transaction("favorites").objectStore("favorites").getAllKeys())).map(String);
}
export async function writeFavorite(id: string, selected: boolean) {
  const db = await database();
  const tx = db.transaction("favorites", "readwrite");
  const store = tx.objectStore("favorites");
  if (selected) store.put(true, id);
  else store.delete(id);
  await completed(tx);
}

// Keep each unfinished submission beside its session, under a separate compound
// key so simultaneous tabs cannot overwrite each other's requests.
export interface ChatDelivery {
  id: string;
  attempt: import("./types").DiscoveryAttempt;
  body: string;
}
export async function saveChatDelivery(session: string, delivery: ChatDelivery) {
  const db = await database();
  const tx = db.transaction("workspaces", "readwrite");
  tx.objectStore("workspaces").put(delivery, [session, delivery.id]);
  await completed(tx);
}
export async function unfinishedChatDeliveries(session: string): Promise<ChatDelivery[]> {
  const db = await database();
  const keys = IDBKeyRange.bound([session], [session, []]);
  return result(db.transaction("workspaces").objectStore("workspaces").getAll(keys));
}
export async function removeChatDelivery(session: string, id: string) {
  const db = await database();
  const tx = db.transaction("workspaces", "readwrite");
  tx.objectStore("workspaces").delete([session, id]);
  await completed(tx);
}

export async function readResearchPdf(id:string):Promise<Blob|undefined> {
  const db=await database();
  return result(db.transaction("workspaces").objectStore("workspaces").get(["research-pdf",id]));
}
export async function saveResearchPdf(id:string,pdf:Blob) {
  const db=await database(), tx=db.transaction("workspaces","readwrite");
  tx.objectStore("workspaces").put(pdf,["research-pdf",id]);
  await completed(tx);
}
