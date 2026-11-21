import { useSyncExternalStore } from "react";
import type { WindTheme } from "../globe/wind-layer";
const key="oneearth.wind.theme";
let memory: WindTheme = "light";
function read(): WindTheme {
  try {return localStorage.getItem(key)==="dark"?"dark":"light";}
  catch {return memory;}
}
function subscribe(update:()=>void) {
  window.addEventListener("storage",update);
  window.addEventListener(key,update);
  return ()=>{window.removeEventListener("storage",update);window.removeEventListener(key,update);};
}
function set(theme:WindTheme) {
  memory=theme;
  try {localStorage.setItem(key,theme);} catch { /* Available for this session. */ }
  window.dispatchEvent(new Event(key));
}
export function useWindTheme() {
  return [useSyncExternalStore(subscribe,read),set] as const;
}
