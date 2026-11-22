import { lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function resolvedLocation(file){
  try{lstatSync(file);}catch(error){
    if(error.code!=="ENOENT")throw error;
    return path.join(resolvedLocation(path.dirname(file)),path.basename(file));
  }
  return realpathSync(file);
}

export function productPath(root,value){
  const resolved=resolvedLocation(path.resolve(root,value));
  for(const forbidden of [path.resolve(root,"../oneearth-app"),path.join(homedir(),"Applications/OneEarth")]){
    const base=resolvedLocation(forbidden);
    if(resolved===base || resolved.startsWith(base+path.sep))
      throw Error("产品文件路径不能指向原型目录。");
  }
  return resolved;
}
