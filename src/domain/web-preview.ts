import type {EvidenceDocument,EvidenceTab} from "./types";

export function webUrl(raw?:string) {
  try {
    const url=new URL(raw || "");
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null;
  } catch {return null;}
}
export function previewableTab(tab:EvidenceTab) {
  return tab.kind!=="web" || !!webUrl(tab.url);
}
export function webDocument(url:URL,title:string,snippet?:string):EvidenceDocument {
  return {id:"web:"+url.href,title:title || url.hostname,scope:"来源网页",source:url.hostname,url:url.href,
    tabs:[{kind:"web",label:"网页",url:url.href,body:snippet}]};
}
