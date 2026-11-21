import {recipeUsages,readResearchPath,readEvidenceLinks} from "./assertion-relations";
import type {ResearchPath,AssertionEvidenceLinks} from "../src/domain/assertion-relations";
import { rectangle } from "../src/domain/geo-rectangle";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Coordinate, EvidenceTab, Need, SourceProfile } from "../src/domain/types";
import { validPaperRecord, type PaperRecord } from "../src/domain/paper-record";
import { paperNameIdentity } from "./paper-name-identity";
import {isolatePaperMetadata,relatedNamedPaperCandidate} from "./paper-metadata-identity";

type Tool = "resolve_dataset" | "find_dataset_by_task" | "search_dataset_usage" | "get_dataset_metadata" | "get_evidence" | "search_recipes";
type Row = Record<string, unknown>;
const obj = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(obj) : [];
const str = (value: unknown) => typeof value === "string" ? value.trim() : "";
const strings = (value: unknown) => Array.isArray(value) ? value.map(str).filter(Boolean) : [];
const show = (v: unknown) => typeof v === "string" ? v : JSON.stringify(v) ?? "";
export interface PaperPlan { name: string; requestedName?:string; facets: {need: string; queries: string[]}[]; region: string[]; scenario?: string[] }
export interface PaperSearchResult {records:PaperRecord[];tools:Tool[];incomplete:Tool[];notices?:string[];truncated?:boolean}
const shortEnglish=(value:string)=>/[a-z]/i.test(value) && !/\p{Script=Han}/u.test(value) && value.split(/\s+/).length<=3;

export function readPaperPlan(raw: string): PaperPlan {
  const plan = obj(JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/gi, "")));
  const terms = (v: unknown) => strings(typeof v==="string"?[v]:v).map(x => x.slice(0, 120)).slice(0, 6);
  const facets = rows(plan.facets).map(f => ({ need: str(f.need).slice(0,100), queries: terms(f.queries) })).filter(f => f.need && f.queries.length).slice(0,6);
  const requestedName=str(plan.name),identity=paperNameIdentity(requestedName);
  // Extract before limiting a long title so a DOI at the end is not lost.
  // Preserve all distinct identifiers when ambiguous; searchPapers asks to disambiguate.
  const name=identity.kind==="unique"?identity.doi:identity.kind==="ambiguous"?identity.dois.join(" ; "):requestedName.slice(0,240);
  if (!name && !facets.length) throw Error("未能生成论文检索词，请补充数据集名称或研究主题。");
  if(facets.some(f=>f.queries.some(q=>!shortEnglish(q))))throw Error("文献资料 queries 必须是每条 1—3 个英文词，不能含中文或完整长句。");
  return { name, ...(name!==requestedName?{requestedName:requestedName.slice(0,240)}:{}), facets, region: terms(plan.region), scenario:terms(plan.scenario).filter(shortEnglish).slice(0,3) };
}

/** The upstream contains matcher can return substrings inside unrelated names. */
export function paperNameMatches(name:string,hit:Row){
  const identity=paperNameIdentity(name);
  if(identity.kind==="ambiguous")return false;
  if(identity.kind==="unique")return str(hit.ds_key).toLowerCase()==="doi:"+identity.doi;
  if(hit.matched_via!=="contains")return true;
  const text=[hit.display_name,hit.matched_alias,...strings(hit.title_variants)].map(str).join(" ").toLowerCase();
  const words=name.toLowerCase().match(/[a-z][a-z0-9_-]*/g)||[];
  const generic=new Set(["the","of","and","from","to","for","data","dataset","datasets","global","product","supplementary","supplement","supporting","information","material","materials"]);
  const terms=words.filter(w=>!generic.has(w));
  const matched=terms.filter(term=>new RegExp("(?:^|[^a-z0-9])"+term.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"(?=$|[^a-z])","i").test(text));
  return terms.length>0 && matched.length>=Math.min(2,terms.length);
}

