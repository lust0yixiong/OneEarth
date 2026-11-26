import {execFileSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {createConnection} from "node:net";
import {accessSync,existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,renameSync,statSync,unlinkSync,writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {setTimeout as wait} from "node:timers/promises";
import {parseEnv} from "node:util";
import {Pool} from "pg";
import {macosApplicationJobs} from "./macos-application-jobs.mjs";

if(process.platform!=="darwin")throw Error("此命令用于 macOS。");
const [action,releaseArg,dataArg]=process.argv.slice(2);
const home=homedir();
const root=path.join(home,"Library/Application Support/OneEarth Next");
const storage=path.join(root,"storage-primary");
const agents=path.join(home,"Library/LaunchAgents");
const logDir=path.join(root,"logs");
const domain="gui/"+process.getuid();
const appPorts=[5474,5475,5476];
const retiredPort=5477;
const labels={db:"org.oneearth.next.postgres",objects:"org.oneearth.next.garage",app:"org.oneearth.next"};
const applicationRoles = [
  {role:"spatial",label:labels.app+".spatial"},
  {role:"discovery",label:labels.app+".discovery"},
  {role:"workbench",label:labels.app+".runtime"},
  {role:"worker",label:labels.app+".worker"},
  {role:"worker",label:labels.app+".worker.2"},
];
const applicationJobs = macosApplicationJobs(agents,domain);
const applicationLabels = applicationRoles.map(job=>job.label);
const stopOrder = [...applicationLabels.slice().reverse(),labels.app];
const rollbackRoot = path.join(root,"application-rollbacks");
const deploymentConfig = path.join(storage,"deployment.env");
const file=label=>path.join(agents,label+".plist");
const controlled=label=>domain+"/"+label;
const launch=(args,options={})=>execFileSync("/bin/launchctl",args,{encoding:"utf8",stdio:["ignore","pipe","pipe"],...options});
const registered=label=>{try{return launch(["print",controlled(label)]);}catch{return "";}};
const stop=label=>{if(registered(label))launch(["bootout",controlled(label)]);};

const escape=value=>String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
function xml(value){
  if(typeof value==="string")return "<string>"+escape(value)+"</string>";
  if(value===true)return "<true/>";
  if(typeof value==="number")return "<integer>"+value+"</integer>";
  if(Array.isArray(value))return "<array>"+value.map(xml).join("")+"</array>";
  return "<dict>"+Object.entries(value).map(([k,v])=>"<key>"+escape(k)+"</key>"+xml(v)).join("")+"</dict>";
}
function validPrivate(directory){
  const stat=statSync(directory);
  if(stat.uid!==process.getuid()||(stat.mode&0o077)!==0)throw Error("OneEarth 独立配置须仅当前用户可访问。");
}
function appEnvironment(label){
  const current=file(label);
  if(!existsSync(current))return {};
  validPrivate(current);
  const text=execFileSync("/usr/bin/plutil",["-extract","EnvironmentVariables","json","-o","-",current],{encoding:"utf8"});
  const values=JSON.parse(text);
  if(!values || Array.isArray(values) || Object.values(values).some(value=>typeof value!=="string"))
    throw Error("现有 OneEarth 启动环境格式无效。");
  return values;
}
function inheritedSandbox(label){
  if(!existsSync(file(label)))return;
  validPrivate(file(label));
  const args=JSON.parse(execFileSync("/usr/bin/plutil",["-extract","ProgramArguments","json","-o","-",file(label)],{encoding:"utf8"}));
  if(!Array.isArray(args)||args[0]!=="/usr/bin/sandbox-exec"||args[1]!=="-p"||typeof args[2]!=="string"||!args[2].trim())
    throw Error("现有应用启动项缺少可保留的隔离配置。");
  return args[2];
}
function applicationPath(candidate){
  if(!candidate||!path.isAbsolute(candidate))throw Error("发布目录和数据目录须为绝对路径。");
  const real=realpathSync(candidate);
  if(!real.startsWith(realpathSync(root)+path.sep))throw Error("托管文件须放在 OneEarth Next 专用目录。");
  return real;
}
function jobContent(label,workingDirectory,args,environment){
  const logfile=path.join(logDir,label+".log");
  writeFileSync(logfile,"",{flag:"a",mode:0o600});
  return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">'+xml({
    Label:label,ProgramArguments:args,WorkingDirectory:workingDirectory,EnvironmentVariables:environment,
    RunAtLoad:true,KeepAlive:true,ThrottleInterval:5,ExitTimeOut:20,StandardOutPath:logfile,StandardErrorPath:logfile,
  })+"</plist>\n";
}
function writeJob(label,workingDirectory,args,environment){
  const plist=jobContent(label,workingDirectory,args,environment);
  const tmp=file(label)+".staged-"+process.pid;
  writeFileSync(tmp,plist,{mode:0o600,flag:"wx"});
  try{
    execFileSync("/usr/bin/plutil",["-lint",tmp],{stdio:"ignore"});
    renameSync(tmp,file(label));
  }finally{if(existsSync(tmp))unlinkSync(tmp);}
}

