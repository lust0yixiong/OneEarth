export interface DeepSeekTools {
  search: boolean;
  fetch: boolean;
}

const storageKey = "oneearth.deepseek-tools.v1";
export const toolsOff: DeepSeekTools = {search: false, fetch: false};

export function validDeepSeekTools(value: unknown): value is DeepSeekTools {
  return !!value && typeof value === "object"
    && "search" in value && typeof value.search === "boolean"
    && "fetch" in value && typeof value.fetch === "boolean";
}

export function readDeepSeekTools(defaults: DeepSeekTools = toolsOff): DeepSeekTools {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (validDeepSeekTools(saved)) return saved;
  } catch { /* Older sessions and restricted storage use the defaults. */ }
  return defaults;
}

export async function loadDeepSeekTools(signal: AbortSignal): Promise<DeepSeekTools> {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (validDeepSeekTools(saved)) return saved;
  } catch { /* Read deployment defaults when browser preferences are unavailable. */ }
  try {
    const response = await fetch("/api/models/deepseek/tools", {
      cache: "no-store", signal: AbortSignal.any([signal,AbortSignal.timeout(3000)]),
    });
    if (response.ok) {
      const data = await response.json();
      if (validDeepSeekTools(data.defaults)) return readDeepSeekTools(data.defaults);
    }
  } catch { signal.throwIfAborted(); }
  return readDeepSeekTools();
}

export function saveDeepSeekTools(tools: DeepSeekTools) {
  localStorage.setItem(storageKey, JSON.stringify(tools));
}
