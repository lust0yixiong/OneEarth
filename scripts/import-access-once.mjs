import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPrototypeAccess, selectAccess } from "./credentials.mjs";

const root=fileURLToPath(new URL("..",import.meta.url));
const target=path.resolve(homedir(),"Library/Application Support/OneEarth Next/access.json");
const current=selectAccess(readPrototypeAccess(root));
if(!current.DEEPSEEK_API_KEY || !current.ONEEARTH_ASSERTION_PG_HOST ||
  !(current.HAINA_ACCESS_KEY_ID || current.HAINA_DATAHUB_AK))
  throw Error("没有找到已授权的模型工具、断言库或海纳配置。");
const folder=path.dirname(target);
if(existsSync(folder)&&path.resolve(realpathSync(folder))!==folder)
  throw Error("凭据目标目录必须是本机独立目录。");
mkdirSync(folder,{recursive:true,mode:0o700});
writeFileSync(target,JSON.stringify(current),{encoding:"utf8",flag:"wx",mode:0o600});
console.log("已创建独立凭据文件，仅当前用户可读。");