function isListening(port){
  return new Promise(resolve=>{
    const socket=createConnection({host:"127.0.0.1",port});
    const done=result=>{socket.destroy();resolve(result);};
    socket.setTimeout(300,()=>done(false));
    socket.once("error",()=>done(false));
    socket.once("connect",()=>done(true));
  });
}
async function portsMatch(ports,listening){
  for(let n=0;n<70;n++){
    const states=await Promise.all(ports.map(isListening));
    if(states.every(state=>state===listening))return;
    await wait(200);
  }
  throw Error("OneEarth Next 服务端口未进入期望状态。");
}
async function boot(label){
  for(let attempt=0;;attempt++){
    try{launch(["bootstrap",domain,file(label)]);return;}
    catch(error){
      if(registered(label))return;
      // launchd may still be removing the previous instance immediately after bootout.
      if(attempt>=6||error.status!==5)throw error;
      await wait(350);
    }
  }
}
const quiescent = () => portsMatch([...appPorts,retiredPort],false);
async function requireIdleQueues() {
  validPrivate(deploymentConfig);
  const environment = {...parseEnv(readFileSync(deploymentConfig,"utf8")),...appEnvironment(labels.app)};
  const checks = [
    ["RUNTIME",[
      ["runtime_tasks","status IN ('queued','running')"],
      ["runtime_chat_messages","status='planning'"],
      ["runtime_web_tool_calls","state IN ('queued','running')"],
      ["observation_skill_runs","outcome IS NULL"],
      ["runtime_remote_stops","state='pending'"],
    ]],
    ["DISCOVERY",[["discovery_tasks","status IN ('queued','running')"]]],
  ];
  for (const [role,tables] of checks) {
    const previousRole = appEnvironment(role==="RUNTIME" ? applicationLabels[2] : applicationLabels[1]);
    const name = "ONEEARTH_"+role+"_DATABASE_URL";
    const connectionString = previousRole[name] ?? environment[name];
    const url = new URL(connectionString);
    if (url.hostname!=="127.0.0.1" || url.port!=="55432") throw Error("OneEarth 队列不在预期主实例。");
    const pool = new Pool({connectionString,connectionTimeoutMillis:3000,statement_timeout:3000,max:1});
    try {
      for (const [table,pendingCondition] of tables) {
        const exists = (await pool.query("SELECT to_regclass($1) AS name",[table])).rows[0]?.name;
        if (!exists) continue;
        const pending = await pool.query("SELECT 1 FROM "+table+" WHERE "+pendingCondition+" LIMIT 1");
        if (pending.rowCount) throw Error("OneEarth 当前还有进行中的消息或研究，请等队列排空后切换。");
      }
    } finally { await pool.end(); }
  }
}
async function applicationHealthy(targets, legacy = false) {
  const ports = legacy ? [...appPorts,retiredPort] : appPorts;
  await portsMatch(ports,true);
  if (!legacy) await portsMatch([retiredPort],false);
  let previous="",consecutive=0;
  for (let count = 0; count < 25; count++) {
    const pids = targets.map(label => applicationJobs.inspect(label).pid);
    const health = await Promise.all(ports.map(async port => {
      try {
        const response=await fetch("http://127.0.0.1:"+port+"/api/health",{signal:AbortSignal.timeout(1100)});
        return response.ok && (await response.json()).status === "ok";
      } catch { return false; }
    }));
    const signature=pids.join(",");
    if (pids.every(Boolean) && new Set(pids).size===pids.length && health.every(Boolean)) {
      consecutive=signature===previous ? consecutive+1 : 1;
      if (consecutive===3) return;
    } else consecutive=0;
    previous=signature;
    await wait(650);
  }
  throw Error("OneEarth 应用角色或健康接口未就绪。");
}
async function verifyRestored(previous) {
  const labels = previous.filter(job=>job.registered).map(job=>job.label);
  if (labels.length) await applicationHealthy(labels,labels.includes(stopOrder.at(-1)));
}
function backupApplications(){
  const previous = applicationJobs.snapshot(stopOrder);
  if (!previous.some(job=>job.content)) return;
  mkdirSync(rollbackRoot,{recursive:true,mode:0o700});
  validPrivate(rollbackRoot);
  const directory = mkdtempSync(path.join(rollbackRoot,"before-"));
  for (const job of previous) {
    if (job.content) writeFileSync(path.join(directory,job.label+".plist"),job.content,{mode:0o600,flag:"wx"});
  }
  return directory;
}
if(action==="install"){
  validPrivate(root);
  const release=applicationPath(releaseArg);
  const data=applicationPath(dataArg);
  const config=deploymentConfig;
  const meta=path.join(storage,"installation.json");
  validPrivate(meta);validPrivate(config);
  const {pg,s3,binaries,garage,socket}=JSON.parse(readFileSync(meta,"utf8"));
  if(pg!==55432||s3!==5900)throw Error("主实例的存储端口与独立配置不符。");
  const postgres=path.join(binaries,"postgres");
  const node=process.env.ONEEARTH_NODE_BIN || process.execPath;
  for(const required of [postgres,garage,node,path.join(release,"dist/index.html"),path.join(release,"scripts/launch.mjs"),
    path.join(release,"node_modules/tsx/package.json"),path.join(data,"grid-data"),path.join(data,"s2-data")])accessSync(required);
  mkdirSync(agents,{recursive:true});
  mkdirSync(logDir,{recursive:true,mode:0o700});
  mkdirSync(socket,{recursive:true,mode:0o700});
  const env={HOME:home,PATH:[path.join(home,".local/bin"),path.dirname(node),"/opt/homebrew/bin","/usr/local/bin","/usr/bin","/bin","/usr/sbin","/sbin"].join(":")};
  const prototypeDir=fileURLToPath(new URL("../../oneearth-app",import.meta.url));
  const legacyDeployment=path.join(home,"Applications/OneEarth");
  const legacyAgent=path.join(agents,"org.oneearth.prototype.plist");
  const profile=[
    "(version 1)","(allow default)",'(deny network-outbound (remote tcp "*:5174"))',
    "(deny file-read* (subpath "+JSON.stringify(prototypeDir)+") (subpath "+JSON.stringify(legacyDeployment)+
      ") (literal "+JSON.stringify(legacyAgent)+"))",
  ].join("\n");
  const runtimeLabel=applicationLabels[2];
  const previousProfile=inheritedSandbox(runtimeLabel)??inheritedSandbox(labels.app);
  const app=["/usr/bin/sandbox-exec","-p",previousProfile??profile,node,"--env-file="+config,path.join(release,"scripts/launch.mjs")];
  const previousAppEnvironment=appEnvironment(applicationLabels[2]);
  const legacyEnvironment=appEnvironment(labels.app);
  const haveStorage=!!registered(labels.db)&&!!registered(labels.objects);
  if(!haveStorage){
    // Adopt only this installation's previously initiated PostgreSQL and Garage.
    await applicationJobs.stop(stopOrder);
    stop(labels.objects);stop(labels.db);
    execFileSync(node,[path.join(release,"scripts/macos-product-storage.mjs"),"stop","primary"],{stdio:"inherit"});
    await portsMatch([pg,s3],false);
    writeJob(labels.db,storage,[postgres,"-D",path.join(storage,"postgres"),"-p",String(pg),"-h","127.0.0.1","-k",socket],env);
    writeJob(labels.objects,storage,[garage,"-c",path.join(storage,"garage.toml"),"server"],env);
    await boot(labels.db);await boot(labels.objects);
  }
  await portsMatch([pg,s3],true);
  const previous = {...legacyEnvironment,...previousAppEnvironment};
  for (const name of ["ONEEARTH_RUNTIME_PORT","ONEEARTH_RUNTIME_URL","ONEEARTH_DISCOVERY_RECOVERY_TOKEN"]) delete previous[name];
  const environment={...env,...previous,ONEEARTH_PORT:"5474",ONEEARTH_DISCOVERY_PORT:"5475",
    ONEEARTH_SPATIAL_PORT:"5476",ONEEARTH_DATA_DIR:data,ONEEARTH_DIST_DIR:path.join(release,"dist"),ONEEARTH_HOST:"127.0.0.1"};
  const savedRecoveryToken = appEnvironment(applicationLabels[3]).ONEEARTH_DISCOVERY_RECOVERY_TOKEN;
  const recoveryToken = savedRecoveryToken || randomBytes(32).toString("base64url");
  const jobs = applicationRoles.map(({role,label})=>{
    const roleEnvironment = {...environment};
    if (role==="worker" || role==="discovery") roleEnvironment.ONEEARTH_DISCOVERY_RECOVERY_TOKEN = recoveryToken;
    if (role==="worker") roleEnvironment.ONEEARTH_OBSERVATION_COORDINATOR = String(label===applicationLabels[3]);
    return {label,content:jobContent(label,release,[...app,role],roleEnvironment)};
  });
  await requireIdleQueues();
  const rollback = backupApplications();
  if (rollback) console.error("OneEarth 启动项回退目录 "+rollback);
  await applicationJobs.install({jobs,stopOrder,quiescent,beforeBoot:requireIdleQueues,beforeRestore:requireIdleQueues,
    verify:()=>applicationHealthy(applicationLabels),verifyRestored});
}else if(action==="rollback"){
  const directory=applicationPath(releaseArg);
  if (path.dirname(directory)!==rollbackRoot) throw Error("须指定已保留的启动项回退目录。");
  validPrivate(directory);
  const jobs=[labels.app,...applicationLabels].flatMap(label=>{
    const source=path.join(directory,label+".plist");
    if (!existsSync(source)) return [];
    validPrivate(source);
    return [{label,content:readFileSync(source)}];
  });
  const legacy=jobs.length===1&&jobs[0].label===labels.app;
  if (!legacy && jobs.map(job=>job.label).join(",")!==applicationLabels.join(",")) throw Error("OneEarth 回退配置缺失或混代。");
  await requireIdleQueues();
  await applicationJobs.install({jobs,stopOrder,quiescent,beforeBoot:requireIdleQueues,beforeRestore:requireIdleQueues,
    verify:()=>applicationHealthy(jobs.map(job=>job.label),legacy),verifyRestored});
}else if(action==="restart"){
  if (applicationJobs.registered(labels.app) || existsSync(file(labels.app))) throw Error("现有旧启动项须经 install 切换。");
  await applicationJobs.stop(stopOrder);
  await quiescent();
  for (const label of applicationLabels) await applicationJobs.boot(label);
  await applicationHealthy(applicationLabels);
}else if(action==="stop"){
  await applicationJobs.stop(stopOrder);
  await quiescent();
}else if(action==="start"){
  if (applicationJobs.registered(labels.app) || existsSync(file(labels.app))) throw Error("现有旧启动项须经 install 切换。");
  for (const label of applicationLabels) await applicationJobs.boot(label);
  await applicationHealthy(applicationLabels);
}else if(action!=="status"){
  throw Error("用法 macos-product-service.mjs install <发布目录> <基础数据目录> | rollback <备份目录> | start | stop | restart | status");
}
const appStatus = applicationLabels.some(label=>existsSync(file(label))) ? applicationLabels : [labels.app];
for(const label of [labels.db,labels.objects,...appStatus]){
  console.log(JSON.stringify(applicationJobs.inspect(label)));
}
