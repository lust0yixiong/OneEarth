import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { geoBounds } from "d3-geo";
import { footprintCells } from "../src/domain/observation-grid";
import { regionHit } from "../src/domain/product-distribution";
import { cellShape, gridSpec } from "../src/domain/spatial";
import type { CoverageGeometry } from "../src/domain/coverage";
import type { GridSpec } from "../src/domain/types";

mkdirSync(dirname(workerData.filename),{recursive:true});
const db=new DatabaseSync(workerData.filename);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS coverage_full_v1 (geometry TEXT NOT NULL, grid TEXT NOT NULL, cells TEXT NOT NULL, PRIMARY KEY(geometry,grid));
  CREATE TABLE IF NOT EXISTS coverage_geometry_v1 (id INTEGER PRIMARY KEY, hash TEXT NOT NULL UNIQUE);
  CREATE VIRTUAL TABLE IF NOT EXISTS coverage_bounds_part_v3 USING rtree(id,west,east,south,north,+geometry);
  CREATE TABLE IF NOT EXISTS coverage_parts_ready_v3 (geometry INTEGER PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS coverage_tile_v2 (grid TEXT NOT NULL,cell TEXT NOT NULL,checked TEXT NOT NULL,hits TEXT NOT NULL,PRIMARY KEY(grid,cell)) WITHOUT ROWID;`);
const getFull=db.prepare("SELECT cells FROM coverage_full_v1 WHERE geometry=? AND grid=?");
const putFull=db.prepare("INSERT OR REPLACE INTO coverage_full_v1 VALUES (?,?,?)");
const putGeometry=db.prepare("INSERT OR IGNORE INTO coverage_geometry_v1(hash) VALUES (?)");
const getGeometry=db.prepare("SELECT id FROM coverage_geometry_v1 WHERE hash=?");
const putBounds=db.prepare("INSERT INTO coverage_bounds_part_v3(west,east,south,north,geometry) VALUES (?,?,?,?,?)");
const partsReady=db.prepare("SELECT 1 FROM coverage_parts_ready_v3 WHERE geometry=?");
const markParts=db.prepare("INSERT INTO coverage_parts_ready_v3 VALUES (?)");
const possible=db.prepare(`SELECT g.hash FROM coverage_bounds_part_v3 b JOIN coverage_geometry_v1 g ON g.id=b.geometry
  WHERE b.west<=? AND b.east>=? AND b.south<=? AND b.north>=?`);
const getTile=db.prepare("SELECT checked,hits FROM coverage_tile_v2 WHERE grid=? AND cell=?");
const putTile=db.prepare("INSERT OR REPLACE INTO coverage_tile_v2 VALUES (?,?,?,?)");
const geometries=new Map<string,CoverageGeometry>(),ids=new Map<string,number>();
const complete=new Map<string,Set<string>>(),checkedFull=new Set<string>();
const inverted=new Map<string,Map<string,Set<string>>>();
// One compact row per cell replaces one row per geometry/cell pair. Numeric
// geometry identities also preserve negative matches without repeating SHA keys.
const tiles=new Map<string,{checked:Set<number>;hits:Set<number>}>();
const warmJobs=new Map<string,{geometry:string;grid:GridSpec}>();
const cellJobs=new Map<string,{grid:GridSpec;cell:string;geometries:Set<string>}>();
const waiters=new Map<number,Set<string>>();
const coarseGrids=(["h3","s2"] as const).flatMap(system=>[2,3].map(band=>gridSpec(system,band)));
let running=false,computed=0;
const token=(geometry:string,grid:GridSpec)=>geometry+":"+grid.key;
const cellToken=(grid:GridSpec,cell:string)=>grid.key+":"+cell;
function start(){if(!running){running=true;setImmediate(work);}}
function publish(geometry:string,grid:GridSpec,hits:Set<string>) {
  complete.set(token(geometry,grid),hits);
  const cells=inverted.get(grid.key)||new Map<string,Set<string>>();inverted.set(grid.key,cells);
  for(const cell of hits){const bucket=cells.get(cell)||new Set<string>();bucket.add(geometry);cells.set(cell,bucket);}
}
function full(geometry:string,grid:GridSpec) {
  const key=token(geometry,grid);
  if(!checkedFull.has(key)) {
    checkedFull.add(key);const row=getFull.get(geometry,grid.key);
    if(row)publish(geometry,grid,new Set(JSON.parse(String(row.cells))));
  }
  return complete.get(key);
}
function tile(grid:GridSpec,cell:string) {
  const key=cellToken(grid,cell);
  if(!tiles.has(key)) {
    const row=getTile.get(grid.key,cell);
    tiles.set(key,{checked:new Set(row?JSON.parse(String(row.checked)):[]),hits:new Set(row?JSON.parse(String(row.hits)):[])});
    if(tiles.size>40000)tiles.delete(tiles.keys().next().value!);
  }
  return tiles.get(key)!;
}
function boxes(area:Parameters<typeof geoBounds>[0]) {
  const [[west,south],[east,north]]=geoBounds(area);
  return west<=east?[[west,east,south,north]]:[[west,180,south,north],[-180,east,south,north]];
}
function settle() {
  for(const [id,keys] of waiters)if([...keys].every(key=>complete.has(key))) {
    waiters.delete(id);parentPort!.postMessage({id,result:{geometries:geometries.size,computed}});
  }
}
function work() {
  try {
    if(cellJobs.size) {
      const start=performance.now();let count=0;
      db.exec("BEGIN");
      try {
        for(const [key,job] of cellJobs) {
          const cached=tile(job.grid,job.cell),shape=cellShape(job.cell,job.grid);
          for(const geometry of job.geometries) {
            const id=ids.get(geometry)!;
            if(!cached.checked.has(id)) {
              const hit=regionHit(geometries.get(geometry)!.area,job.cell,shape.geometry);
              cached.checked.add(id);if(hit)cached.hits.add(id);computed++;
            }
            job.geometries.delete(geometry);
            if(performance.now()-start>25)break;
          }
          putTile.run(job.grid.key,job.cell,JSON.stringify([...cached.checked]),JSON.stringify([...cached.hits]));
          if(!job.geometries.size)cellJobs.delete(key);
          if(++count>=128 || performance.now()-start>25)break;
        }
        db.exec("COMMIT");
      }catch(error){db.exec("ROLLBACK");throw error;}
    } else if(warmJobs.size) {
      const [key,job]=warmJobs.entries().next().value!;
      const hits=new Set(footprintCells(geometries.get(job.geometry)!.area,job.grid));
      putFull.run(job.geometry,job.grid.key,JSON.stringify([...hits]));
      publish(job.geometry,job.grid,hits);computed++;warmJobs.delete(key);
    } else {running=false;settle();return;}
    settle();setImmediate(work);
  }catch(error){running=false;parentPort!.postMessage({error:error instanceof Error?error.message:"网格索引计算失败"});}
}
parentPort!.on("message",message=>{
  try {
    db.exec("BEGIN");
    try {
      for(const geometry of message.geometries || [])if(!geometries.has(geometry.key)) {
        geometries.set(geometry.key,geometry);putGeometry.run(geometry.key);
        const id=Number(getGeometry.get(geometry.key)!.id);ids.set(geometry.key,id);
        if(!partsReady.get(id)) {
          const polygons=geometry.area.type==="MultiPolygon"?geometry.area.coordinates:[geometry.area.coordinates];
          for(const coordinates of polygons)for(const [west,east,south,north] of boxes({type:"Polygon",coordinates}))putBounds.run(west,east,south,north,id);
          markParts.run(id);
        }
      }
      db.exec("COMMIT");
    }catch(error){db.exec("ROLLBACK");throw error;}
    if(message.type==="warm") {
      const keys=new Set<string>();
      for(const geometry of message.keys as string[])for(const grid of coarseGrids) {
        const key=token(geometry,grid);keys.add(key);
        if(!full(geometry,grid))warmJobs.set(key,{geometry,grid});
      }
      waiters.set(message.id,keys);settle();if(warmJobs.size)start();return;
    }
    const {grid,cells,keys}=message as {grid:GridSpec;cells:string[];keys:string[]};
    const hits=new Map(cells.map(cell=>[cell,[] as string[]])),pending=new Set<string>(),active=new Set(keys);
    if(coarseGrids.some(level=>level.key===grid.key))for(const geometry of keys)full(geometry,grid);
    for(const cell of cells) {
      for(const geometry of inverted.get(grid.key)?.get(cell)||[])if(active.has(geometry))hits.get(cell)!.push(geometry);
      const candidates=new Set(boxes(cellShape(cell,grid).geometry).flatMap(([west,east,south,north])=>possible.all(east,west,north,south).map(row=>String(row.hash))));
      const cached=tile(grid,cell);
      for(const geometry of candidates) {
        if(!active.has(geometry) || complete.has(token(geometry,grid)))continue;
        const id=ids.get(geometry)!;
        if(cached.hits.has(id))hits.get(cell)!.push(geometry);
        if(!cached.checked.has(id)) {
          pending.add(cell);const key=cellToken(grid,cell);
          const job=cellJobs.get(key)||{grid,cell,geometries:new Set<string>()};
          job.geometries.add(geometry);cellJobs.set(key,job);
        }
      }
    }
    if(cellJobs.size)start();
    parentPort!.postMessage({id:message.id,result:{hits:[...hits].filter(([cell])=>!pending.has(cell)),pending:pending.size,computed}});
  }catch(error){parentPort!.postMessage({id:message.id,error:error instanceof Error?error.message:"网格索引读取失败"});}
});
