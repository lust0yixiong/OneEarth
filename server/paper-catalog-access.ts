import {literatureDisplay} from "../src/domain/literature-label";
import {randomUUID} from "node:crypto";
import {paperCatalogSummary, paperId, paperMapSummary, type PaperDatasetEvidence} from "../src/domain/paper-record";
import {configuredAssertionReader} from "./assertion-postgres";
import {searchPapers, type paperCache} from "./earthnano";
import {PaperCatalogUninitialized,type PaperCatalogStorage} from "./postgres-paper-catalog";

export class PaperCatalogError extends Error {
  constructor(readonly status: 400|404|503, message = "") { super(message); }
}

type FixtureCache = Pick<ReturnType<typeof paperCache>,"get"|"page"|"dataVersion"|"publicationRevision"|"saveBatch">;

export function paperCatalogAccess(source: PaperCatalogStorage | FixtureCache,
  {lookup = searchPapers, assertion = configuredAssertionReader}: {
    lookup?: typeof searchPapers;
    assertion?: () => Pick<NonNullable<ReturnType<typeof configuredAssertionReader>>,"evidence"|"questions"> | undefined;
  } = {}) {
  // Explicit local fixtures retain the old adapter. The discovery process only supplies PostgreSQL.
  const publicationNamespace = randomUUID();
  const store:PaperCatalogStorage = "beginLookup" in source ? source : {
    async getMany(ids) {return ids.flatMap(id=>source.get(id) || []);},
    async page(cursor,limit) {
      const revision=publicationNamespace+":"+source.publicationRevision()+":"+source.dataVersion();
      return {...source.page(cursor,limit),cached:true,revision};
    },
    async beginLookup() {return "";},
    async publishLookup(records) {source.saveBatch(records);},
  };
  const evidenceCache = new Map<string,{time:number;data:PaperDatasetEvidence}>();
  async function fromStore<T>(read:Promise<T>) {
    try {return await read;}
    catch (error) {
      if (error instanceof PaperCatalogUninitialized) throw new PaperCatalogError(503,error.message);
      throw error;
    }
  }
  async function get(id: unknown) {
    if (typeof id === "string" && paperId(id)) return (await fromStore(store.getMany([id])))[0];
  }
  async function page({cursor = "", limit = 250, view}: {cursor?:unknown;limit?:unknown;view?:unknown}) {
    const size = Number(limit);
    if (typeof cursor !== "string" || cursor.length > 1000 || !Number.isInteger(size) || size < 1 || size > 500)
      throw new PaperCatalogError(400);
    const mode = view === "map" || view === "catalog" ? view : "full";
    const {revision,...page} = await fromStore(store.page(cursor,size));
    return {
      revision,
      cacheKey:JSON.stringify([revision,cursor,size,mode]),
      read() {
        const records = mode === "full" ? page.records : page.records.map(mode === "map" ? paperMapSummary : paperCatalogSummary);
        return literatureDisplay({...page,records});
      },
    };
  }
  return {
    page,
    async batch(ids: unknown) {
      if (!Array.isArray(ids) || !ids.length || ids.length > 20 || !ids.every(id => typeof id === "string" && paperId(id)))
        throw new PaperCatalogError(400);
      return literatureDisplay(await fromStore(store.getMany(ids)));
    },
    async detail(id: unknown) {
      const record = await get(id);
      if (!record) throw new PaperCatalogError(404);
      return record;
    },
    async evidence(id: unknown, {fresh = false, signal}: {fresh?:boolean;signal?:AbortSignal} = {}) {
      signal?.throwIfAborted();
      const record = await get(id);
      if (!record) throw new PaperCatalogError(404);
      const reader = assertion();
      if (!reader) throw new PaperCatalogError(503,"论文原文连接暂未配置");
      const cached = evidenceCache.get(record.id);
      if (!fresh && cached && Date.now() - cached.time < 600000) return {data:cached.data,cached:true};
      const identities = (record.need.tabs.find(t => t.label === "论文用法（本页）")?.rows || [])
        .flatMap(row => typeof row[4] === "string" && typeof row[5] === "string" ? [{paperId:row[4],datasetId:row[5]}] : []);
      try {
        const data = await reader.evidence(record.dsKey,identities);
        signal?.throwIfAborted();
        evidenceCache.set(record.id,{time:Date.now(),data});
        if (evidenceCache.size > 128) evidenceCache.delete(evidenceCache.keys().next().value!);
        return {data,cached:false};
      } catch {
        signal?.throwIfAborted();
        throw new PaperCatalogError(503,"论文摘要与原文暂时无法读取");
      }
    },
    async questions(id: unknown, cursor: unknown = "") {
      const record = await get(id);
      if (!record || typeof cursor !== "string" || cursor.length > 3000) throw new PaperCatalogError(400);
      const reader = assertion();
      if (!reader) throw new PaperCatalogError(503,"论文研究数据连接暂未配置。");
      try {return await reader.questions(record.dsKey,cursor);}
      catch {throw new PaperCatalogError(503,"论文研究问题暂时无法读取，请重试。");}
    },
    async search(query: unknown, signal: AbortSignal) {
      if (typeof query !== "string" || !query.trim() || query.trim().length > 240)
        throw new PaperCatalogError(400,"请输入数据集名称或 DOI（不超过 240 字）。");
      try {
        const stamp=await fromStore(store.beginLookup());
        signal.throwIfAborted();
        const hit = await lookup({name:query.trim(),facets:[],region:[]},signal,()=>{});
        signal.throwIfAborted();
        await store.publishLookup(hit.records,stamp);
        return {records:literatureDisplay(hit.records),cached:false,incomplete:hit.incomplete};
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof PaperCatalogError) throw error;
        throw new PaperCatalogError(503,"文献资料查询未完成，请重试。");
      }
    },
  };
}

export type PaperCatalogAccess = ReturnType<typeof paperCatalogAccess>;
