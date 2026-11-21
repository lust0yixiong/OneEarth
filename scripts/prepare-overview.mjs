import fs from "node:fs";
const source = new URL(
  "../../产品设计/prototype/oneearth-data-globe/src/pick-data.json",
  import.meta.url,
);
const target = new URL(
  "../src/data/evidence/background-overview.json",
  import.meta.url,
);
const { world, meta } = JSON.parse(fs.readFileSync(source, "utf8"));
fs.writeFileSync(target, JSON.stringify({ world, meta }) + "\n");
console.log("Prepared overview from the original simulated spatial records.");
