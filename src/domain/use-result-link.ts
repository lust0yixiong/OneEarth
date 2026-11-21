import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { randomId } from "./id";
import { makeCandidates } from "./results";
import {
  loadResultSnapshot,
  snapshotMaxBytes,
  snapshotResult,
} from "./result-snapshot";
import type { State } from "./store";

function setLink(id: string | null) {
  const url = new URL(location.href);
  if (url.searchParams.get("result") === id) return;
  if (id) url.searchParams.set("result", id);
  else url.searchParams.delete("result");
  history.replaceState(
    { ...history.state, oneearthPath: url.pathname + url.search },
    "",
    url,
  );
}

function capture(s: State) {
  if (s.linkStatus || s.view === "cases" || s.visualization || s.fieldLayer || s.dataView)
    return null;
  const scope = {
    caseId: s.caseId,
    filters: s.filters,
    selection: s.selection,
    gridSystem: s.gridSystem,
    layer: s.layer,
    camera: s.camera,
  };
  let batch = s.view === "discover" ? s.search.result : s.mapResult;
  // Catalogue pages are live server queries. Immutable links belong to an
  // explicit research/map batch and must not materialize an entire index.
  if(!batch&&s.view==="discover")return null;
  if (
    !batch &&
    s.view === "earth" &&
    s.overview === "catalog" &&
    s.selection &&
    !s.selection.simulated
  )
    batch = makeCandidates({
      ...scope,
      title: "所选网格的候选数据",
      originKind: "grid",
    });
  if (!batch && s.view === "earth" && s.caseId) {
    const last = s.search.result;
    if (
      last?.caseId === s.caseId &&
      last.layer === scope.layer &&
      last.selection?.id === scope.selection?.id &&
      JSON.stringify(last.filters) === JSON.stringify(scope.filters)
    )
      batch = last;
  }
  if (!batch) return null;
  const search =
    s.view === "discover" || s.search.result === batch
      ? s.search
      : {
          query: "",
          type: "",
          source: "",
          kind: "all" as const,
          savedOnly: false,
          compare: s.search.compare,
          result: batch,
        };
  return JSON.stringify(snapshotResult(s.view, batch, scope, search, s.saved));
}

export function useResultLink(
  s: State,
  patch: (value: Partial<State>) => void,
) {
  const [notice, setNotice] = useState("");
  const [writes, retry] = useState(0);
  const writing = useRef<{
    raw: string | null | undefined;
    id: string;
    session: string;
  } | null>(null);
  const existing = useRef<{ raw: string; id: string } | null>(null);
  const captureState = useMemo(() => s, [
    s.linkStatus,
    s.view,
    s.caseId,
    s.filters,
    s.selection,
    s.gridSystem,
    s.layer,
    s.camera,
    s.mapResult,
    s.search,
    s.visualization,
    s.fieldLayer?.id,
    s.dataView,
    s.saved,
    s.overview,
  ]);

  const [payload,setPayload]=useState<{state:State;raw?:string|null;error?:string}|null>(null);
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>|undefined,cancelled=false;
    // Let the selection paint first. Its candidate calculation warms the shared
    // cache; immutable-link capture then reuses those exact identities.
    const frame=requestAnimationFrame(()=>{timer=setTimeout(()=>{
      if(cancelled)return;
      try{setPayload({state:captureState,raw:capture(captureState)});}
      catch(e){setPayload({state:captureState,error:e instanceof Error?e.message:"无法记录这批资料。"});}
    },0);});
    return ()=>{cancelled=true;cancelAnimationFrame(frame);clearTimeout(timer);};
  },[captureState]);

  useEffect(() => {
    if (s.linkStatus !== "loading") return;
    const id = new URL(location.href).searchParams.get("result") || "";
    const controller = new AbortController();
    const current = () =>
      !controller.signal.aborted &&
      new URL(location.href).searchParams.get("result") === id;
    void loadResultSnapshot(id, controller.signal)
      .then((snapshot) => {
        if (!current()) return;
        existing.current = { id, raw: JSON.stringify(snapshot) };
        if (
          s.resumeLinkedWorkspace &&
          capture({ ...s, linkStatus: null }) === existing.current.raw
        ) {
          patch({
            linkStatus: null,
            error: null,
            resumeLinkedWorkspace: false,
          });
          return;
        }
        patch({
          ...snapshot.scope,
          ...(s.fieldLayer ? {fieldLayer: s.fieldLayer, camera: s.camera} : {}),
          view: snapshot.view,
          linkStatus: null,
          error: null,
          overview: "catalog",
          search: { ...snapshot.catalog, result: snapshot.batch },
          mapResult: snapshot.view === "earth" ? snapshot.batch : null,
          inspector: s.inspector,
          evidence: s.evidence,
          citation: s.citation,
          readerPosition: s.readerPosition,
          origin: s.origin,
          listLibraryOpen: s.listLibraryOpen,
          resumeLinkedWorkspace: false,
          visualization: null,
          dataView: null,
        });
      })
      .catch((e) => {
        if (current())
          patch({
            linkStatus: "failed",
            error:
              e instanceof TypeError
                ? "无法连接结果服务，请检查连接后重试。"
                : String(e.message || e),
          });
      });
    return () => controller.abort();
  }, [s.linkStatus, s.sessionId, patch]);

  useLayoutEffect(() => {
    if (s.linkStatus) return;
    // A layer opened from a shared result keeps that result address: the
    // snapshot describes the batch, while ?viz describes the layer on top.
    if (s.fieldLayer && new URL(location.href).searchParams.has("result")) {
      setNotice("");
      return;
    }
    if(payload?.state!==captureState){
      // Never leave a previous selection's URL available during capture.
      setLink(null);writing.current=null;setNotice("");return;
    }
    const raw = payload.raw;
    if (!raw && !payload.error) {
      setLink(null);
      existing.current = null;
      writing.current = null;
      setNotice("");
      return;
    }
    if (raw && existing.current?.raw === raw) {
      setLink(existing.current.id);
      setNotice("");
      return;
    }
    const previous = writing.current;
    const id =
      previous && previous.session === s.sessionId && previous.raw === raw
        ? previous.id
        : randomId();
    writing.current = { raw, id, session: s.sessionId };
    if (!raw || new Blob([raw]).size > snapshotMaxBytes) {
      // A batch too large to persist has no shared result to open on reload.
      // Keep the local workspace address instead of publishing a missing ID.
      setLink(null);
      setNotice(
        payload.error ||
          "这批结果超过链接存储上限，请缩小候选范围或导出研究清单。",
      );
      return;
    }
    setLink(id);
    let current = true;
    setNotice("正在保存结果链接…");
    // Complete the immutable write even after navigation. The address may already have been copied.
    void fetch("/api/results/" + id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: raw,
      keepalive: new Blob([raw]).size < 60000,
    })
      .then(async (res) => {
        if (!res.ok)
          throw Error((await res.json()).error || "HTTP " + res.status);
        if (current) {
          existing.current = { id, raw };
          setNotice("");
        }
      })
      .catch((e) => {
        if (current)
          setNotice(
            "结果链接尚未保存：" +
              (e instanceof TypeError ? "无法连接结果服务。" : e.message),
          );
      });
    return () => {
      current = false;
    };
  }, [s.linkStatus, s.sessionId, captureState, payload, writes]);

  return { notice, retry: () => retry((n) => n + 1) };
}
