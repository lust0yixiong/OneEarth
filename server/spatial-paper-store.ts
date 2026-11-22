import type { Pool, PoolClient } from "pg";
import { productDatabase } from "./product-database";
import type { PaperMapEntry, PaperProjectionHead } from "./paper-projection-contract";
import type { Filters } from "../src/domain/types";
import { projectedPaperBounds } from "./spatial-paper-bounds";
import type { Bounds } from "./spatial-store";

export type SpatialPaperSnapshot = PaperProjectionHead & { entries: PaperMapEntry[] };
export type SpatialPaperUpdate = SpatialPaperSnapshot & { baseGeneration?: string };

const schema = `
  CREATE TABLE IF NOT EXISTS spatial_paper_records (
    id text PRIMARY KEY,
    dataset_key text NOT NULL,
    projection jsonb NOT NULL,
    bounds geometry(Polygon,4326),
    years numrange,
    observed_window numrange
  );
  CREATE TABLE IF NOT EXISTS spatial_paper_members (
    id text PRIMARY KEY REFERENCES spatial_paper_records(id),
    dataset_key text NOT NULL,
    published boolean NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS spatial_paper_current_dataset
    ON spatial_paper_members(dataset_key) WHERE published;
  CREATE INDEX IF NOT EXISTS spatial_paper_bounds_gist ON spatial_paper_records USING gist (bounds);
  CREATE INDEX IF NOT EXISTS spatial_paper_years_gist ON spatial_paper_records USING gist (years);
  CREATE INDEX IF NOT EXISTS spatial_paper_window_gist ON spatial_paper_records USING gist (observed_window);
  CREATE TABLE IF NOT EXISTS spatial_paper_state (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    generation text NOT NULL,
    revision text NOT NULL,
    published_count integer NOT NULL CHECK (published_count >= 0),
    version_count integer NOT NULL CHECK (version_count >= published_count)
  );
`;

const spatialPaperCandidatesSql = `
  SELECT generation, ARRAY(
    SELECT record.id
      FROM spatial_paper_records AS record JOIN spatial_paper_members AS member ON member.id = record.id
     WHERE ($2::text[] IS NULL AND member.published OR member.id = ANY($2::text[]))
       AND record.bounds && ST_MakeEnvelope($3, $4, $5, $6, 4326)
       AND ($7::numeric IS NULL OR (record.years && numrange($7, $8, '[]') AND (NOT upper_inf(record.years) OR $7 <= $9)))
       AND ($10::numeric IS NULL OR record.observed_window && numrange($10, $11, '[)'))
     ORDER BY record.id COLLATE "C"
  ) AS ids
  FROM spatial_paper_state WHERE singleton AND generation = $1
`;

