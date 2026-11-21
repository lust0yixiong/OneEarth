import {literatureDisplay} from "./literature-label";
import { pushId, pushPrefix, observationNeed, rememberObservation, observationURL, type Observation } from "./push-observations";
import { inventoryId, sample } from "./earth-search";
import { paperGroup, paperId, paperRecords, validPaperRecord, type PaperRecord } from "./paper-record";
import { observationById } from "./push-observations";
import { caseById, catalogGroups, catalogGroupById, resources } from "./catalog";
import type { EvidenceTab, Need, Resource, SpatialEntry } from "./types";
import { greenlandEvidence } from "../data/evidence/research-polar.mjs";
import {hainaGroup,hainaNeed} from "./haina";
import {validHainaRecord,type HainaRecord} from "./haina-record";
import {loadHainaCatalog} from "./haina-catalog-client";

export type Asset = Resource & {
  dataEntities?: import("./types").DataEntity[];
  kind: "dataset" | "clue" | "requirement";
  tabs: EvidenceTab[];
  subasset?: boolean;
  /** Product family and the edition explicitly identified by the source. */
  productId?: string;
  version?: string | null;
};
const clueIds = new Set([
  "glacier-3",
  "Q07-2",
  "Q14-1",
  "Q14-2",
  "Q14-3",
  "Q14-5",
  "Q14-7",
  "Q19-1",
  "Q20-0",
  "Q20-3",
]);
function assetsFor(resource: Resource): Asset[] {
  const need = catalogGroupById(resource.caseId)!.needs[resource.needIndex];
  const base: Asset = {
    ...resource,
    tabs: need.tabs,
    dataEntities: need.dataEntities,
    kind: !need.tabs.length
      ? "requirement"
      : clueIds.has(resource.id) ||
          (resource.profile &&
            ["method", "request", "derived"].includes(resource.profile.role))
        ? "clue"
        : "dataset",
  };
  if (base.kind === "requirement") return [{ ...base, title: need.name }];
  if (resource.id === "Q19-2") {
    const item = (
      key: string,
      title: string,
      description: string,
      tabs: EvidenceTab[],
      url?: string,
    ): Asset => ({
      ...base,
      id: base.id + "/" + key,
      datasetId: key,
      title,
      description,
      tabs,
      url: url || caseById("Q19")!.needs[3].url,
      source: url ? base.source : "Mayer 等（2018）· 论文及数据可用性声明",
      subasset: true,
      kind: url ? "dataset" : "clue",
      status: url ? "归档已核" : "论文线索",
    });
    return [
      item(
        "pangaea:891368",
        "PANGAEA 891368 · 地震主测点",
        "主测点归档及已接入的测点位置。",
        [
          {
            kind: "table",
            label: "主测点位置",
            columns: ["测点", "经度", "纬度"],
            rows: greenlandEvidence.mainSeismicPoints.points.map((p) => [
              p.name,
              ...p.center,
            ]),
          },
        ],
        "https://doi.org/10.1594/PANGAEA.891368",
      ),
      item(
        "pangaea:890982",
        "PANGAEA 890982 · MGO 地震测线",
        "沿 MGO 测线的冰厚与冰床高程。",
        need.tabs,
        "https://doi.org/10.1594/PANGAEA.890982",
      ),
      item(
        "bedmachine-greenland-v3",
        "BedMachine Greenland v3",
        "原论文使用的区域冰床产品，待核区域栅格。",
        [
          {
            kind: "web",
            label: "论文线索",
            body: "论文使用 BedMachine Greenland v3。当前没有该区域的栅格读值。",
          },
        ],
      ),
    ];
  }
  if (resource.id === "Q19-3")
    return ["ATM", "TanDEM-X"].map((name) => ({
      ...base,
      id: base.id + "/" + name,
      datasetId: "Q19-clue:" + name,
      subasset: true,
      kind: "clue",
      title:
        name === "ATM"
          ? "NASA IceBridge ATM · 测高线索"
          : "TanDEM-X · 多时相高程线索",
      description: "原论文记载的测高资料与研究时相。",
      tabs: need.tabs.map((t) => ({
        ...t,
        rows: t.rows?.filter((row) => row[0] === name),
      })),
    }));
  return [base];
}
// Stable publisher identifiers are independent of the research question. A catalog
// edition identifies the listed product, not the edition actually used by a paper.
const publishedEditions: Record<string, [string, string]> = {
  "rgi:6.0": ["rgi:glacier-inventory", "6.0"],
  "catalog:Q02-0": ["copernicus:dem-glo-30-aws", "2021 release"],
  "catalog:Q07-0": ["nasa:mod10c1", "Collection 6.1"],
  "catalog:Q14-0": ["geoboundaries:gbopen-tur-adm1", "9469f09"],
  "catalog:Q19-0": ["nsidc:0670", "v1"],
  "bedmachine-greenland-v3": ["nsidc:bedmachine-greenland", "v3"],
  "sumup:2024": ["sumup:dataset", "2024"],
  "fluxnet:2015": ["fluxnet:collection", "2015"],
  "noaa:ersstv5": ["noaa:ersst", "v5"],
  "noaa:20crv3-prmsl": ["noaa:20cr-prmsl", "v3"],
  "nsidc:g02135-v4-north-extent": ["nsidc:g02135-north-extent", "v4"],
  "nasa:aeronet-v3-aod": ["nasa:aeronet-aod", "v3"],
  "eea:end-2022-contours": ["eea:end-contours", "2022 轮次"],
  "gfs-wind": ["noaa:gfs-1deg-wind", "2026-11-06 00 UTC 起报"],
  "catalog:dongting-0": ["hunan:chenglingji-annual-report", "2022 年报"],
  "catalog:manaus-0": ["sgb:manaus-annual-report", "2024 年报"],
};
function editionOf(a: Asset): Asset {
  const id = a.datasetId;
  if (id === inventoryId) return {...a, productId: id, version: "索引 SHA-256 " + sample.revision.slice(0,16)};
  let edition = publishedEditions[id];
  const nasa = /^nasa:(.+)\.(061|003)$/i.exec(id);
  const tagged = /^(.+)-v(\d+(?:\.\d+)*)$/.exec(id);
  if (nasa)
    edition = [
      "nasa:" + nasa[1].toLowerCase(),
      nasa[2] === "061" ? "Collection 6.1" : "v003",
    ];
  if (tagged && !edition) edition = [tagged[1], "v" + tagged[2]];
  return { ...a, productId: edition?.[0] || id, version: edition?.[1] ?? null };
}
export const assets = resources.flatMap(assetsFor).map(editionOf);
export const assetById = new Map(assets.map((a) => [a.id, a]));
let revision = 0;
export const catalogRevision = () => revision;
const catalogListeners=new Set<()=>void>();
export function subscribeCatalog(listener:()=>void) {
  catalogListeners.add(listener);
  return ()=>catalogListeners.delete(listener);
}
function catalogChanged(){revision++;for(const listener of catalogListeners)listener();}
let hainaSignature="";
function hainaAsset(n:Need,i:number):Asset {
  return {holding:n.holding,canonicalId:n.canonicalId,id:n.datasetId!,datasetId:n.datasetId!,productId:n.datasetId!,version:null,
    caseId:"haina",needIndex:i,title:n.product,type:n.type,categories:n.type.split("、"),status:n.status,fit:"海纳专区已收录",
    why:n.profile!.coverage,source:n.source,origins:["haina"],url:n.url,description:n.detail,profile:n.profile,
    tabs:n.tabs,card:n.card,kind:"dataset",paperSource:assetById.get(n.datasetId!)?.paperSource,paperSources:assetById.get(n.datasetId!)?.paperSources};
}
/** Atomically replace the displayed catalogue; IDs remain the upstream dataset IDs. */
export function registerHaina(records:HainaRecord[],synced:string,endpoint:string,replace=true){
  if(!records.every(validHainaRecord)||new Set(records.map(r=>r.id)).size!==records.length)throw Error("海纳目录记录无效或重复。");
  if(!replace){
    for(const record of records){
      const n=hainaNeed(record,synced,endpoint),index=hainaGroup.needs.findIndex(v=>v.datasetId===n.datasetId);
      const i=index<0?hainaGroup.needs.length:index;
      hainaGroup.needs[i]=n;
      const a=hainaAsset(n,i),ai=assets.findIndex(v=>v.id===a.id),ri=resources.findIndex(v=>v.id===a.id);
      if(ai<0)assets.push(a);else assets[ai]=a;
      if(ri<0)resources.push(a);else resources[ri]=a;
      assetById.set(a.id,a);byIdentity.set(assetIdentity(a),[a]);
    }
    if(records.length){hainaSignature="";catalogChanged();}
    return !!records.length;
  }
  const signature=JSON.stringify([records,synced,endpoint]);
  if(signature===hainaSignature)return false;
  const needs=records.map(r=>hainaNeed(r,synced,endpoint));
  const next=needs.map(hainaAsset);
  for(let i=assets.length-1;i>=0;i--)if(assets[i].origins.includes("haina"))assets.splice(i,1);
  for(let i=resources.length-1;i>=0;i--)if(resources[i].origins.includes("haina"))resources.splice(i,1);
  for(const [key,items] of byIdentity){const kept=items.filter(a=>!a.origins.includes("haina"));if(kept.length)byIdentity.set(key,kept);else byIdentity.delete(key);}
  hainaGroup.needs=needs;
  for(const a of next){assetById.set(a.id,a);byIdentity.set(assetIdentity(a),[a]);}
  assets.push(...next);resources.push(...next);
  hainaSignature=signature;catalogChanged();return true;
}
let groupedRevision = -1;
let groupedAssets = new Map<string, Asset[]>();
export function assetsByCase() {
  if (groupedRevision !== revision) {
    groupedAssets = new Map();
    for (const asset of assets) {
      const group=groupedAssets.get(asset.caseId)||[];group.push(asset);groupedAssets.set(asset.caseId,group);
    }
    groupedRevision=revision;
  }
  return groupedAssets;
}
/** Actual publisher records and received observations; paper clues require assertion provenance. */
export function discoverableAsset(a: Asset) {
  if (a.origins.includes("paper")) return paperId(a.id) && validPaperRecord(paperRecords.get(a.id));
  if (a.origins.includes("constellation")) return observationById(a.id)?.test === false;
  return a.kind === "dataset" && a.origins.some(source => source === "public" || source === "haina") &&
    !!a.url && /^https?:\/\//.test(a.url) && (!a.profile || ["data", "index"].includes(a.profile.role));
}
export function assetIdentity(a: Asset) {
  const product = a.productId || a.datasetId;
  return a.version
    ? JSON.stringify([product, a.version])
    : JSON.stringify([product, null, a.id]);
}
const byIdentity = new Map<string, Asset[]>();
for (const asset of assets) {
  const key = assetIdentity(asset);
  const records = byIdentity.get(key) || [];
  records.push(asset);
  byIdentity.set(key, records);
}
export function distinctAssets(items: Asset[]) {
  const seen = new Set<string>();
  return items.filter((a) => {
    const id = assetIdentity(a);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
export function relatedAssets(asset: Asset | string): Asset[] {
  if (typeof asset === "string") {
    const record = assetById.get(asset);
    if (record) return relatedAssets(record);
    const exact = byIdentity.get(asset);
    if (exact) return exact;
    const matches = assets.filter((a) => a.datasetId === asset);
    return distinctAssets(matches).length === 1 ? matches : [];
  }
  return byIdentity.get(assetIdentity(asset)) || [asset];
}
export function identitiesForRecords(ids: string[]) {
  return new Set(
    ids.flatMap((id) => {
      const a = assetById.get(id);
      return a ? [assetIdentity(a)] : [];
    }),
  );
}
export function assetMatchesEntry(asset: Asset, entry: SpatialEntry) {
  if (asset.needIndex !== entry.need) return false;
  if (asset.caseId !== "Q19" || asset.needIndex !== 2) return true;
  return (
    asset.datasetId === (entry.track ? "pangaea:890982" : "pangaea:891368")
  );
}

// The working catalog shows current revisions. IDs referenced by an open batch
// remain addressable after a newer observation arrives.
let feedSignature = "";
export function observationAsset(r:Observation):Asset {
  const n=observationNeed(r),id=pushId(r);
  return {id,caseId:id,needIndex:0,datasetId:n.datasetId!,productId:JSON.stringify([r.sourceId,r.collection,r.id]),
    holding:r.file?{channelId:r.sourceId,channelName:r.sourceName,access:"workspace"}:undefined,
    version:"r"+r.revision,title:n.product,type:n.type,categories:[n.type],status:n.status,fit:"已接收",
    why:n.profile!.limitation,source:n.source,origins:["constellation"],url:n.url,description:n.detail,
    profile:n.profile,tabs:n.tabs,card:n.card,kind:"dataset"};
}
export function registerObservations(records: Observation[], replaceFeed = false) {
  let added=false;
  for (const r of records) {
    const id = pushId(r);
    if (assetById.has(id)) continue;
    rememberObservation(r);
    const a=observationAsset(r);
    assetById.set(id,a);added=true;
  }
  if (!replaceFeed) {if(added)catalogChanged();return added;}
  const actual = records.filter(r=>!r.test);
  const signature=actual.map(r=>r.key).join("|");
  if(feedSignature===signature) {if(added)catalogChanged();return added;}
  feedSignature=signature;
  for (let i=assets.length-1;i>=0;i--) if (assets[i].origins.includes("constellation")) assets.splice(i,1);
  assets.push(...actual.map(r=>assetById.get(pushId(r))!));
  catalogChanged();
  return true;
}
export function observationAssets(ids?:string[]) {
  return ids ? ids.flatMap(id=>id.startsWith(pushPrefix) && assetById.has(id)?[assetById.get(id)!]:[]) :
    assets.filter(a=>a.origins.includes("constellation"));
}
export function registerPapers(records: PaperRecord[], includeInCatalog = true) {
  let changed = false;
  // The catalogue publishes one current record per dataset. A restored answer
  // instead needs every exact cited record, including different historical hashes.
  const selected=new Map(records.filter(validPaperRecord).map(record=>[includeInCatalog?record.dsKey:record.id,record]));
  if(includeInCatalog) for(let i=assets.length-1;i>=0;i--) {
    if(paperId(assets[i].id) && selected.has(assets[i].datasetId)) {assets.splice(i,1);changed=true;}
  }
  for (const record of selected.values()) {
    if (assetById.has(record.id)) {
      // A late catalogue page must never downgrade an answer's full evidence.
      if(paperRecords.get(record.id)?.catalogSummary && !record.catalogSummary){
        const n=literatureDisplay(record.need),asset=assetById.get(record.id)!;
        Object.assign(asset,{tabs:n.tabs,profile:n.profile,description:n.detail,why:n.detail,dataEntities:n.dataEntities});
        paperRecords.set(record.id,record);
        const group=catalogGroupById(record.id);if(group)group.needs=[n];
        changed=true;
      }
      if (includeInCatalog) {assets.push(assetById.get(record.id)!);changed=true;}
      continue;
    }
    const n = literatureDisplay(record.need);
    const asset: Asset = {
      id:record.id, caseId:record.id, datasetId:record.dsKey, needIndex:0,
      title:n.product, source:n.source, type:n.type, categories:[n.type], origins:["paper"],
      status:n.status, description:n.detail, fit:"论文使用记录", why:n.detail,
      profile:n.profile, url:n.url, tabs:n.tabs, kind:"clue",
    };
    paperRecords.set(record.id,record);
    catalogGroups.push(paperGroup(record));
    resources.push(asset);
    if (includeInCatalog) {
      assets.push(asset);changed=true;
    }
    assetById.set(asset.id,asset);changed=true;
  }
  if(changed) catalogChanged();
}

export async function loadRemoteAssetIds(ids:string[]){
  const hainaIds=[...new Set(ids.filter(id=>/^haina:\d+$/.test(id)&&!assetById.has(id)))];
  if(hainaIds.length){const c=await loadHainaCatalog(new AbortController().signal);registerHaina(c.records,c.synced,c.endpoint);}
  const paperIds = [...new Set(ids.filter(id=>paperId(id) && (!assetById.has(id)||paperRecords.get(id)?.catalogSummary)))];
  for (let i=0;i<paperIds.length;i+=20) {
    const res=await fetch("/api/paper-records?ids="+paperIds.slice(i,i+20).join(","));
    if (!res.ok)throw Error("完整论文资料暂时无法读取，请重试。");
    registerPapers(await res.json(),false);
  }
  const missing=[...new Set(ids)].filter(id=>/^constellation:[a-f0-9]{64}$/.test(id)&&!assetById.has(id));
  for(let i=0;i<missing.length;i+=8){
    await Promise.all(missing.slice(i,i+8).map(async id=>{
      const res=await fetch(observationURL(id.slice(pushPrefix.length)));
      if(res.ok) {const r:Observation=await res.json(); if(pushId(r)===id) registerObservations([r]);}
    }));
  }
}
