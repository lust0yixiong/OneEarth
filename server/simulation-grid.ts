import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { geoBounds } from "d3-geo";
import { Router } from "express";
import type { Polygon } from "geojson";
import {
  cellAt,
  cellShape,
  s2Levels,
} from "../src/data/evidence/research-grid.mjs";
import { footprintInCell } from "../src/domain/push-observations";
import type { GridSpec } from "../src/domain/types";

const unpack = promisify(gunzip);
const pointCount = 9_988_000;
const blockSize = 65_536;
type Row = [number, number, number, number, number?, number?]; // id, source, lon, lat, half-width, half-height

export function simulationGrid(directory: string) {
  const router = Router();
  const blocks = new Map<number, Promise<Int32Array>>();
  let ranges: Promise<number[][]> | undefined;
  const cells = new Map<string, Promise<Row[]>>();
  async function records(id: string, grid: GridSpec) {
    const polygon = cellShape(id, grid).geometry as Polygon;
    const [[west, south], [east, north]] = geoBounds(polygon);
    const rows: Row[] = [];
    for (let block = 0; block * blockSize < pointCount; block++) {
      let job = blocks.get(block);
      if (!job) {
        job = readFile(path.join(directory, "points", block + ".gz"))
          .then(unpack)
          .then(
            (buf) =>
              new Int32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4),
          )
          .catch((error) => {
            blocks.delete(block);
            throw error;
          });
        blocks.set(block, job);
      }
      const coords = await job;
      for (let i = 0; i < coords.length; i += 2) {
        const lat = coords[i + 1] / 100000;
        if (lat < south || lat > north) continue;
        const lon = coords[i] / 100000;
        if (west <= east ? lon < west || lon > east : lon < west && lon > east)
          continue;
        if (cellAt([lon, lat], grid) === id) {
          const index = block * blockSize + i / 2;
          rows.push([index + 1, index % 3, lon, lat]);
        }
      }
      if (block % 8 === 0)
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    ranges ??= readFile(path.join(directory, "ranges.json"), "utf8")
      .then(JSON.parse)
      .catch((error) => {
        ranges = undefined;
        throw error;
      });
    const areas = await ranges!;
    for (const [i, [lon, lat, source, w, h]] of areas.entries()) {
      if (lat + h < south - 0.01 || lat - h > north + 0.01) continue;
      const a = [lon - w, lat - h],
        b = [lon - w, lat + h],
        c = [lon + w, lat + h],
        d = [lon + w, lat - h];
      if (
        footprintInCell(
          { type: "Polygon", coordinates: [[a, b, c, d, a]] },
          polygon,
        )
      )
        rows.push([pointCount + i + 1, source, lon, lat, w, h]);
    }
    return rows;
  }
  router.get("/", async (req, res) => {
    const { system, id } = req.query;
    const family = Number(req.query.family ?? -1);
    const n = Number(req.query.n),
      lon = Number(req.query.lon),
      lat = Number(req.query.lat);
    const source = Number(req.query.source ?? -1),
      offset = Number(req.query.offset ?? 0);
    if (
      typeof id !== "string" ||
      !Number.isInteger(n) ||
      !(
        (system === "h3" && n >= 2 && n <= 7) ||
        (system === "s2" && s2Levels.includes(n))
      ) ||
      !Number.isFinite(lon) ||
      Math.abs(lon) > 180 ||
      !Number.isFinite(lat) ||
      Math.abs(lat) > 90 ||
      ![-1, 0, 1, 2].includes(source) ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      ![-1, 0, 1, 2].includes(family)
    ) {
      res.status(400).end();
      return;
    }
    const grid = { system, n } as GridSpec;
    if (cellAt([lon, lat], grid) !== id) {
      res.status(400).end();
      return;
    }
    try {
      const key = system + ":" + id;
      let job = cells.get(key);
      if (!job) {
        if (cells.size >= 12) cells.delete(cells.keys().next().value!);
        job = records(id, grid).catch((error) => {
          cells.delete(key);
          throw error;
        });
        cells.set(key, job);
      }
      const scoped = (await job).filter(
        (row) => source < 0 || row[1] === source,
      );
      const selected =
        family < 0 ? scoped : scoped.filter((row) => row[1] === family);
      const sourceCounts = [0, 0, 0];
      for (const row of scoped) sourceCounts[row[1]]++;
      res.json({
        total: scoped.length,
        sourceCounts,
        rows: selected.slice(offset, offset + 24),
      });
    } catch {
      res.status(503).json({ error: "模拟记录文件暂时无法读取" });
    }
  });
  return router;
}