async function readSnapshot(pg: Pool): Promise<SpatialPaperSnapshot | null> {
  const client = await pg.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const exists = await client.query<{ relation: string | null }>("SELECT to_regclass('spatial_paper_state') AS relation");
    if (!exists.rows[0].relation) {
      await client.query("COMMIT");
      return null;
    }
    const { rows: [state] } = await client.query<PaperProjectionHead>(`
      SELECT generation, revision, published_count AS "publishedCount", version_count AS "versionCount"
        FROM spatial_paper_state WHERE singleton
    `);
    const entries = state ? (await client.query<{ projection: Omit<PaperMapEntry, "published">; published: boolean }>(`
      SELECT records.projection, members.published
        FROM spatial_paper_members AS members
        JOIN spatial_paper_records AS records ON records.id = members.id AND records.dataset_key = members.dataset_key
       ORDER BY members.id COLLATE "C"
    `)).rows.map(row => ({ ...row.projection, published: row.published })) : [];
    if (state && (entries.length !== state.versionCount || entries.filter(entry => entry.published).length !== state.publishedCount))
      throw Error("Local paper coverage projection is incomplete");
    await client.query("COMMIT");
    return state ? { ...state, entries } : null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Read the last committed projection from the spatial database without migrating or synchronizing. */
export async function readLocalPaperProjection(): Promise<SpatialPaperSnapshot | null> {
  const pg = productDatabase("SPATIAL");
  try { return await readSnapshot(pg); }
  finally { await pg.end(); }
}

export async function spatialPaperStore(pg = productDatabase("SPATIAL")) {
  try {
    await pg.query("CREATE EXTENSION IF NOT EXISTS postgis");
    await pg.query(schema);
  }
  catch (error) { await pg.end(); throw error; }

  async function publish(snapshot: SpatialPaperUpdate, expected: string | null) {
    const client = await pg.connect();
    try {
      await client.query("BEGIN");
      await client.query("LOCK TABLE spatial_paper_state IN EXCLUSIVE MODE");
      const { rows: [state] } = await client.query<{ generation: string }>(
        "SELECT generation FROM spatial_paper_state WHERE singleton",
      );
      if ((state?.generation ?? null) !== expected ||
          (snapshot.baseGeneration !== undefined && snapshot.baseGeneration !== expected)) {
        await client.query("ROLLBACK");
        return false;
      }
      if (snapshot.baseGeneration === undefined) {
        await client.query("DELETE FROM spatial_paper_members");
      } else {
        // Remove all changed memberships first so old and new heads can swap in any ID order.
        await client.query("DELETE FROM spatial_paper_members WHERE id = ANY($1::text[])", [snapshot.entries.map(entry => entry.id)]);
      }
      for (let offset = 0; offset < snapshot.entries.length; offset += 250) {
        const batch = snapshot.entries.slice(offset, offset + 250);
        const indexed = batch.map(entry => ({ entry, bounds: projectedPaperBounds(entry) }));
        const result = await client.query(`
          INSERT INTO spatial_paper_records (id, dataset_key, projection, bounds, years, observed_window)
          SELECT entry->>'id', entry->>'dsKey', entry - 'published',
                 CASE WHEN bounds IS NULL THEN NULL ELSE ST_MakeEnvelope(bounds[1], bounds[2], bounds[3], bounds[4], 4326) END,
                 CASE WHEN entry->'profile' ? 'years' THEN numrange(
                   (entry->'profile'->'years'->>0)::numeric, (entry->'profile'->'years'->>1)::numeric, '[]') END,
                 CASE WHEN entry->'profile' ? 'utcWindow' THEN numrange(
                   (entry->'profile'->'utcWindow'->>0)::numeric, (entry->'profile'->'utcWindow'->>1)::numeric, '[)') END
            FROM jsonb_to_recordset($1::jsonb) AS rows(entry jsonb, bounds double precision[])
          ON CONFLICT (id) DO UPDATE SET projection = spatial_paper_records.projection
          WHERE spatial_paper_records.dataset_key = EXCLUDED.dataset_key
            AND spatial_paper_records.projection = EXCLUDED.projection
        `, [JSON.stringify(indexed)]);
        if (result.rowCount !== batch.length) throw Error("Paper projection changed under an immutable content ID");
        await client.query(`
          INSERT INTO spatial_paper_members (id, dataset_key, published)
          SELECT item->>'id', item->>'dsKey', (item->>'published')::boolean
            FROM jsonb_array_elements($1::jsonb) AS item
        `, [JSON.stringify(batch)]);
      }
      const { rows: [counts] } = await client.query<{ published: number; versions: number }>(`
        SELECT count(*) FILTER (WHERE published)::integer AS published, count(*)::integer AS versions
          FROM spatial_paper_members
      `);
      if (counts.published !== snapshot.publishedCount || counts.versions !== snapshot.versionCount)
        throw Error("Applied paper projection does not match the provider totals");
      await client.query(`
        INSERT INTO spatial_paper_state (singleton, generation, revision, published_count, version_count)
        VALUES (true, $1, $2, $3, $4)
        ON CONFLICT (singleton) DO UPDATE SET generation = EXCLUDED.generation, revision = EXCLUDED.revision,
          published_count = EXCLUDED.published_count, version_count = EXCLUDED.version_count
      `, [snapshot.generation, snapshot.revision, snapshot.publishedCount, snapshot.versionCount]);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    readCurrent: () => readSnapshot(pg),
    publish,
    async candidates(generation: string, ids: string[] | null, bounds: Bounds, filters: Filters) {
      const { period, utcWindow } = filters;
      const result = await pg.query<{ ids: string[] }>({
        name: "spatial-paper-candidates", text: spatialPaperCandidatesSql,
        values: [generation, ids, ...bounds, period?.[0] ?? null, period?.[1] ?? null,
          new Date().getUTCFullYear(), utcWindow?.[0] ?? null, utcWindow?.[1] ?? null],
      });
      return result.rows[0]?.ids ?? null;
    },
    close: () => pg.end(),
  };
}
