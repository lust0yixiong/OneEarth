import { spawn, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const original=process.argv[2];
if(process.platform!=="darwin"||!original||!path.isAbsolute(original))
  throw Error("用法：start-isolated-release.mjs <原型目录绝对路径>");
if(!process.env.ONEEARTH_CREDENTIALS_FILE||process.env.ONEEARTH_USE_EXISTING_ACCESS==="1")
  throw Error("隔离发布必须使用已配置的独立凭据文件。");
const prototype=realpathSync(original);
const profile=[
  "(version 1)",
  "(allow default)",
  '(deny network-outbound (remote tcp "*:5174"))',
  "(deny file-read* "+[
    "(subpath "+JSON.stringify(prototype)+")",
    "(subpath "+JSON.stringify(path.join(homedir(),"Applications/OneEarth"))+")",
    "(literal "+JSON.stringify(path.join(homedir(),"Library/LaunchAgents/org.oneearth.prototype.plist"))+")",
  ].join(" ")+")",
].join("\n");
const restricted=args=>spawnSync("/usr/bin/sandbox-exec",["-p",profile,...args],{stdio:"ignore"});
if(restricted(["/usr/bin/head","-c","0",path.join(prototype,"package.json")]).status===0)
  throw Error("隔离策略未能阻断原型目录。");
const curl=["/usr/bin/curl","--noproxy","*","-fsS","--max-time","3","http://127.0.0.1:5174/api/health"];
if(spawnSync(curl[0],curl.slice(1),{stdio:"ignore"}).status!==0 || restricted(curl).status!==7)
  throw Error("未证明 5174 同期在线且在隔离进程中不可达。");
console.log("OneEarth isolated release: prototype paths and TCP 5174 denied; prototype health OK outside");
const child=spawn("/usr/bin/sandbox-exec",["-p",profile,process.execPath,"scripts/launch.mjs"],{stdio:"inherit"});
child.on("error",()=>{process.exitCode=1;});
child.on("exit",(code,signal)=>{process.exitCode=code ?? (signal?"SIGINT"===signal?130:1:0);});
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>child.kill(signal));
