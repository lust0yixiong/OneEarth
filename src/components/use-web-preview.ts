import {knownSourceOpening,prepareSourceOpening} from "../domain/source-opening";
import {useEffect,type MouseEvent} from "react";
import {useWorkspace} from "../domain/store";
import type {WebHit} from "../domain/types";
import {webDocument,webUrl} from "../domain/web-preview";

// Handle ordinary link activation within research surfaces; keep native copy-link,
// modified clicks and file downloads available.
export function useWebPreview(hits?:WebHit[],onOpen?:()=>void,urls:string[]=[]) {
  const {patch}=useWorkspace();
  const targets=JSON.stringify([...new Set([...(hits?.map(h=>h.url)||[]),...urls])].slice(-32));
  useEffect(()=>{
    for(const raw of JSON.parse(targets)){
      const url=webUrl(raw);if(url)void prepareSourceOpening(url.href);
    }
  },[targets]);
  return (event:MouseEvent<HTMLElement>)=>{
    if(event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)return;
    const link=event.target instanceof Element?event.target.closest<HTMLAnchorElement>("a[href]"):null;
    if(!link || !event.currentTarget.contains(link) || link.hasAttribute("download") || link.hasAttribute("data-external"))return;
    const url=webUrl(link.href);
    if(!url)return;
    if(knownSourceOpening(url.href)?.disposition!=="preview"){
      // Native activation preserves the browser's popup and modifier handling.
      link.target="_blank";
      link.rel="noreferrer noopener";
      void prepareSourceOpening(url.href);
      return;
    }
    event.preventDefault();
    const hit=hits?.find(hit=>webUrl(hit.url)?.href===url.href);
    onOpen?.();
    patch({evidence:webDocument(url,hit?.title || link.title || link.textContent?.trim() || url.hostname,hit?.snippet),previewKind:"web"});
  };
}
