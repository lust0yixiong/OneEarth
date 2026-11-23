import express from "express";
import { DatabaseSync } from "node:sqlite";
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Footprint,
  Observation,
  PushFeed,
} from "../src/domain/push-observations";
import { observationMatches, type ObservationQuery } from "./observation-query";
import type { Coordinate } from "../src/domain/types";

type Source = { name: string; token: string; test?: boolean };
export type PushSources = Record<string, Source>;
export function parseSources(raw: string | undefined): PushSources {
  const v = JSON.parse(raw || "{}");
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.entries(v).some(
      ([id, s]: [string, any]) =>
        !/^[a-zA-Z0-9_-]{1,64}$/.test(id) ||
        !s ||
        typeof s.name !== "string" ||
        !s.name.trim() ||
        typeof s.token !== "string" ||
        s.token.length < 24 ||
        (s.test !== undefined && typeof s.test !== "boolean"),
    )
  )
    throw Error("星座来源配置无效。");
  return v;
}
class InputError extends Error {}
function invalid(field: string): never {
  throw new InputError("无效字段 " + field);
}
function label(v: unknown, k: string, max = 160): string {
  return typeof v === "string" && v.trim() && v.trim().length <= max
    ? v.trim()
    : invalid(k);
}
function iso(v: unknown, k: string) {
  const s = label(v, k, 40);
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(
      s,
    ) ||
    !Number.isFinite(Date.parse(s))
  )
    invalid(k);
  return new Date(s).toISOString();
}
function position(p: unknown): p is Coordinate {
  return (
    Array.isArray(p) &&
    p.length === 2 &&
    p.every(Number.isFinite) &&
    Math.abs(p[0]) <= 180 &&
    Math.abs(p[1]) <= 90
  );
}
function footprint(v: any): Footprint {
  if (v?.type === "Point" && position(v.coordinates))
    return { type: "Point", coordinates: v.coordinates };
  const rings =
    v?.type === "Polygon"
      ? [v.coordinates]
      : v?.type === "MultiPolygon"
        ? v.coordinates
        : null;
  if (!Array.isArray(rings) || !rings.length || rings.length > 64)
    invalid("geometry");
  let vertices = 0;
  for (const poly of rings) {
    if (!Array.isArray(poly) || !poly.length) invalid("geometry");
    for (const ring of poly) {
      if (
        !Array.isArray(ring) ||
        ring.length < 4 ||
        !ring.every(position) ||
        JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1)) ||
        new Set(ring.map((p) => p.join(","))).size < 3 ||
        (vertices += ring.length) > 2048
      )
        invalid("geometry");
    }
  }
  return { type: v.type, coordinates: v.coordinates };
}
const digest = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
function parseObservation(v: any, sourceId: string, source: Source) {
  if (!v || v.schemaVersion !== 1) invalid("schemaVersion");
  const id = label(v.id, "id"),
    collection = label(v.collection, "collection"),
    revision = v.revision;
  if (!Number.isSafeInteger(revision) || revision < 1) invalid("revision");
  const observedAt = iso(v.observedAt, "observedAt"),
    publishedAt =
      v.publishedAt == null ? null : iso(v.publishedAt, "publishedAt");
  if (
    Date.parse(observedAt) > Date.now() + 300000 ||
    (publishedAt &&
      (publishedAt < observedAt ||
        Date.parse(publishedAt) > Date.now() + 300000))
  )
    invalid("观测或发布时间");
  const measurements = v.measurements ?? [];
  if (!Array.isArray(measurements) || measurements.length > 256)
    invalid("measurements");
  let productUrl: string | null = null;
  if (v.productUrl != null) {
    const url = URL.parse(label(v.productUrl, "productUrl", 2048));
    if (!url || url.protocol !== "https:" || url.username || url.password)
      invalid("productUrl");
    productUrl = url.href;
  }
  let bytes: Buffer | null = null,
    file: Observation["file"] = null;
  if (v.file != null) {
    const name = label(v.file.name, "file.name", 120),
      body = v.file.base64;
    if (
      /[\\/\x00-\x1f\x7f]/.test(name) ||
      typeof body !== "string" ||
      !body.length ||
      body.length > 2796204
    )
      invalid("file");
    bytes = Buffer.from(body, "base64");
    if (
      !bytes.length ||
      bytes.length > 2097152 ||
      bytes.toString("base64") !== body
    )
      invalid("file.base64");
    file = { name, bytes: bytes.length, sha256: digest(bytes) };
  }
  if (!bytes && !productUrl && !measurements.length)
    invalid("请提供观测值、产品文件或产品链接");
  const key = digest(JSON.stringify([sourceId, collection, id, revision]));
  const data: Omit<Observation, "receivedAt"> = {
    key,
    sourceId,
    sourceName: source.name,
    test: source.test === true,
    collection,
    id,
    revision,
    title: label(v.title, "title"),
    satellite: label(v.satellite, "satellite"),
    observedAt,
    publishedAt,
    geometry: footprint(v.geometry),
    measurements: measurements.map((m) => ({
      variable: label(m?.variable, "variable"),
      value: Number.isFinite(m?.value) ? m.value : invalid("value"),
      unit: label(m.unit, "unit", 48),
    })),
    productUrl,
    file,
  };
  return {
    data,
    bytes,
    hash: digest(
      JSON.stringify({ ...data, sourceName: undefined, test: undefined }),
    ),
  };
}

