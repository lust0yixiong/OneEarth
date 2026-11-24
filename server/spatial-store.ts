import type { PoolClient } from "pg";
import { productDatabase } from "./product-database";
import { createHash } from "node:crypto";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const schema = `
  CREATE EXTENSION IF NOT EXISTS postgis;
  CREATE TABLE IF NOT EXISTS layers (
    id text PRIMARY KEY, entity_id text NOT NULL, version text NOT NULL,
    title text NOT NULL, source text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS layer_chunks (
    route text PRIMARY KEY, layer_id text NOT NULL REFERENCES layers(id),
    starts date, ends date, level integer, geom geometry(Polygon,4326),
    hash text NOT NULL, size integer NOT NULL, media text NOT NULL
  );
  CREATE INDEX IF NOT EXISTS layer_space ON layer_chunks USING gist(geom);
  CREATE INDEX IF NOT EXISTS layer_temporal ON layer_chunks(layer_id,level,starts,ends);
`;
export type Bounds = [number,number,number,number];
export type Layer = {id:string; entity_id:string; version:string; title:string; source:string};
export type Chunk = {route:string; layer_id:string; starts:string|null; ends:string|null; level:number|null;
  bounds:Bounds|null; hash:string; size:number; media:string};
type ObjectRow = Pick<Chunk,"hash"|"size"|"media">;

export async function spatialStore() {
  const pg=productDatabase("SPATIAL");
  async function query<T>(sql:string,values:unknown[]=[]):Promise<T[]> {
    return (await pg.query(sql,values)).rows as T[];
  }
  try{await pg.query(schema);}
  catch(error){await pg.end();throw error;}
  const writeLayer = async (layer: Layer, target: Pick<PoolClient,"query"> = pg) => {
    await target.query(`INSERT INTO layers SELECT * FROM jsonb_populate_record(null::layers,$1::jsonb)
      ON CONFLICT(id) DO UPDATE SET entity_id=EXCLUDED.entity_id,version=EXCLUDED.version,title=EXCLUDED.title,source=EXCLUDED.source`,[JSON.stringify(layer)]);
  };
  const writeChunks = async (rows: Chunk[], target: Pick<PoolClient,"query"> = pg) => {
    await target.query(`INSERT INTO layer_chunks
      SELECT route,layer_id,starts,ends,level,
        CASE WHEN bounds IS NULL THEN NULL ELSE ST_MakeEnvelope(bounds[1],bounds[2],bounds[3],bounds[4],4326) END,
        hash,size,media
      FROM jsonb_to_recordset($1::jsonb) AS data(route text,layer_id text,starts date,ends date,level integer,
        bounds double precision[],hash text,size integer,media text)
      ON CONFLICT(route) DO UPDATE SET layer_id=EXCLUDED.layer_id,starts=EXCLUDED.starts,ends=EXCLUDED.ends,
      level=EXCLUDED.level,geom=EXCLUDED.geom,hash=EXCLUDED.hash,size=EXCLUDED.size,media=EXCLUDED.media`,[JSON.stringify(rows)]);
  };
  return {
    engine:"postgresql" as const,
    async version() {return (await query<{version:string}>("SELECT PostGIS_Lib_Version() AS version"))[0].version;},
    layers:() => query<Layer>("SELECT * FROM layers ORDER BY id"),
    writeLayer,
    writeChunks,
    async publishLayerSet(entries: {layer: Layer; chunks: Chunk[]}[]) {
      const client = await pg.connect();
      try {
        await client.query("BEGIN");
        for (const {layer,chunks} of [...entries].sort((a,b)=>a.layer.id.localeCompare(b.layer.id))) {
          await writeLayer(layer,client);
          // Keep old immutable URLs readable while removing them from active spatial/temporal queries.
          await client.query(`UPDATE layer_chunks SET starts=NULL,ends=NULL,level=NULL,geom=NULL
            WHERE layer_id=$1 AND starts IS NOT NULL AND NOT (route=ANY($2::text[]))`,
            [layer.id,chunks.map(chunk=>chunk.route)]);
          await writeChunks(chunks,client);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },
    async object(route:string) {
      return (await query<ObjectRow>("SELECT hash,size,media FROM layer_chunks WHERE route=$1",[route]))[0];
    },
    chunks(layer:string, start:string, end:string, level:number, bounds:Bounds) {
      const [w,s,e,n] = bounds;
      return query<Pick<Chunk,"route"|"size"|"hash">>(`SELECT route,size,hash FROM layer_chunks WHERE layer_id=$1 AND level=$2
        AND starts <= $4::date AND ends >= $3::date
        AND (CASE WHEN $5::float8 <= $7::float8 THEN ST_Intersects(geom,ST_MakeEnvelope($5,$6,$7,$8,4326))
          ELSE ST_Intersects(geom,ST_MakeEnvelope($5,$6,180,$8,4326)) OR ST_Intersects(geom,ST_MakeEnvelope(-180,$6,$7,$8,4326)) END)
        ORDER BY starts,route LIMIT 2048`, [layer,level,start,end,w,s,e,n]);
    },
    exportChunks(layer:string) {
      return query<Chunk>(`SELECT route,layer_id,starts::text,ends::text,level,
        CASE WHEN geom IS NULL THEN NULL ELSE ARRAY[ST_XMin(geom),ST_YMin(geom),ST_XMax(geom),ST_YMax(geom)] END AS bounds,
        hash,size,media FROM layer_chunks WHERE layer_id=$1 ORDER BY route`,[layer]);
    },
    close:() => pg.end(),
  };
}

export function layerObjects() {
  const bucket=process.env.ONEEARTH_OBJECT_BUCKET;
  if(!bucket)throw Error("ONEEARTH_OBJECT_BUCKET 缺失，产品图层需要 S3 对象存储。");
  const client=new S3Client({
    endpoint:process.env.ONEEARTH_OBJECT_ENDPOINT,
    region:process.env.AWS_REGION || "us-east-1",
    forcePathStyle:process.env.ONEEARTH_OBJECT_PATH_STYLE === "1",
  });
  const prefix = (process.env.ONEEARTH_OBJECT_PREFIX || "oneearth/").replace(/\/?$/,"/");
  const checkedKey = (hash:string) => {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw Error("无效的图层对象编号。");
    return hash.slice(0,2) + "/" + hash;
  };
  return {
    backend:"s3" as const,
    async read(hash:string) {
      const key = checkedKey(hash);
      const object = await client.send(new GetObjectCommand({Bucket:bucket,Key:prefix+key}));
      if (!object.Body) throw Error("图层对象无内容。");
      return Buffer.from(await object.Body.transformToByteArray());
    },
    async put(bytes:Buffer) {
      const hash = createHash("sha256").update(bytes).digest("hex");
      const key = checkedKey(hash);
      try {
        await client.send(new PutObjectCommand({Bucket:bucket,Key:prefix+key,Body:bytes,IfNoneMatch:"*"}));
      } catch (error) {
        if ((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode !== 412) throw error;
      }
      return {hash,size:bytes.length};
    },
  };
}
