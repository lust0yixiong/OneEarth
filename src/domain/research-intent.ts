/** A summary of the user's expressed aim, not a finding about available data. */
export interface ResearchIntent {
  purpose: string;
  task: string;
  region: string | null;
  time: string | null;
  months: number[];
}

export function validResearchIntent(value: unknown): value is ResearchIntent {
  if (!value || typeof value !== "object") return false;
  const v = value as ResearchIntent;
  const text = (s: unknown) => typeof s === "string" && s.length <= 1200;
  return text(v.purpose) && text(v.task) &&
    (v.region === null || text(v.region)) && (v.time === null || text(v.time)) &&
    Array.isArray(v.months) && v.months.length <= 12 &&
    v.months.every(m => Number.isInteger(m) && m >= 1 && m <= 12) &&
    new Set(v.months).size === v.months.length;
}
