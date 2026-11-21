import { execFileSync } from "node:child_process";
import { closeSync, constants, existsSync, fstatSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";

const accessKey = /^(?:DEEPSEEK_API_KEY|ONEEARTH_DEEPSEEK_(?:SEARCH|FETCH)|ONEEARTH_EARTHNANO_URL|ONEEARTH_ASSERTION_PG_(?:HOST|PORT|DATABASE|USER|PASSWORD|SSL)|HAINA_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|DATAHUB_AK|DATAHUB_SK)|ONEEARTH_HAINA_AREA_ID)$/;

export function readPrototypeAccess(root) {
  const original = {};
  const source=path.resolve(root,"../oneearth-app");
  for (const name of [".env",".env.haina"]) {
    const file=path.join(source,name);
    if(existsSync(file))Object.assign(original,parseEnv(readFileSync(file,"utf8")));
  }
  const plist=path.join(homedir(),"Library/LaunchAgents/org.oneearth.prototype.plist");
  if(process.platform==="darwin"&&existsSync(plist)){
    const program="import json, plistlib, sys; print(json.dumps(plistlib.load(open(sys.argv[1], 'rb')).get('EnvironmentVariables', {})))";
    Object.assign(original,JSON.parse(execFileSync("python3",["-c",program,plist],{stdio:["ignore","pipe","ignore"]}).toString()));
  }
  return original;
}

export function selectAccess(values) {
  return Object.fromEntries(Object.entries(values).filter(([key,value])=>accessKey.test(key)&&typeof value==="string"));
}

export function readCredentials(file) {
  if(!path.isAbsolute(file))throw Error("ONEEARTH_CREDENTIALS_FILE 需要绝对路径。");
  const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const stat=fstatSync(fd);
    if(!stat.isFile()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0||stat.size>64*1024)
      throw Error("凭据文件须由当前用户独占读取。");
    const payload=JSON.parse(readFileSync(fd,"utf8"));
    if(!payload||typeof payload!=="object"||Array.isArray(payload))throw Error("凭据文件须为 JSON 对象。");
    const accepted=selectAccess(payload);
    if(Object.keys(accepted).length!==Object.keys(payload).length)
      throw Error("凭据文件包含未知配置名称或非字符串值。");
    return accepted;
  }finally{closeSync(fd);}
}