export function paperCache(file: string) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;");
  db.exec("CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, payload TEXT NOT NULL)");
  const put = db.prepare("INSERT OR IGNORE INTO evidence VALUES (?, ?)");
  const get = db.prepare("SELECT payload FROM evidence WHERE id = ?");
  const all = db.prepare("SELECT payload FROM evidence ORDER BY rowid DESC");
  db.exec("CREATE TABLE IF NOT EXISTS dataset_catalog (ds_key TEXT PRIMARY KEY, id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS dataset_catalog_state (key TEXT PRIMARY KEY, payload TEXT NOT NULL)");
  const publish = db.prepare("INSERT INTO dataset_catalog VALUES (?,?) ON CONFLICT(ds_key) DO UPDATE SET id=excluded.id");
  const state = db.prepare("SELECT payload FROM dataset_catalog_state WHERE key='current'");
  const setState = db.prepare("INSERT INTO dataset_catalog_state VALUES ('current',?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload");
  if (!state.get()) {
    const seen = new Set<string>();
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of all.all()) {
        try {
          const record = JSON.parse(String(row.payload));
          if (validPaperRecord(record) && !seen.has(record.dsKey)) {publish.run(record.dsKey,record.id);seen.add(record.dsKey);}
        } catch { /* Invalid historical entries do not become catalogue records. */ }
      }
      setState.run(JSON.stringify({complete:false,source:"文献资料已查询记录",sourceTotal:null,filteredOut:0,updatedAt:null}));
      db.exec("COMMIT");
    } catch (error) {db.exec("ROLLBACK");throw error;}
  }
  const total = () => Number(db.prepare("SELECT count(*) AS n FROM dataset_catalog").get()!.n);
  const status = () => ({...JSON.parse(String(state.get()!.payload)),total:total()});
  return {
    save(record: PaperRecord, includeInCatalog = true) {
      if (!validPaperRecord(record)) throw Error("论文记录缺少文献资料用法依据。");
      put.run(record.id, JSON.stringify(record));
      if (includeInCatalog) {
        const existed=db.prepare("SELECT 1 FROM dataset_catalog WHERE ds_key=?").get(record.dsKey);
        publish.run(record.dsKey,record.id);
        const prior=status();
        if(!existed && prior.complete)setState.run(JSON.stringify({...prior,complete:false}));
      }
    },
    get(id: string): PaperRecord | undefined {
      const record = get.get(id);
      if (record) { const value = JSON.parse(String(record.payload)); if (validPaperRecord(value)) return value; }
    },
    list(): PaperRecord[] {
      return db.prepare("SELECT e.payload FROM dataset_catalog c JOIN evidence e ON e.id=c.id ORDER BY c.ds_key").all().flatMap(row => {
        try {
          const record = JSON.parse(String(row.payload));
          if (!validPaperRecord(record)) return [];
          return [record];
        } catch { return []; }
      });
    },
    page(cursor = "", limit = 250) {
      const rows=db.prepare("SELECT c.ds_key,e.payload FROM dataset_catalog c JOIN evidence e ON e.id=c.id WHERE c.ds_key>? ORDER BY c.ds_key LIMIT ?").all(cursor,limit+1);
      const hasMore=rows.length>limit, selected=rows.slice(0,limit);
      return {records:selected.map(row=>JSON.parse(String(row.payload)) as PaperRecord),nextCursor:hasMore?String(selected.at(-1)!.ds_key):null,total:total(),catalog:status(),cached:true};
    },
    status,
    replaceCatalog(records: PaperRecord[], info: {source:string;sourceTotal:number;filteredOut:number;updatedAt:string}) {
      if (!records.every(validPaperRecord) || new Set(records.map(r=>r.dsKey)).size!==records.length || records.length+info.filteredOut!==info.sourceTotal)
        throw Error("全量目录的记录数、去重或证据校验未通过。");
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec("DELETE FROM dataset_catalog");
        for (const record of records) {put.run(record.id,JSON.stringify(record));publish.run(record.dsKey,record.id);}
        setState.run(JSON.stringify({...info,complete:true}));
        db.exec("COMMIT");
      } catch(error) {db.exec("ROLLBACK");throw error;}
    },
    close() { db.close(); },
  };
}

