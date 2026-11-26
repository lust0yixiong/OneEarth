import {mergeTaskLifecycle} from "./task-lifecycle-client";
import {mergeNativeRunProcess} from "./native-summary-client";
import {workspaceReceiptAdvances} from "./published-raster-observation";
import type { Message,RunTrace } from "./types";
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

function matchingWorkspaceReceipt(message:Message) {
  const receipt=message.workspaceReceipt;
  return receipt?.turnId===message.replyTo && receipt?.effectId==="workspace:"+message.id ? receipt : undefined;
}

function mergeCancelledLifecycle(previous:Message|undefined, incoming:Message) {
  if(!previous || previous.role!=="assistant" || incoming.role!=="assistant" || previous.replyTo!==incoming.replyTo ||
    previous.taskLifecycle?.runtimePhase?.phase!=="cancelled" || incoming.taskLifecycle?.runtimePhase?.phase!=="cancelled")return;
  return mergeTaskLifecycle(previous.taskLifecycle,incoming.taskLifecycle);
}

function mergeInterrupt(previous:Message,incoming:Message):Message["nativeInterrupt"] {
  const next=incoming.nativeInterrupt, current=previous.nativeInterrupt;
  if(previous.role!=="assistant" || incoming.role!=="assistant" || previous.replyTo!==incoming.replyTo
    || !next || next.id!==previous.id)return current;
  if(!current || (current.status==="pending" && next.status!=="pending") ||
    (current.status==="unavailable" && next.status==="cancelled"))return next;
  return current;
}

function withArchivedTrace(message:Message,source:Message|undefined) {
  if(!source?.runTrace || !canAttachTrace(message,source) || source.failed || source.role!=="assistant")return message;
  const runTrace=mergeNativeRunProcess(message.id,message.runTrace,source.runTrace);
  return runTrace===message.runTrace ? message : {...message,runTrace};
}

function canAttachTrace(message:Message,source:{id:string;replyTo?:string;text:string}) {
  return message.role==="assistant" && !message.failed &&
    message.taskLifecycle?.runtimePhase?.phase==="complete" &&
    message.id===source.id && message.replyTo===source.replyTo && message.text===source.text;
}

export function mergeMessages(existing: Message[], incoming: Message[]) {
  const messages = new Map(existing.map(message => [message.id, message]));
  let changed = false;
  for (const message of incoming) {
    const previous = messages.get(message.id);
    const receipt=matchingWorkspaceReceipt(message);
    const prior=previous && matchingWorkspaceReceipt(previous);
    if (!previous || (previous.failed && !message.failed) ||
      (previous.failed && previous.retry && message.failed && !message.retry && previous.replyTo===message.replyTo) ||
      (receipt && previous.replyTo===message.replyTo && (!prior || workspaceReceiptAdvances(prior,receipt)))) {
      messages.set(message.id,withArchivedTrace(message,previous));
      changed = true;
    }else if(previous){
      const taskLifecycle=mergeCancelledLifecycle(previous,message);
      const nativeInterrupt=mergeInterrupt(previous,message);
      const enriched=withArchivedTrace(previous,message);
      if(enriched!==previous || (taskLifecycle && taskLifecycle!==previous.taskLifecycle) || nativeInterrupt!==previous.nativeInterrupt){
        messages.set(message.id,{...enriched,taskLifecycle:taskLifecycle??previous.taskLifecycle,
          nativeInterrupt,clarificationPrompt:nativeInterrupt?.kind==="question-check" ? previous.clarificationPrompt : nativeInterrupt?.prompt??previous.clarificationPrompt});
        changed=true;
      }
    }
  }
  return changed ? [...messages.values()].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id)) : existing;
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
    for (const message of messages) {
      const records=tx.objectStore("messages");
      const row={session:id,id:message.id,message};
      if(!message.nativeInterrupt && !message.workspaceEffect &&
        message.taskLifecycle?.runtimePhase?.phase!=="cancelled" && message.taskLifecycle?.runtimePhase?.phase!=="complete"){
        records.put(row);
        continue;
      }
      const existing=records.get([id,message.id]);
      existing.onsuccess=()=>{
        const previous:Message|undefined=existing.result?.message;
        if(previous && !previous.failed && message.nativeInterrupt){
          const nativeInterrupt=mergeInterrupt(previous,message);
          if(nativeInterrupt!==previous.nativeInterrupt)
            records.put({...row,message:{...previous,nativeInterrupt,clarificationPrompt:nativeInterrupt?.kind==="question-check" ? previous.clarificationPrompt : nativeInterrupt?.prompt}});
          return;
        }
        const taskLifecycle=mergeCancelledLifecycle(previous,message);
        if(previous && taskLifecycle){
          if(taskLifecycle!==previous.taskLifecycle)records.put({...row,message:{...previous,taskLifecycle}});
          return;
        }
        const prior=previous&&matchingWorkspaceReceipt(previous),next=matchingWorkspaceReceipt(message);
        if(prior && (!next || !workspaceReceiptAdvances(prior,next)))return;
        records.put({...row,message:withArchivedTrace(message,previous)});
      };
    }
    if (migrate) for (const key of workspace?.saved || []) tx.objectStore("favorites").put(true, key);
    const firstQuestion = old?.firstQuestion || messages.find((m) => m.role === "user")?.text.slice(0, 100);
    summaries.put({ id, firstQuestion, title: firstQuestion || title || old?.title || "新对话", updatedAt: Date.now() });
  };
  await completed(tx);
  return written;
}

export async function attachArchivedRunTrace(session:string,id:string,turnId:string,text:string,trace:RunTrace) {
  const db=await database(),tx=db.transaction("messages","readwrite"),records=tx.objectStore("messages");
  const existing=records.get([session,id]);
  let updated:Message|undefined;
  existing.onsuccess=()=>{
    const previous:Message|undefined=existing.result?.message;
    if(!previous || !canAttachTrace(previous,{id,replyTo:turnId,text}))return;
    const runTrace=mergeNativeRunProcess(id,previous.runTrace,trace);
    if(runTrace===previous.runTrace)return;
    updated={...previous,runTrace};
    records.put({session,id,message:updated});
  };
  await completed(tx);
  return updated;
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

// Record the run identity before its single POST. A later session only reads
// the task and archive for that identifier.
export interface ChatDelivery {
  id: string;
  attempt: import("./types").DiscoveryAttempt;
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

export async function claimWorkspaceEffect(session:string,id:string) {
  const db=await database(),tx=db.transaction("workspaces","readwrite");
  const done=completed(tx),store=tx.objectStore("workspaces"),key=["workspace-effect",session,id];
  const claimed=await result(store.get(key))===undefined;
  if(claimed)store.put(true,key);
  await done;
  return claimed;
}
