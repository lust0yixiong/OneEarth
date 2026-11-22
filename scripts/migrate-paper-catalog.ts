import {existsSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {readPaperCatalogSqlite,writePaperCatalogSqlite} from "../server/paper-catalog-sqlite";
import {inspectPaperCatalog,postgresPaperCatalog} from "../server/postgres-paper-catalog";
import {productDatabase} from "../server/product-database";
import {productPath} from "./product-path.mjs";

const root=fileURLToPath(new URL("..",import.meta.url));
const [action,location,...extra]=process.argv.slice(2);
const fileAction=action==="--sqlite" || action==="--export-sqlite";
if (extra.length || (fileAction ? !location || !path.isAbsolute(location)
  : !!location || !["--status","--initialize-empty","--from-discovery-history"].includes(action)))
  throw Error("用法：migrate-paper-catalog.ts --sqlite <绝对路径> | --status | --initialize-empty | --from-discovery-history | --export-sqlite <新绝对路径>");
const file=location ? productPath(root,location) : undefined;
if (action==="--initialize-empty" && existsSync(productPath(root,path.join(process.env.ONEEARTH_STATE_DIR || ".local/state","paper-evidence.sqlite"))))
  throw Error("指定产品状态目录中有旧 SQLite，请先取得一致的 v2 快照并迁移。");

const old=action==="--sqlite" ? readPaperCatalogSqlite(file!) : undefined;
const pool=productDatabase("DISCOVERY");
try {
  if (action==="--status") {
    console.log(JSON.stringify(await inspectPaperCatalog(pool)));
  } else if (action==="--export-sqlite") {
    const head=await inspectPaperCatalog(pool);
    if (!head.initialized) throw Error("目标发现库尚未初始化。");
    const store=await postgresPaperCatalog(pool,{initializeSchema:false});
    console.log(JSON.stringify({action,...writePaperCatalogSqlite(file!,await store.exportSnapshot())}));
  } else {
    const store=await postgresPaperCatalog(pool);
    const result=old ? await store.importLegacy(old.snapshot,old.digest)
      : action==="--from-discovery-history" ? await store.importDiscoveryHistory() : await store.initializeEmpty();
    console.log(JSON.stringify({action,...result}));
  }
} finally {await pool.end();}
