import {execFileSync} from "node:child_process";
import {createConnection} from "node:net";
import {accessSync,existsSync,mkdirSync,readFileSync,realpathSync,renameSync,statSync,unlinkSync,writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {setTimeout as wait} from "node:timers/promises";

if(process.platform!=="darwin")throw Error("此命令用于 macOS。");
const [action,releaseArg,dataArg]=process.argv.slice(2);
const home=homedir();
const root=path.join(home,"Library/Application Support/OneEarth Next");
const storage=path.join(root,"storage-primary");
const agents=path.join(home,"Library/LaunchAgents");
const logDir=path.join(root,"logs");
const domain="gui/"+process.getuid();
const appPorts=[5474,5475,5476,5477];
const labels={db:"org.oneearth.next.postgres",objects:"org.oneearth.next.garage",app:"org.oneearth.next"};
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
function appEnvironment(){
  const current=file(labels.app);
  if(!existsSync(current))return {};
  validPrivate(current);
  const text=execFileSync("/usr/bin/plutil",["-extract","EnvironmentVariables","json","-o","-",current],{encoding:"utf8"});
  const values=JSON.parse(text);
  if(!values || Array.isArray(values) || Object.values(values).some(value=>typeof value!=="string"))
    throw Error("现有 OneEarth 启动环境格式无效。");
  return values;
}
function applicationPath(candidate){
  if(!candidate||!path.isAbsolute(candidate))throw Error("发布目录和数据目录须为绝对路径。");
  const real=realpathSync(candidate);
  if(!real.startsWith(realpathSync(root)+path.sep))throw Error("托管文件须放在 OneEarth Next 专用目录。");
  return real;
}
function writeJob(label,workingDirectory,args,environment){
  const logfile=path.join(logDir,label+".log");
  writeFileSync(logfile,"",{flag:"a",mode:0o600});
  const plist='<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">'+xml({
    Label:label,ProgramArguments:args,WorkingDirectory:workingDirectory,EnvironmentVariables:environment,
    RunAtLoad:true,KeepAlive:true,ThrottleInterval:5,ExitTimeOut:20,StandardOutPath:logfile,StandardErrorPath:logfile,
  })+"</plist>\n";
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
  throw Error("OneEarth Next 存储端口未进入期望状态。");
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
if(action==="install"){
  validPrivate(root);
  const release=applicationPath(releaseArg);
  const data=applicationPath(dataArg);
  const config=path.join(storage,"deployment.env");
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
  const app=["/usr/bin/sandbox-exec","-p",profile,node,"--env-file="+config,path.join(release,"scripts/launch.mjs")];
  const previousAppEnvironment=appEnvironment();
  const haveStorage=!!registered(labels.db)&&!!registered(labels.objects);
  if(!haveStorage){
    // Adopt only this installation's previously initiated PostgreSQL and Garage.
    stop(labels.app);stop(labels.objects);stop(labels.db);
    execFileSync(node,[path.join(release,"scripts/macos-product-storage.mjs"),"stop","primary"],{stdio:"inherit"});
    await portsMatch([pg,s3],false);
    writeJob(labels.db,storage,[postgres,"-D",path.join(storage,"postgres"),"-p",String(pg),"-h","127.0.0.1","-k",socket],env);
    writeJob(labels.objects,storage,[garage,"-c",path.join(storage,"garage.toml"),"server"],env);
    await boot(labels.db);await boot(labels.objects);
  }
  await portsMatch([pg,s3],true);
  stop(labels.app);
  await portsMatch(appPorts,false);
  writeJob(labels.app,release,app,{...previousAppEnvironment,...env,ONEEARTH_PORT:"5474",ONEEARTH_DISCOVERY_PORT:"5475",
    ONEEARTH_SPATIAL_PORT:"5476",ONEEARTH_RUNTIME_PORT:"5477",ONEEARTH_DATA_DIR:data,ONEEARTH_HOST:"127.0.0.1"});
  await boot(labels.app);
}else if(action==="restart"){
  stop(labels.app);
  await portsMatch(appPorts,false);
  await boot(labels.app);
}else if(action==="stop"){
  stop(labels.app);
}else if(action==="start"){
  if(!registered(labels.app))await boot(labels.app);
}else if(action!=="status"){
  throw Error("用法 macos-product-service.mjs install <发布目录> <基础数据目录> | start | stop | restart | status");
}
for(const label of Object.values(labels)){
  const status=registered(label);
  const read=key=>status.match(new RegExp("^\\s*"+key+" = (.+)$","m"))?.[1];
  console.log(JSON.stringify({label,registered:!!status,state:read("state"),pid:Number(read("pid"))||undefined}));
}
