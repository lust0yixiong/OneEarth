import { randomUUID } from "node:crypto";
import { paperId } from "../src/domain/paper-record";
import type { Coordinate } from "../src/domain/types";
import {
  paperProjectionPageLimit, paperProjectionQueryKind, paperProjectionResultKind,
  type PaperMapEntry, type PaperProjectionHead, type PaperProjectionQuery, type PaperProjectionResult,
} from "./paper-projection-contract";
import type { SpatialPaperUpdate } from "./spatial-paper-store";

export type ProjectionQuery = (input: PaperProjectionQuery, signal: AbortSignal) => Promise<unknown>;

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const count = (value: unknown): value is number => number(value) && Number.isSafeInteger(value) && value >= 0;
type Area = NonNullable<PaperMapEntry["profile"]["area"]>;

function withinAxis(value: unknown, limit: 180 | 90): value is number {
  // Densified rectangle interpolation can overshoot an endpoint by two floating-point steps.
  const twoSteps = (limit === 180 ? 256 : 128) * Number.EPSILON;
  return number(value) && Math.abs(value) <= limit + twoSteps;
}
function point(value: unknown): value is Coordinate {
  return Array.isArray(value) && value.length === 2 && withinAxis(value[0], 180) && withinAxis(value[1], 90);
}
function polygon(value: unknown): value is Coordinate[][] {
  return Array.isArray(value) && value.length > 0 && value.every(ring => {
    if (!Array.isArray(ring) || ring.length < 4 || !ring.every(point)) return false;
    const first = ring[0], last = ring[ring.length - 1];
    // Check closure before rounding: clamping two endpoints must not repair an open ring.
    return first[0] === last[0] && first[1] === last[1];
  });
}
function area(value: unknown): value is Area {
  return object(value) &&
    (value.bbox === undefined || (Array.isArray(value.bbox) && value.bbox.length === 4 &&
      point(value.bbox.slice(0, 2)) && point(value.bbox.slice(2)))) &&
    (value.type === "Polygon" ? polygon(value.coordinates)
      : value.type === "MultiPolygon" && Array.isArray(value.coordinates) &&
        value.coordinates.length > 0 && value.coordinates.every(polygon));
}
function boundedPoint([longitude, latitude]: number[]): Coordinate {
  return [Math.max(-180, Math.min(180, longitude)), Math.max(-90, Math.min(90, latitude))];
}
function boundedArea(shape: Area): Area {
  const coordinates = (rings: number[][][]) => rings.map(ring => ring.map(boundedPoint));
  const bbox = shape.bbox ? {
    bbox: [...boundedPoint(shape.bbox.slice(0, 2)), ...boundedPoint(shape.bbox.slice(2))] as [number, number, number, number],
  } : {};
  return shape.type === "Polygon"
    ? { ...shape, ...bbox, coordinates: coordinates(shape.coordinates) }
    : { ...shape, ...bbox, coordinates: shape.coordinates.map(coordinates) };
}

function entry(value: unknown): PaperMapEntry {
  if (!object(value) || !text(value.id) || !paperId(value.id) || !text(value.dsKey) ||
      !text(value.title) || !text(value.type) || !text(value.source) || typeof value.published !== "boolean" ||
      !Array.isArray(value.points) || !value.points.every(point) || !object(value.profile))
    throw Error("Invalid paper coverage projection entry");
  const { profile } = value;
  const { role, spatial, coverage, areaBasis, extent, area: shape, years, utcWindow } = profile;
  if (typeof coverage !== "string" || (role !== "data" && role !== "index") ||
      (spatial !== "coverage" && spatial !== "nonspatial" && spatial !== "restricted") ||
      (areaBasis !== undefined && areaBasis !== "bounding-box" && areaBasis !== "geometry") ||
      (extent !== undefined && extent !== "world") || (shape !== undefined && !area(shape)) ||
      (years !== undefined && (!Array.isArray(years) || years.length !== 2 || !Number.isInteger(years[0]) ||
        !(years[1] === null || (Number.isInteger(years[1]) && years[1] >= years[0])))) ||
      (utcWindow !== undefined && (!Array.isArray(utcWindow) || utcWindow.length !== 2 ||
        !utcWindow.every(number) || utcWindow[0] >= utcWindow[1])))
    throw Error("Invalid paper coverage projection geometry or time");
  return {
    id: value.id, dsKey: value.dsKey, title: value.title, type: value.type, source: value.source,
    points: value.points.map(boundedPoint), published: value.published,
    profile: { role, spatial, coverage, areaBasis, extent, area: shape === undefined ? undefined : boundedArea(shape), years, utcWindow } as PaperMapEntry["profile"],
  };
}

