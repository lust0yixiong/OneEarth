import { fetchSource, type SourceRequest } from "./source-fetch";
import {createHash} from "node:crypto";
import { SourceReadError } from "./source-read-error";

export const pdfChunkSize = 65536;
const upstreamChunkSize = 32768;
const cacheLimit = 32_000_000;
const defaultSnapshotByteBudget = 4 * 1024 * 1024;
export const researchPdfByteBudget = 6 * 1024 * 1024;

export interface RemotePdf {
  url: string;
  size: number;
  validator: string;
  at: number;
  first: Buffer;
}

/** One bounded response is a version snapshot even when the server offers no range validator. */
export async function readPdfSnapshot(url:string,signal:AbortSignal,request?:SourceRequest,maxBytes=defaultSnapshotByteBudget){
  const limit=Math.min(researchPdfByteBudget,maxBytes);
  if(!Number.isSafeInteger(limit)||limit<=0)throw new SourceReadError('PDF 读取预算已用尽。','WEB_FETCH_TOO_LARGE');
  const response=await fetchSource(url,signal,request,{maxBytes:limit});
  if(response.status!==200||response.truncated||response.bytes.length>limit||response.bytes.subarray(0,5).toString()!=='%PDF-')
    throw new SourceReadError('原站未返回本轮字节预算内完整的单响应 PDF。','SOURCE_INVALID_RANGE');
  return {...response,fingerprint:'sha256:'+createHash('sha256').update(response.bytes).digest('hex')};
}

/** Cache aligned blocks so overlapping page reads reuse the same bytes and in-flight requests. */
export function pdfRangeReader(request?: SourceRequest) {
  const cache = new Map<string, Buffer>();
  const pending = new Map<string, Promise<Buffer>>();
  const queue: (() => void)[] = [];
  let active = 0;
  let cachedBytes = 0;

  async function load(remote: RemotePdf, start: number, end: number) {
    if(!remote.validator || /^W\//i.test(remote.validator))throw new SourceReadError('PDF 无强版本标记，需先读取有界单响应快照；不能拼接不同响应。','SOURCE_INVALID_RANGE');
    if (active >= 6) await new Promise<void>(resolve => queue.push(resolve));
    else active++;
    try {
      const getPart = (timeout: number) => fetchSource(remote.url, AbortSignal.timeout(timeout), request, {
        range: 'bytes=' + start + '-' + end,
        ifRange: remote.validator,
        maxBytes: end-start+1,
      });
      const part = await getPart(15000).catch(error => {
        if (error instanceof SourceReadError) throw error;
        return getPart(25000);
      });
      const expected = 'bytes ' + start + '-' + end + '/' + remote.size;
      const validator = part.headers.etag || part.headers['last-modified'] || '';
      if (part.status !== 206 || part.truncated || part.headers['content-range'] !== expected ||
          part.bytes.length !== end - start + 1 || (remote.validator && validator !== remote.validator)) {
        throw new SourceReadError('来源 PDF 已变化，请重新读取。', 'SOURCE_INVALID_RANGE');
      }
      return part.bytes;
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  }

  function block(id: string, remote: RemotePdf, start: number) {
    const end = Math.min(remote.size, start + upstreamChunkSize) - 1;
    if (end < remote.first.length) return remote.first.subarray(start, end + 1);
    const key = id + ':' + remote.url + ':' + remote.validator + ':' + remote.size + ':' + start;
    const known = cache.get(key) || pending.get(key);
    if (known) return known;
    const task = load(remote, start, end).then(bytes => {
      cache.set(key, bytes);
      cachedBytes += bytes.length;
      while (cachedBytes > cacheLimit) {
        const oldest = cache.keys().next().value!;
        cachedBytes -= cache.get(oldest)!.length;
        cache.delete(oldest);
      }
      return bytes;
    }).finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }

  return async (id: string, remote: RemotePdf, start: number, end: number, signal: AbortSignal) => {
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>=remote.size)throw new SourceReadError('PDF 读取范围无效。','SOURCE_INVALID_RANGE');
    signal.throwIfAborted();
    if (start === 0 && remote.validator && remote.size > 8_000_000) {
      // PDF.js next looks up the trailer and page tree. Start a bounded read
      // of the final display chunk while it parses the document header.
      const tail = Math.floor((remote.size - 1) / pdfChunkSize) * pdfChunkSize;
      for (let offset = tail; offset < remote.size; offset += upstreamChunkSize) {
        Promise.resolve(block(id, remote, offset)).catch(() => {});
      }
    }
    if (end < remote.first.length) return remote.first.subarray(start, end+1);
    const aligned = start - start % upstreamChunkSize;
    const buffers: Buffer[] = [];
    for (let group = aligned; group <= end; group += upstreamChunkSize * 4) {
      signal.throwIfAborted();
      const batch = [];
      for (let offset = group; offset <= end && batch.length < 4; offset += upstreamChunkSize) {
        batch.push(block(id, remote, offset));
      }
      buffers.push(...await Promise.all(batch));
    }
    return Buffer.concat(buffers).subarray(start - aligned, end - aligned + 1);
  };
}
