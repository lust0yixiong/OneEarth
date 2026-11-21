import {useSyncExternalStore} from "react";
import {defaultDistributionMode,distributionPreferenceKey,parseDistributionMode,type DistributionMode} from "../domain/distribution-modes";
let memory:DistributionMode=defaultDistributionMode;
function read() {
  try{return parseDistributionMode(localStorage.getItem(distributionPreferenceKey));}
  catch{return memory;}
}
function subscribe(update:()=>void) {
  window.addEventListener("storage",update);
  window.addEventListener(distributionPreferenceKey,update);
  return ()=>{window.removeEventListener("storage",update);window.removeEventListener(distributionPreferenceKey,update);};
}
function set(mode:DistributionMode) {
  memory=mode;
  try{localStorage.setItem(distributionPreferenceKey,mode);}catch{/* Retain the preference for this session. */}
  window.dispatchEvent(new Event(distributionPreferenceKey));
}
export function useDistributionMode() {
  return [useSyncExternalStore(subscribe,read),set] as const;
}
