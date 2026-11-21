import { cpSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=fileURLToPath(new URL("../",import.meta.url));
const original=path.resolve(process.argv[2] || path.join(homedir(),"Applications/OneEarth/globe-data"));
const target=path.resolve(root,".local/globe-data");
if(original===target)throw Error("复制来源须与目标目录分开。");
const years=(process.env.ONEEARTH_IMERG_YEARS || "2023,2024").split(",");
if(!years.every(year=>/^\d{4}$/.test(year)))throw Error("IMERG 年份格式无效。");
const assets=["grid-data","s2-data","imerg/catalog.json",...years.map(year=>"imerg/"+year)];
for(const name of assets) {
  if(!existsSync(path.join(original,name)))throw Error("找不到输入资料："+name);
}
mkdirSync(path.join(target,"imerg"),{recursive:true});
for(const name of assets)cpSync(path.join(original,name),path.join(target,name),{recursive:true,dereference:true});
console.log("已复制基础网格和 "+years.join("、")+" 年 IMERG 图层输入。");
