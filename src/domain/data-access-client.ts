import type {AccessPage,AccessQuery} from "./data-access";
export async function readAccessPage(query:AccessQuery,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<AccessPage>{
  const response=await fetcher("/api/data-access/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(query),signal});
  const result=await response.json();
  if(!response.ok)throw Error(result.error||"数据索引暂时无法读取。");
  if(!Array.isArray(result.rows)||result.rows.length>query.limit||!Number.isSafeInteger(result.total)||result.total<0||
    !Number.isSafeInteger(result.page)||!Number.isSafeInteger(result.pages)||!result.counts||
    ![result.counts.entities,result.counts.clues,result.counts.timely].every(n=>Number.isSafeInteger(n)&&n>=0)||
    result.rows.some((r:AccessPage["rows"][number])=>!r.key||!r.asset?.id||typeof r.asset.title!=="string"||!Array.isArray(r.ids)||!Array.isArray(r.relatedIds)))
    throw Error("数据索引返回的分页信息无效。");
  return result;
}