export function constellationService(filename: string, sources: PushSources) {
  let db: DatabaseSync | undefined;
  let satelliteCache: { dataVersion: number; names: string[] } | undefined;
  function database() {
    if (db) return db;
    if (filename !== ":memory:")
      mkdirSync(dirname(filename), { recursive: true });
    db = new DatabaseSync(filename);
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS observations (key TEXT PRIMARY KEY, source TEXT NOT NULL, collection TEXT NOT NULL,
      scene TEXT NOT NULL, rev INTEGER NOT NULL, observed TEXT NOT NULL, hash TEXT NOT NULL, payload TEXT NOT NULL, file BLOB,
      UNIQUE(source,collection,scene,rev));
    CREATE INDEX IF NOT EXISTS obs_observed_key ON observations(observed DESC, key);
    CREATE INDEX IF NOT EXISTS obs_satellite_time ON observations(json_extract(payload, '$.satellite') COLLATE NOCASE, observed DESC, key);`);
    return db;
  }
  function satellites(): string[] {
    const conn = database();
    const dataVersion = Number(conn.prepare("PRAGMA data_version").get()?.data_version);
    if (satelliteCache?.dataVersion !== dataVersion) {
      const names = conn.prepare("SELECT DISTINCT json_extract(payload, '$.satellite') COLLATE NOCASE AS satellite FROM observations WHERE json_extract(payload, '$.test') = 0")
        .all().map(row => String(row.satellite));
      satelliteCache = { dataVersion, names };
    }
    return satelliteCache.names;
  }
  function latest(filter?: Coordinate | ObservationQuery, parentIds?: string[]): PushFeed {
    const query: ObservationQuery | undefined = Array.isArray(filter)
      ? { satellites: [], point: filter, unsupported: [], conditions: [] }
      : filter;
    const records: Observation[] = [];
    if (!query?.unsupported.length && (!parentIds || parentIds.length)) {
      const conditions = parentIds ? ["a.key IN (" + parentIds.map(() => "?").join(",") + ")"] : [`NOT EXISTS (SELECT 1 FROM observations b WHERE b.source=a.source AND
        b.collection=a.collection AND b.scene=a.scene AND b.rev>a.rev)`];
      const args = parentIds?.map(id => id.slice("constellation:".length)) || [];
      conditions.push("json_extract(a.payload, '$.test') = 0");
      if (query?.time) {
        conditions.push("a.observed >= ? AND a.observed < ?");
        args.push(query.time.start, query.time.end);
      }
      if (query?.satellites.length) {
        conditions.push("json_extract(a.payload, '$.satellite') COLLATE NOCASE IN (" + query.satellites.map(() => "?").join(",") + ")");
        args.push(...query.satellites);
      }
      const spatial = query?.selection || query?.point;
      const stmt = database().prepare("SELECT a.payload FROM observations a WHERE " + conditions.join(" AND ") +
        " ORDER BY a.observed DESC, a.key" + (spatial ? "" : " LIMIT 50"));
      for (const row of stmt.iterate(...args)) {
        const r: Observation = JSON.parse(String(row.payload));
        if (spatial && query && !observationMatches(r, query)) continue;
        records.push(r);
        if (records.length === 50) break;
      }
    }
    return {
      records,
      checkedAt: new Date().toISOString(),
      configured: Object.values(sources).filter(source => source.test !== true).length,
    };
  }
  const router = express.Router();
  const clients = new Set<express.Response>();
  router.get("/events", (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write("retry: 3000\nevent: ready\ndata: {}\n\n");
    clients.add(res);
    const keepalive = setInterval(() => res.write(": heartbeat\n\n"), 25000);
    res.once("close", () => {
      clients.delete(res);
      clearInterval(keepalive);
    });
  });
  router.get("/observations", (_req, res) =>
    res.set("Cache-Control", "no-store").json(latest()),
  );
  router.get("/observations/:key", (req, res) => {
    const row = database()
      .prepare("SELECT payload FROM observations WHERE key=?")
      .get(req.params.key);
    if (!row) {
      res.sendStatus(404);
      return;
    }
    res.type("json").send(row.payload);
  });
  router.get("/observations/:key/file", (req, res) => {
    const row = database()
      .prepare("SELECT payload,file FROM observations WHERE key=?")
      .get(req.params.key);
    if (!row?.file) {
      res.sendStatus(404);
      return;
    }
    const r: Observation = JSON.parse(String(row.payload));
    res
      .attachment(r.file!.name)
      .type("application/octet-stream")
      .set("X-Content-Type-Options", "nosniff")
      .send(Buffer.from(row.file as Uint8Array));
  });
  router.post(
    "/:sourceId/observations",
    (req, res, next) => {
      const source = Object.hasOwn(sources, req.params.sourceId)
        ? sources[req.params.sourceId]
        : null;
      const authorization = req.get("authorization") || "";
      if (
        !source ||
        !timingSafeEqual(
          Buffer.from(digest(authorization)),
          Buffer.from(digest("Bearer " + source.token)),
        )
      ) {
        res.status(401).json({ error: "星座来源或凭据无效。" });
        return;
      }
      next();
    },
    express.json({ limit: "3mb" }),
    (req, res, next) => {
      try {
        const { data, hash, bytes } = parseObservation(
          req.body,
          req.params.sourceId,
          sources[req.params.sourceId],
        );
        const record: Observation = {
          ...data,
          receivedAt: new Date().toISOString(),
        };
        const conn = database();
        const result = conn
          .prepare(
            "INSERT INTO observations(key,source,collection,scene,rev,observed,hash,payload,file) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO NOTHING",
          )
          .run(
            data.key,
            data.sourceId,
            data.collection,
            data.id,
            data.revision,
            data.observedAt,
            hash,
            JSON.stringify(record),
            bytes,
          );
        if (result.changes) {
          satelliteCache = undefined;
          for (const client of clients)
            client.write("event: observation\ndata: {}\n\n");
          res
            .status(201)
            .json({
              key: data.key,
              status: "accepted",
              receivedAt: record.receivedAt,
            });
          return;
        }
        const old = conn
          .prepare("SELECT hash,payload FROM observations WHERE key=?")
          .get(data.key)!;
        if (old.hash !== hash) {
          res
            .status(409)
            .json({ error: "同一版次已有不同内容，请增加 revision。" });
          return;
        }
        res.json({
          key: data.key,
          status: "duplicate",
          receivedAt: JSON.parse(String(old.payload)).receivedAt,
        });
      } catch (err) {
        if (err instanceof InputError) {
          res.status(400).json({ error: err.message });
          return;
        }
        next(err);
      }
    },
  );
  return { router, latest, satellites,
    version:()=>String(database().prepare("PRAGMA data_version").get()?.data_version)+":"+String(database().prepare("SELECT max(rowid) AS n FROM observations").get()?.n||0),
    *catalogRecords():Generator<Observation>{
      for(const row of database().prepare("SELECT payload FROM observations WHERE json_extract(payload,'$.test')=0").iterate())yield JSON.parse(String(row.payload));
    },
    status:()=>({configured:Object.values(sources).filter(s=>!s.test).length,
      sources:Object.entries(sources).filter(([,s])=>!s.test).map(([id,s])=>({id,name:s.name}))}),
    endStreams: () => { for (const response of clients) response.end(); },
    close: () => db?.close() };
}
