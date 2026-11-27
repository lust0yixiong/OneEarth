import type {Coordinate} from "./types";

export type CaseObservationKind = "usgs-earthquake" | "awc-metar";
export type CaseObservationStatus = "not-selected" | "unavailable";
export type CaseObservationRef = {
  kind: CaseObservationKind;
  snapshotId: string;
  id: string;
  observedAt: number;
};
export type CaseObservation = Omit<CaseObservationRef, "kind"> & {
  point: Coordinate;
  sourceUrl: string;
} & (
  | {kind: "usgs-earthquake"; place: string; magnitude: number | null; depthKm: number | null}
  | {kind: "awc-metar"; stationName: string; weather: string; temperatureC: number | null; windKnots: number | null; storm: boolean}
);

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const eventId = /^[a-z0-9][a-z0-9_-]{0,79}$/iu;
const stationId = /^[A-Z0-9]{2,12}$/u;
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const isTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value < 8_640_000_000_000_000;
const isNumber = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value));
const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const refFields = ["kind", "snapshotId", "id", "observedAt"];

export function readCaseObservationRef(value: unknown): CaseObservationRef | undefined {
  if (!isObject(value) || Object.keys(value).some(key => !refFields.includes(key))) return;
  const {kind, snapshotId, id, observedAt} = value;
  const validId = kind === "usgs-earthquake" ? eventId : kind === "awc-metar" ? stationId : undefined;
  if (!validId || typeof id !== "string" || !validId.test(id) ||
    typeof snapshotId !== "string" || !uuid.test(snapshotId) || !isTime(observedAt)) return;
  return {kind: kind as CaseObservationKind, snapshotId, id, observedAt};
}

export function caseObservationUrl(kind: CaseObservationKind, id: string) {
  return kind === "usgs-earthquake"
    ? "https://earthquake.usgs.gov/earthquakes/eventpage/" + encodeURIComponent(id)
    : "https://aviationweather.gov/api/data/metar?ids=" + encodeURIComponent(id) + "&format=json";
}

/** Reopening a result validates the saved shape, rather than checking live freshness. */
export function readCaseObservation(value: unknown): CaseObservation | undefined {
  if (!isObject(value)) return;
  const {kind, snapshotId, id, observedAt, sourceUrl, point} = value;
  const ref = readCaseObservationRef({kind, snapshotId, id, observedAt});
  if (!ref || sourceUrl !== caseObservationUrl(ref.kind, ref.id) ||
    !Array.isArray(point) || point.length !== 2 ||
    !point.every((coordinate, index) => typeof coordinate === "number" &&
      Number.isFinite(coordinate) && Math.abs(coordinate) <= (index ? 90 : 180))) return;
  const base = {...ref, sourceUrl: sourceUrl as string, point: [point[0], point[1]] as Coordinate};
  if (ref.kind === "usgs-earthquake") {
    const {place, magnitude, depthKm} = value;
    if (!isText(place, 240) || !place || !isNumber(magnitude) || !isNumber(depthKm)) return;
    return {...base, kind: ref.kind, place, magnitude, depthKm};
  }
  const {stationName, weather, temperatureC, windKnots, storm} = value;
  if (!isText(stationName, 200) || !stationName || !isText(weather, 200) ||
    !isNumber(temperatureC) || !isNumber(windKnots) || typeof storm !== "boolean") return;
  return {...base, kind: ref.kind, stationName, weather, temperatureC, windKnots, storm};
}

export function caseObservationCase(kind: CaseObservationKind) {
  return kind === "usgs-earthquake" ? "earthquakes" : "live-lightning";
}

export function readCaseObservationStatus(value: unknown): CaseObservationStatus | undefined {
  return value === "not-selected" || value === "unavailable" ? value : undefined;
}