export function normalizePaperSpace(spatial: unknown) {
  const points: Coordinate[] = [];
  const boxes: number[][] = [];
  const labels: string[] = [];
  for (const item of rows(obj(spatial).values)) {
    const value = obj(item.value);
    labels.push(...strings(value.places));
    if (value.raw_kind === "geoLocations" && Array.isArray(value.points)) {
      for (const point of value.points) {
        if (!Array.isArray(point) || point.length !== 2 || !point.every(x => typeof x === "number" || (typeof x === "string" && x.trim()))) continue;
        const [lat,lon] = point.map(Number);
        if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat)<=90 && Math.abs(lon)<=180) points.push([lon,lat]);
      }
    }
    const rawBox = value.bbox;
    const b=Array.isArray(rawBox) && rawBox.length===4 && rawBox.every(v=>typeof v==="number" || (typeof v==="string" && v.trim()))?rawBox.map(Number):[];
    if (b.length === 4 && b.every(Number.isFinite)) {
      const [w,s,e,n] = b;
      if (w>=-180 && e<=180 && w<e && s>=-90 && n<=90 && s<n) boxes.push(b as number[]);
    }
  }
  const world = boxes.some(([w,s,e,n]) => w===-180 && e===180 && s===-90 && n===90);
  const polygons = boxes.map(([w,s,e,n]) => rectangle(w,s,e,n));
  const area: SourceProfile["area"] = world || !boxes.length ? undefined : boxes.length === 1
    ? polygons[0]
    : {type:"MultiPolygon", coordinates:polygons.flatMap(p=>p.coordinates)};
  const coverage = world ? "官方元数据标注全球范围" : [
    ...boxes.map(b=>"官方边界框（西、南、东、北）"+b.join(", ")),
    ...(points.length ? [points.length+" 个官方坐标"] : []), ...labels,
  ].join(" · ") || "官方元数据未提供可定位范围";
  return {points, area, coverage, world,broad:boxes.some(([w,,e])=>e-w>=180)};
}

