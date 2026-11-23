import {useSyncExternalStore} from "react";

const key = "oneearth.data-access-navigation.v1";
let sessionChoice: boolean | undefined;

function read() {
  if (sessionChoice !== undefined) return sessionChoice;
  try { return localStorage.getItem(key) === "true"; }
  catch { return false; }
}

function subscribe(update: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key === key || event.key === null) {
      sessionChoice = undefined;
      update();
    }
  }
  window.addEventListener("storage", onStorage);
  window.addEventListener(key, update);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(key, update);
  };
}

function set(visible: boolean) {
  try {
    localStorage.setItem(key, String(visible));
    sessionChoice = undefined;
  } catch {
    sessionChoice = visible;
  }
  window.dispatchEvent(new Event(key));
}

export function useDataAccessNavigation() {
  return [useSyncExternalStore(subscribe, read), set] as const;
}
