import {parseSourceReadLocators} from "../src/domain/source-read-locator";
import type {PaperRecord} from "../src/domain/paper-record";
import {paperId} from "../src/domain/paper-record";
import {paperResultKind, sourceReadKind, type PaperQueryOutput, type SourceReadInput,
  type SourceReadResult, type SourceReadTarget} from "./discovery-materials-contract";
import {publicPage} from "./fetch-pages";
import {PaperCatalogError, type PaperCatalogAccess} from "./paper-catalog-access";
import {readPlannedSources, type TurnSourceReader} from "./turn-reading";
import type {Payload} from "./task-store";
import {webToolGrantPattern} from "./web-tool-contract";

const only = (value: Record<string,unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const text = (value: unknown, limit: number): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= limit;
const paperIdentity = (value: unknown): value is string => typeof value === "string" && paperId(value);
const object = (value: unknown): value is Record<string,unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export async function queryPaperCatalog(catalog: PaperCatalogAccess, input: Record<string,unknown>, signal: AbortSignal) {
  signal.throwIfAborted();
  const {operation} = input;
  const invalid = () => new PaperCatalogError(400,"论文目录操作或参数无效。");
  function result<K extends keyof PaperQueryOutput>(operation: K, value: PaperQueryOutput[K]) {
    return {kind:paperResultKind,operation,value};
  }
  switch (operation) {
    case "records":
      if (!only(input,["operation","ids"])) throw invalid();
      return result(operation,await catalog.batch(input.ids));
    case "list":
      if (!only(input,["operation","cursor","limit","view"]) || typeof input.cursor !== "string" ||
        typeof input.limit !== "number" || !["full","catalog","map"].includes(input.view as string)) throw invalid();
      const page = await catalog.page(input);
      const value = page.read();
      const list = {...value,catalog:{...value.catalog,revision:page.revision}};
      return result(operation,list);
    case "questions":
      if (!only(input,["operation","id","cursor"]) || !paperIdentity(input.id) || typeof input.cursor !== "string") throw invalid();
      return result(operation,await catalog.questions(input.id,input.cursor));
    case "evidence":
      if (!only(input,["operation","id"]) || !paperIdentity(input.id)) throw invalid();
      return result(operation,(await catalog.evidence(input.id,{signal})).data);
    case "search":
      if (!only(input,["operation","query"])) throw invalid();
      return result(operation,await catalog.search(input.query,signal));
    default:
      throw invalid();
  }
}

export type SourceReadJob = {kind:typeof sourceReadKind;input:SourceReadInput};

export function prepareSourceRead(input: Record<string,unknown>, fetchAllowed: boolean): {body:SourceReadJob} | {issue:string} {
  const invalid = {issue:"精确读取须指定问题和 1–3 项有效的稳定来源，且只接受读取所需的工具许可。"};
  const grant = input.runtimeWebToolGrant;
  if (!only(input,["question","targets","deepseekFetch","runtimeWebToolGrant"]) || !text(input.question,4000) ||
    !Array.isArray(input.targets) || !input.targets.length || input.targets.length > 3 ||
    (grant !== undefined && (typeof grant !== "string" || !webToolGrantPattern.test(grant))) ||
    (input.deepseekFetch !== undefined && typeof input.deepseekFetch !== "boolean")) return invalid;
  const targets: SourceReadTarget[] = [];
  for (const target of input.targets) {
    if (!object(target)) return invalid;
    if (target.kind === "paper" && only(target,["kind","id"]) && paperIdentity(target.id)) {
      if (!targets.some(t => t.kind === "paper" && t.id === target.id)) targets.push({kind:"paper",id:target.id});
      continue;
    }
    if (target.kind !== "web" || !only(target,["kind","url","title","discoveredBy","locators"]) ||
      !text(target.url,2000) || !publicPage(target.url) || !text(target.title,360) ||
      (target.discoveredBy !== undefined && target.discoveredBy !== "user" && target.discoveredBy !== "assistant")) return invalid;
    const locators=parseSourceReadLocators(target.locators);
    if(target.locators!==undefined&&!locators)return invalid;
    const previous=targets.find(t=>t.kind==="web"&&t.url===target.url);
    if(previous?.kind==="web"&&JSON.stringify(previous.locators)!==JSON.stringify(locators))return invalid;
    // Keep the requested identity in the receipt. The transport independently validates and resolves it.
    if(!previous)targets.push({kind:"web",url:target.url,title:target.title,discoveredBy:target.discoveredBy,...(locators?{locators}:{})});
  }
  return {body:{kind:sourceReadKind,input:{question:input.question,targets,deepseekFetch:input.deepseekFetch === true && fetchAllowed,
    ...(grant !== undefined ? {runtimeWebToolGrant:grant} : {})}}};
}

export async function runSourceRead(job: SourceReadJob, signal: AbortSignal, emit: (event:Payload) => void,
  catalog: Pick<PaperCatalogAccess,"detail"|"evidence">, fetchAllowed: boolean, read:TurnSourceReader): Promise<Payload> {
  const {question,targets,deepseekFetch} = job.input;
  const papers: PaperRecord[] = [], issues:string[] = [];
  const paperEvidence: NonNullable<SourceReadResult["paperEvidence"]> = [];
  const web = targets.filter(target => target.kind === "web");
  let timedOut=false;
  const progress={id:"source-read",area:"reading"} as const;
  emit({researchProgressFact:{...progress,status:"running"}});
  const readPaper = async (id:string) => {
    signal.throwIfAborted();
    const call = {id:"read-paper-" + id,kind:"tool",name:"读取指定文献资料",input:id};
    emit({stage:"正在读取指定文献资料",call:{...call,status:"running"}});
    let paper: PaperRecord;
    try {paper = await catalog.detail(id);}
    catch (error) {
      if (!(error instanceof PaperCatalogError)) throw error;
      const issue = id + "：指定版本的文献资料不存在或不可用。";
      issues.push(issue);
      emit({call:{...call,status:"failed",error:issue}});
      return;
    }
    papers.push(paper);
    const metadataOnly=paper.assertionCatalogKind==="metadata-only";
    emit({finding:{id:call.id,source:"文献资料",summary:metadataOnly?"已读取指定版本的数据集元数据。":"已读取指定版本的论文记录。",items:[{assetId:paper.id,title:paper.need.product}]},
      sourceReadProgress:{papers:[paper]}});
    if(metadataOnly){
      emit({call:{...call,status:"done",output:JSON.stringify({id,stage:"assertion-record",papers:0,assertionCatalogKind:paper.assertionCatalogKind})}});
      return;
    }
    try {
      const {data} = await catalog.evidence(id,{fresh:true,signal});
      signal.throwIfAborted();
      if (!data.dataset && !data.papers.length) throw new PaperCatalogError(404,"断言库未返回此记录的内容。");
      const material = {id,evidence:data,readAt:new Date().toISOString()};
      paperEvidence.push(material);
      emit({call:{...call,status:"done",output:JSON.stringify({id,stage:"assertion-excerpt",papers:data.papers.length})},
        sourceReadProgress:{paperEvidence:[material]}});
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof PaperCatalogError)) throw error;
      const issue = id + "：" + error.message + " 已保留指定版本的论文记录。";
      issues.push(issue);
      emit({call:{...call,status:"partial",error:issue,output:JSON.stringify({id,stage:"assertion-record"})}});
    }
  };
  const [searches] = await Promise.all([
    readPlannedSources({action:"read",targets:web},question,signal,{
      read,configuredFetch:deepseekFetch === true && fetchAllowed,
      stage:(stage,runs) => emit({stage,...(runs ? {searches:runs.map(row=>({...row,hits:[...row.hits]}))} : {})}),
      report:call => emit({call}),
      onTimeout:()=>{timedOut=true;},
    }),
    Promise.all(targets.flatMap(target => target.kind === "paper" ? [readPaper(target.id)] : [])),
  ]);
  for (const run of searches) {
    if (run.status === "failed") issues.push(run.query + "：" + (run.error || "指定来源不可用。"));
    else for(const hit of run.hits)if(hit.locatorResults?.some(result=>result.status!=="found"))
      issues.push(run.query + "：" + (run.warning || "未完整取得指定位置的材料。"));
  }
  signal.throwIfAborted();
  const readCount=papers.length+searches.filter(run=>run.status==="done"&&run.hits.some(hit=>!!hit.pageExcerpt)).length;
  const status=readCount===targets.length&&!issues.length?"done":readCount?"partial":timedOut?"timeout":"failed";
  emit({researchProgressFact:{...progress,status,...(status==="done"||status==="partial"?{count:readCount}:{})}});
  const sourceReadResult:SourceReadResult = {searches,papers,issues,...(paperEvidence.length ? {paperEvidence} : {})};
  if (!papers.length && !searches.some(run => run.status === "done" && run.hits.length))
    return {sourceReadResult,error:"没有取得指定来源的材料。",code:"source_read_unavailable"};
  return {sourceReadResult};
}
