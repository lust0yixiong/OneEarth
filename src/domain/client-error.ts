export function rememberClientError(error: unknown, area: string) {
  const detail = error instanceof Error ? error.stack || error.message : String(error);
  console.error("OneEarth " + area, error);
  try {
    localStorage.setItem("oneearth.last-error", JSON.stringify({
      time: new Date().toISOString(), area, detail: detail.slice(0, 6000),
    }));
  } catch { /* Error reporting must also work when browser storage is unavailable. */ }
}
