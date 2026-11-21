import { parseEnv } from "node:util";
import { readFileSync, existsSync } from "node:fs";
const env={...(existsSync(".env")?parseEnv(readFileSync(".env","utf8")):{}),...process.env};
const web=Number(env.ONEEARTH_PORT || 5274);
const services={web,discovery:Number(env.ONEEARTH_DISCOVERY_PORT || 5275),
  spatial:Number(env.ONEEARTH_SPATIAL_PORT || 5276), runtime:Number(env.ONEEARTH_RUNTIME_PORT || web+3)};
for(const [name,port] of Object.entries(services)){
  if(port===5174)throw Error("状态检查不能查询原型。");
  try{
    const res=await fetch("http://127.0.0.1:"+port+"/api/health",{signal:AbortSignal.timeout(4000)});
    const health=await res.json();
    if(!res.ok || health.status!=="ok")process.exitCode=1;
    console.log(JSON.stringify({name,port,...health}));
  }catch{
    process.exitCode=1;
    console.log(JSON.stringify({name,port,status:"unavailable"}));
  }
}
