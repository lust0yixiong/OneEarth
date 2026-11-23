import type {RainCatalog} from "./rainfall";

export const rainTileRoot = "/precip-data";

export function isRainYear(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1000 && value <= 9999;
}

export function readRainCatalog(value: unknown): RainCatalog {
  const catalog = value as Partial<RainCatalog> | null;
  if (catalog?.id !== "imerg-monthly" || !isRainYear(catalog.defaultYear) || !Array.isArray(catalog.years)) {
    throw Error("降水发布目录格式无效");
  }
  const years = new Map<number, Set<number>>();
  for (const entry of catalog.years) {
    if (!entry || !isRainYear(entry.year) || !Array.isArray(entry.months) ||
        entry.months.some(month => !Number.isInteger(month) || month < 1 || month > 12)) {
      throw Error("降水发布目录包含无效年月");
    }
    const months = years.get(entry.year) ?? new Set<number>();
    for (const month of entry.months) months.add(month);
    if (months.size) years.set(entry.year, months);
  }
  return {
    id: catalog.id,
    defaultYear: catalog.defaultYear,
    years: [...years.entries()].sort(([a], [b]) => a - b)
      .map(([year, months]) => ({year, months: [...months].sort((a, b) => a - b)})),
  };
}

export function publishedRainPeriod(catalog: RainCatalog, year: number | undefined, frame: number) {
  const published = catalog.years.find(entry => entry.year === year)
    ?? catalog.years.find(entry => entry.year === catalog.defaultYear)
    ?? catalog.years.at(-1);
  if (!published) return null;
  const month = published.months.includes(frame + 1) ? frame + 1 : published.months.at(-1)!;
  return {year: published.year, frame: month - 1};
}

function spans(values: number[]) {
  const runs: [number, number][] = [];
  for (const value of values) {
    const run = runs.at(-1);
    if (run && run[1] + 1 === value) run[1] = value;
    else runs.push([value, value]);
  }
  return runs.map(([first, last]) => first === last ? String(first) : first + "–" + last).join("、");
}

export function rainPublishedCoverage(catalog: RainCatalog) {
  const full = spans(catalog.years.filter(entry => entry.months.length === 12).map(entry => entry.year));
  const partial = catalog.years.filter(entry => entry.months.length < 12)
    .map(entry => entry.year + " 年（" + spans(entry.months) + " 月）");
  return [full && full + " 年（1–12 月）", ...partial].filter(Boolean).join(" · ");
}
