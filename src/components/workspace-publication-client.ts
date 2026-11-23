import {workspacePublicationRevision} from "../domain/workspace-view-context";

/** Local HTTP on the LAN can use the same-origin spatial service's strong ETag. */
export async function readWorkspacePublication(response:Response) {
  const bytes=await response.arrayBuffer();
  const etag=response.headers.get("etag");
  const published=workspacePublicationRevision(etag);
  let revision=published;
  if (globalThis.crypto?.subtle && (published || etag===null)) {
    const hash=await crypto.subtle.digest("SHA-256",bytes);
    revision=Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,"0")).join("");
    if (published && published!==revision) throw Error("发布目录校验失败");
  }
  return {bytes,revision};
}