export async function searchPapers(plan: PaperPlan, signal: AbortSignal, stage: (text:string)=>void, report?:(call:import("../src/domain/types").ToolCall)=>void):Promise<PaperSearchResult> {
  const identity=paperNameIdentity(plan.name);
  if(identity.kind==="ambiguous")return {records:[],tools:[],incomplete:[],notices:["资料名称含多个不同 DOI，请明确本轮要核对的标识；未擅自选择其中一个或按泛标题替代。"]};
  const requestedName=plan.requestedName||plan.name;
  if(identity.kind==="unique")plan={...plan,name:identity.doi};
  if(!plan.name && !plan.facets.some(f=>f.queries.some(shortEnglish)))throw Error("文献资料未取得有效英文检索词，未发送整句中文查询。");
  const endpoint = process.env.ONEEARTH_EARTHNANO_URL || "http://10.11.140.149:8767/sse";
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
  const client = new Client({name:"oneearth", version:"0.1"});
  const transport = new SSEClientTransport(new URL(endpoint), {
    fetch: (url, init) => fetch(url, {...init, signal: AbortSignal.any([deadline, ...(init?.signal ? [init.signal] : [])])}),
  });
  const toolsUsed = new Set<Tool>();
  async function call(name: Tool, args: Row): Promise<Row> {
    toolsUsed.add(name);
    const call = {id:crypto.randomUUID(), kind:"MCP" as const, name, input:JSON.stringify(args,null,2)};
    report?.({...call,status:"running"});
    try {
      const reply = await client.callTool({name,arguments:args}, undefined, {signal:deadline,timeout:10000});
      const first = rows(reply.content).find(c => c.type === "text");
      if (reply.isError || !first) throw Error("文献资料查询失败（"+name+"）："+(first?str(first.text).slice(0,400):"未返回内容"));
      const data = obj(JSON.parse(str(first.text)));
      const empty=name==="get_dataset_metadata" && data.status==="no_metadata";
      const unresolved=name==="resolve_dataset" && (data.status==="not_found" ||
        (data.status==="no_exact_match" && Array.isArray(data.fallback)));
      if (data.status !== "ok" && data.status !== "no_match" && !empty && !unresolved && !Array.isArray(data.entities))
        throw Error("文献资料未完成查询（"+name+"）："+(str(data.note)||str(data.message)||str(data.error)||str(data.status)||"返回格式无效"));
      const output=JSON.stringify(data,null,2);
      report?.({...call,status:"done",output:output.length>3000 ? output.slice(0,3000)+"…（输出节选）" : output});
      return data;
    } catch (error) {
      report?.({...call,status:"failed",error:error instanceof Error ? error.message : "文献资料请求失败"});
      throw error;
    }
  }
  const incomplete = new Set<Tool>();
  async function optional(name: Tool, args: Row) {
    try { return await call(name,args); }
    catch (error) {
      signal.throwIfAborted();
      incomplete.add(name);
      return {} as Row;
    }
  }
  try {
    stage("正在查询文献资料");
    await client.connect(transport, {signal:deadline,timeout:6000});
    let searchTool:Tool = plan.name ? "resolve_dataset" : "find_dataset_by_task";
    let args:Row = plan.name ? {name:plan.name} : {facets:plan.facets, scenario_queries:plan.scenario || []};
    const records: PaperRecord[] = [];
    const priorities=new Map<string,number>();
    const notices:string[]=[];
    if(identity.kind==="unique" && requestedName!==plan.name)notices.push("已优先按资料名称中的唯一明确 DOI 检索，保留其完整后缀；标题中另行声明的版次仍需与发布元数据核对，精确 DOI 命中不自动证明该版次。");
    const candidateLimit=Math.min(60,Math.max(24,plan.facets.length*8));
    let checked=0,truncated=false,irrelevant=0,expandedPaths=0;
    async function verify(h:Row): Promise<PaperRecord | undefined> {
      const dsKey = str(h.ds_key);
      let [usage, meta, recipe] = await Promise.all([
        call("search_dataset_usage",{ds_key:dsKey,...(plan.region.length ? {region:plan.region} : {})}),
        optional("get_dataset_metadata",{ds_key:dsKey}), optional("search_recipes",{ds_key:dsKey}),
      ]);
      let regionalFallback=false;
      if(!rows(usage.usages).length && plan.region.length && !deadline.aborted){
        // A paper's study location is not the data product's coverage footprint.
        usage=await call("search_dataset_usage",{ds_key:dsKey});regionalFallback=true;
      }
      const usages = rows(usage.usages).filter(u=>u.ds_key===dsKey && str(u.paper_id) && str(u.dataset_id)).slice(0,12);
      if (!usages.length) return;
      const isolated=isolatePaperMetadata(dsKey,meta),fields=isolated.fields;
      const space = normalizePaperSpace(fields.spatial);
      const tabs: EvidenceTab[] = [{
        kind:"table", label:"论文用法（本页）", columns:["论文","角色与用途","变量","研究背景","论文 ID","文内数据集 ID","论文 DOI"],
        rows:usages.map(u=>[u.paper_title,rows(u.roles).map(r=>[r.role,r.desc].filter(Boolean).join(" · ")).join("\n"),u.variables,u.study_context,u.paper_id,u.dataset_id,str(u.paper_doi)]),
      }];
      const evidenceLinks:AssertionEvidenceLinks[]=[];
      for (const u of usages.slice(0,2)) {
        let ev = await optional("get_evidence",{ds_key:dsKey,paper_id:u.paper_id,dataset_id:u.dataset_id});
        const row = obj(ev.row);
        if (row.ds_key!==dsKey || row.paper_id!==u.paper_id || row.dataset_id!==u.dataset_id) continue;
        const firstPage=rows(ev.evidence);
        if(obj(ev.pagination).has_more===true && firstPage.length>0 && firstPage.length<16 && !deadline.aborted){
          const next=await optional("get_evidence",{ds_key:dsKey,paper_id:u.paper_id,dataset_id:u.dataset_id,offset:firstPage.length});
          const nextRow=obj(next.row);
          if(nextRow.ds_key===dsKey && nextRow.paper_id===u.paper_id && nextRow.dataset_id===u.dataset_id){
            const combined=[...new Map([...firstPage,...rows(next.evidence)].map(b=>[str(b.block_id),b])).values()];
            ev={...ev,evidence:combined.slice(0,16),
              pagination:{...obj(next.pagination),has_more:combined.length>16 || obj(next.pagination).has_more===true}};
          }
        }
        evidenceLinks.push(readEvidenceLinks(ev,str(u.paper_id),str(u.dataset_id)));
        const blocks = rows(ev.evidence).filter(b=>str(b.block_id) && str(b.quote)).slice(0,16);
        if (blocks.length) tabs.push({kind:"text",label:"原文 · "+u.paper_title,before:str(u.paper_title),after:"论文 "+u.paper_id+" · "+u.dataset_id+" · "+dsKey,quote:[
          ...blocks.map(b=>[b.block_id,b.section].filter(Boolean).join(" · ")+"\n"+str(b.quote).slice(0,5000)),
        ].join("\n\n")});
      }
      const combinations=rows(recipe.recipes).filter(r=>str(r.paper_id) && str(r.rq_id) && str(r.task) &&
        usages.some(u=>u.paper_id===r.paper_id) && rows(r.members).some(m=>str(m.ds_key)===dsKey)).slice(0,6);
      const researchPaths:ResearchPath[]=[];
      const relationTerms=plan.facets.flatMap(f=>f.queries).concat(plan.scenario||[]).join(" ").toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g)||[];
      const relevance=(r:Row)=>relationTerms.filter(term=>str(r.task).toLowerCase().includes(term)).length;
      const selected=[...combinations].sort((a,b)=>relevance(b)-relevance(a))[0];
      const namedTarget=!plan.name || searchTool==="resolve_dataset" || paperNameMatches(plan.name,{
        ...h,matched_via:"contains",title_variants:[...strings(h.title_variants),...rows(obj(fields.title).values).map(v=>str(v.value))],
      });
      if(selected && namedTarget && expandedPaths<3 && !deadline.aborted){
        expandedPaths++;
        const detail=await optional("search_recipes",{paper_id:selected.paper_id,rq_id:selected.rq_id});
        const path=readResearchPath(detail,str(selected.paper_id),str(selected.rq_id),dsKey,usages);
        if(path){
          researchPaths.push(path);
          tabs.push({kind:"table",label:"研究方法与路径 · "+path.paperTitle,
            columns:["步骤 ID","顺序","步骤类型","名称","目的","方法"],
            rows:path.steps.map(step=>[step.stepId,step.order,step.type,step.name,step.purpose,step.method])});
          tabs.push({kind:"table",label:"数据参与步骤 · "+path.paperTitle,
            columns:["数据集","规范标识","文内数据集 ID","参与步骤"],
            rows:path.members.map(member=>[member.name,member.dsKey,member.datasetId,member.stepIds.join("、")])});
        }
      }
      const researchQuestions=combinations.flatMap(r=>recipeUsages(r,usages,dsKey).map(u=>({
        paperId:str(r.paper_id),rqId:str(r.rq_id),datasetId:str(u.dataset_id),
        paperTitle:str(r.paper_title)||str(u.paper_title),question:str(r.task),
      }))).slice(0,12);
      if(combinations.length)tabs.push({kind:"table",label:"论文研究问题与数据组合",
        columns:["论文","研究问题","共同使用的数据集","论文 ID","研究问题 ID"],
        rows:combinations.map(r=>[str(r.paper_title),str(r.task),
          rows(r.members).slice(0,10).map(m=>str(m.name)+" · "+str(m.ds_key)).join(String.fromCharCode(10)),str(r.paper_id),str(r.rq_id)])});
      const partners = rows(recipe.companion_overview).filter(p=>str(p.ds_key));
      if (partners.length) tabs.push({kind:"table",label:"论文中的数据组合",columns:["共同使用的数据集","论文数","组合数","数据集标识"],rows:partners.map(p=>[p.display_name,p.papers,p.recipes,p.ds_key])});
      const metadata = Object.entries(fields).flatMap(([key,f])=>rows(obj(f).values).slice(0,20).map(v=>[key,show(v.value).slice(0,2000),strings(v.sources).join("、")]));
      if (metadata.length) tabs.push({kind:"table",label:"官方元数据",columns:["字段","原始值","元数据来源"],rows:metadata});
      if(isolated.quarantined.length){
        const notes=isolated.quarantined.map(q=>q.source+"："+q.reasons.join("；"));
        tabs.push({kind:"table",label:"元数据身份核对",columns:["来源","处理与原因"],rows:isolated.quarantined.map(q=>[q.source,q.reasons.join("；")])});
        notices.push(dsKey+" "+notes.join("；")+" 上游原始记录未修改，其他来源字段不因此视为已核实全部内容。");
      }
      const first=usages[0], title=str(rows(obj(fields.title).values)[0]?.value) || str(h.display_name) || str(obj(meta.entity).display_name) || dsKey;
      const url=!str(obj(meta.entity).ds_key) || str(obj(meta.entity).ds_key).toLowerCase()===dsKey.toLowerCase()?str(obj(meta.entity).doi_url):"";
      const papers=Number(h.n_papers);
      const regionNote=regionalFallback?"本轮指定地域未命中论文用法；以下为其他或未声明地域的产品使用线索，不能据此证明目标区已观测或验证。":"";
      const detail="库内关联 "+papers+" 篇论文。本页用法示例来自《"+first.paper_title+"》。"+(str(rows(first.roles)[0]?.desc) || "")+regionNote;
      const need: Need = { name:"论文研究数据",product:title,type:"论文研究数据",detail,status:"有论文用法记录",
        source:"EarthNano 论文断言库",datasetId:dsKey,url:/^https:\/\/doi\.org\//i.test(url)?url:undefined,tabs,
        profile:{role:"data",spatial:"coverage",coverage:space.coverage,area:space.area,areaBasis:"bounding-box",extent:space.world?"world":undefined,
          access:url?"通过数据集 DOI 查看发布方记录":"见论文与官方元数据",limitation:regionNote || "论文研究区和研究时段见对应的用法记录。"}};
      const data={dsKey,need,papers,points:space.points,paperTitle:str(first.paper_title),studyContext:str(first.study_context),...(researchQuestions.length?{researchQuestions}:{}),...(researchPaths.length?{researchPaths}:{}),...(evidenceLinks.length?{evidenceLinks}:{})};
      priorities.set(dsKey,!regionalFallback?0:space.broad?1:2);
      return {...data,id:"earthnano:"+createHash("sha256").update(JSON.stringify(data)).digest("hex")};
    }
    const seen = new Set<string>();
    let previousKeys = new Set<string>();
    let offset = 0;
    while (!deadline.aborted) {
      const page = offset === 0 ? await call(searchTool,args) : await optional(searchTool,{...args,offset});
      const entries = searchTool==="resolve_dataset" && page.status==="not_found" ? [] : rows(page.entities || page.candidates);
      const hits = entries.filter(h=>{
        const key = str(h.ds_key);
        if (!key || seen.has(key) || !(Number(h.n_papers)>0) || h.is_catalog_only || (searchTool==="resolve_dataset" && !paperNameMatches(plan.name,h))) return false;
        if(searchTool==="find_dataset_by_task" && plan.name && !relatedNamedPaperCandidate(plan.name,plan.facets.flatMap(f=>f.queries),h)){
          irrelevant++;seen.add(key);return false;
        }
        seen.add(key); return true;
      });
      if (plan.name) hits.sort((a,b)=>Number(b.n_papers)-Number(a.n_papers));
      if(searchTool==="resolve_dataset" && !hits.length && !records.length){
        const namedDoi=identity.kind==="unique";
        const fallback=plan.facets.length?plan.facets:[{need:"指定数据集的论文依据",queries:namedDoi?[]:[plan.name].filter(shortEnglish)}];
        if(fallback.some(f=>f.queries.length)){
          searchTool="find_dataset_by_task";args={facets:fallback,scenario_queries:plan.scenario || []};
          offset=0;notices.push(namedDoi?"指定 DOI 未得到精确匹配，已另查独立研究主题；主题候选不代表该 DOI 已收录。":"名称匹配未得到可信候选，已用独立的英文主题检索核对。");continue;
        }
        if(namedDoi)notices.push("指定 DOI 在库内未命中；没有独立研究主题，不以词法近似条目替代该 DOI。");
      }
      if (!entries.length) break;
      stage("正在核对论文用法与元数据，已取得 "+records.length+" 项有依据的数据集");
      if(hits.length>candidateLimit-checked)truncated=true;
      for (let i=0;i<hits.length && !deadline.aborted && checked<candidateLimit;i+=2) {
        const batch=hits.slice(i,i+Math.min(2,candidateLimit-checked));checked+=batch.length;
        const verified = await Promise.allSettled(batch.map(verify));
        signal.throwIfAborted();
        for (const result of verified) {
          if (result.status === "rejected") incomplete.add("search_dataset_usage");
          else if (result.value) records.push(result.value);
        }
      }
      const paging = Object.keys(obj(page.pagination)).length ? obj(page.pagination) : page;
      if(identity.kind==="unique" && searchTool==="find_dataset_by_task"){
        if(paging.has_more!==false&&paging.next_offset!==null)truncated=true;
        notices.push("指定 DOI 未精确命中后的独立主题回退仅核查首批候选，未继续翻页；这些线索不能补作指定资料的身份、文件或读数。");
        break;
      }
      if(checked>=candidateLimit){truncated=truncated || (paging.has_more!==false && paging.next_offset!==null);break;}
      if (paging.has_more === false || paging.next_offset === null) break;
      const next = typeof paging.next_offset === "number" ? paging.next_offset : offset + entries.length;
      if (!Number.isSafeInteger(next) || next<=offset) {incomplete.add(searchTool);break;}
      if (!hits.length && entries.every(e=>previousKeys.has(str(e.ds_key)))) {incomplete.add(searchTool);break;}
      previousKeys = new Set(entries.map(e=>str(e.ds_key)));
      offset=next;
    }
    signal.throwIfAborted();
    if (deadline.aborted) incomplete.add(searchTool);
    if(expandedPaths)notices.push("本轮按检索主题展开最多 3 条研究路径，数据角色与步骤均保留源标识；原文每份用法最多取两页 16 块，仍有后续页时在证据关系中标明。");
    if(truncated)notices.push("本轮已核对相关性靠前的 "+checked+" 个候选，结果不是全库总量。");
    if(irrelevant)notices.push("指定资料的主题回退中有 "+irrelevant+" 项候选的标题/别名未支持其与指定资料或检索主题相关，未继续读取论文用法、元数据或原文；未将它们当作指定资料的替代身份。");
    records.sort((a,b)=>(priorities.get(a.dsKey)||0)-(priorities.get(b.dsKey)||0));
    return {records,tools:[...toolsUsed],incomplete:[...incomplete],notices,truncated};
  } finally { await client.close(); }
}
