import type { Filters } from "./types";

// UTC half-open intervals keep month ends and exact acquisition instants unambiguous.
export type UtcWindow = [number, number];
export function validWindow(v: unknown): v is UtcWindow {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    v.every((n) => Number.isSafeInteger(n) && Math.abs(n) < 8.64e15) &&
    v[0] < v[1]
  );
}
export function windowFilters(
  w: UtcWindow,
): Pick<Filters, "period" | "utcWindow"> {
  return {
    utcWindow: w,
    period: [
      new Date(w[0]).getUTCFullYear(),
      new Date(w[1] - 1).getUTCFullYear(),
    ],
  };
}
export function withinWindow(time: string, w?: UtcWindow | null) {
  const t = Date.parse(time);
  return !w || (t >= w[0] && t < w[1]);
}
export function dateEvidence(value: unknown, w: UtcWindow) {
  if (typeof value !== "string") return false;
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [y, m] = value.split("-").map(Number);
    return Date.UTC(y, m - 1, 1) >= w[0] && Date.UTC(y, m, 1) <= w[1];
  }
  if (!/^\d{4}-\d\d-\d\d/.test(value)) return false;
  if (value.length === 10)
    return Date.parse(value) >= w[0] && Date.parse(value) + 86400000 <= w[1];
  return withinWindow(value, w);
}
export function windowLabel(w: UtcWindow) {
  const first = new Date(w[0]).toISOString(),
    last = new Date(w[1] - 1).toISOString();
  if (w[1] - w[0] === 1)
    return first.slice(0, 10) + " " + first.slice(11, 19) + " UTC";
  if (
    first.slice(0, 7) === last.slice(0, 7) &&
    first.slice(8, 10) === "01" &&
    new Date(w[1]).getUTCDate() === 1
  )
    return first.slice(0, 7);
  return (
    first.slice(0, 16).replace("T", " ") +
    " 至 " +
    last.slice(0, 16).replace("T", " ") +
    " UTC"
  );
}