function head(value: Record<string, unknown>, operation: "head" | "page"): PaperProjectionHead {
  const { revision, generation, versionCount, publishedCount } = value;
  if (value.operation !== operation || !text(revision) || !text(generation) ||
      !count(versionCount) || !count(publishedCount) || publishedCount > versionCount)
    throw Error("Invalid paper coverage projection head");
  return { revision, generation, versionCount, publishedCount };
}

function sameHead(a: PaperProjectionHead, b: PaperProjectionHead) {
  return a.generation === b.generation && a.revision === b.revision &&
    a.publishedCount === b.publishedCount && a.versionCount === b.versionCount;
}

export class ProjectionBaseUnavailable extends Error {}

export function discoveryPaperProjection(
  origin = process.env.ONEEARTH_DISCOVERY_URL || "http://127.0.0.1:5275",
  fetcher: typeof fetch = fetch,
): ProjectionQuery {
  return async (input, signal) => {
    const response = await fetcher(new URL("/message:send", origin), {
      method: "POST", redirect: "error",
      headers: { "A2A-Version": "1.0", "Content-Type": "application/a2a+json", Accept: "application/a2a+json" },
      body: JSON.stringify({ message: {
        messageId: randomUUID(), role: "ROLE_USER", parts: [{ data: { kind: paperProjectionQueryKind, input } }],
      } }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
    });
    const media = response.headers.get("content-type")?.split(";")[0].trim();
    if (media !== "application/json" && media !== "application/a2a+json") throw Error("Invalid paper projection response media");
    const result: unknown = await response.json();
    if (!response.ok) {
      const error = object(result) && object(result.error) ? result.error : result;
      if (object(error) && error.status === "FAILED_PRECONDITION" && Array.isArray(error.details) &&
          error.details.some(detail => object(detail) && detail.domain === "a2a-protocol.org" &&
            detail.reason === "CATALOG_BASE_UNAVAILABLE"))
        throw new ProjectionBaseUnavailable("Discovery cannot provide a delta from the local generation");
      throw Error("Discovery paper projection failed (HTTP " + response.status + ")");
    }
    const message = object(result) ? result.message : undefined;
    if (response.status !== 200 || !object(result) || result.error !== undefined || result.task !== undefined ||
        !object(message) || message.role !== "ROLE_AGENT" || !text(message.messageId) || !text(message.contextId) ||
        message.taskId !== undefined || !Array.isArray(message.parts) || message.parts.length !== 1)
      throw Error("Paper projection must arrive as one direct A2A Message");
    const part: unknown = message.parts[0];
    if (!object(part) || !object(part.data) || part.data.kind !== paperProjectionResultKind)
      throw Error("Invalid A2A paper projection result");
    return part.data.value;
  };
}

export async function fetchSpatialPaperUpdate(
  query: ProjectionQuery, current: PaperProjectionHead | null, signal: AbortSignal,
): Promise<SpatialPaperUpdate | null> {
  const reply = await query({ operation: "head" }, signal);
  if (!object(reply)) throw Error("Invalid paper coverage projection head");
  const target = head(reply, "head");
  if (current?.generation === target.generation) {
    if (!sameHead(current, target)) throw Error("Paper coverage projection changed under the same generation");
    return null;
  }
  async function pages(baseGeneration?: string): Promise<SpatialPaperUpdate> {
    const entries: PaperMapEntry[] = [];
    const published = new Set<string>();
    let cursor = "";
    do {
      const raw = await query({
        operation: "page", generation: target.generation, cursor, limit: paperProjectionPageLimit,
        ...(baseGeneration === undefined ? {} : { baseGeneration }),
      }, signal);
      if (!object(raw) || !sameHead(target, head(raw, "page")) || raw.baseGeneration !== baseGeneration ||
          !Array.isArray(raw.entries) || raw.entries.length > paperProjectionPageLimit)
        throw Error("Paper coverage projection pages do not describe the same generation");
      const page = raw as unknown as Extract<PaperProjectionResult, { operation: "page" }>;
      let last = cursor;
      for (const value of page.entries) {
        const row = entry(value);
        if (row.id <= last || (row.published && published.has(row.dsKey)))
          throw Error("Paper coverage projection has out-of-order or duplicate entries");
        if (row.published) published.add(row.dsKey);
        entries.push(row);
        last = row.id;
      }
      if (entries.length > target.versionCount || published.size > target.publishedCount ||
          (page.nextCursor !== null && (page.nextCursor !== last || last === cursor)))
        throw Error("Paper coverage projection pagination did not advance");
      cursor = page.nextCursor ?? "";
    } while (cursor);
    if (baseGeneration === undefined && (entries.length !== target.versionCount || published.size !== target.publishedCount))
      throw Error("Full paper coverage projection is incomplete");
    return { ...target, entries, ...(baseGeneration === undefined ? {} : { baseGeneration }) };
  }
  try {
    return await pages(current?.generation);
  } catch (error) {
    if (!current || !(error instanceof ProjectionBaseUnavailable)) throw error;
    return pages();
  }
}
