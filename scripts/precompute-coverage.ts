import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { overviewCells } from "../src/data/evidence/research-grid.mjs";
import { emptyFilters, gridSpec } from "../src/domain/spatial";
import { regionRecords } from "../src/domain/product-distribution";
import { addCoverage, coverageSignature } from "../src/globe/coverage-grid";
import { coverageIndex, coverageScope } from "../server/coverage-index";
import { paperCache } from "../server/earthnano";
import { constellationService, parseSources } from "../server/constellations";
import { registerPapers, registerObservations } from "../src/domain/datasets";

// Only static catalogue footprints are loaded in this build process. Live feeds
// change the scope fingerprint and are calculated independently at runtime.
const regions = regionRecords(emptyFilters());
const grids: Record<string, Record<string, string[]>> = {};
for (const system of ["h3", "s2"] as const) {
  const grid = gridSpec(system, 2);
  const covered = addCoverage(new Map(), overviewCells(grid), regions, false);
  grids[grid.key] = Object.fromEntries([...covered].map(([id, products]) => [id, [...products]]));
  console.log(`Prepared ${grid.label} catalogue coverage: ${covered.size} cells.`);
}
writeFileSync(new URL("../src/data/evidence/catalog-coverage.json", import.meta.url), JSON.stringify({signature: coverageSignature(regions), grids}) + "\n");

// Materialize the installed catalogue too, including cached assertion-library records.
// Geometry keys are independent of filters and products, so an unchanged rebuild is a disk lookup.
const root=fileURLToPath(new URL("..",import.meta.url));
if(existsSync(path.join(root,".env")))process.loadEnvFile(path.join(root,".env"));
const papers=path.join(root,".local","paper-evidence.sqlite");
if(existsSync(papers)) {
  const cache=paperCache(papers);
  try{registerPapers(cache.list());}finally{cache.close();}
}
const observations=process.env.ONEEARTH_OBSERVATION_DB || path.join(root,".local","observations.sqlite");
if(existsSync(observations)) {
  const service=constellationService(observations,parseSources(process.env.ONEEARTH_PUSH_SOURCES));
  try{registerObservations(service.latest().records,true);}finally{service.close();}
}
const index=coverageIndex(process.env.ONEEARTH_COVERAGE_DB || path.join(root,".local","coverage.sqlite"));
try {
  const prepared=coverageScope(regionRecords(emptyFilters()));
  const start=performance.now();
  await index.warm(prepared.geometries);
  console.log(`Prepared persistent H3 R2/R3 and S2 L5/L6 coverage: ${prepared.geometries.length} distinct geometries in ${((performance.now()-start)/1000).toFixed(2)} s.`);
} finally {await index.close();}
