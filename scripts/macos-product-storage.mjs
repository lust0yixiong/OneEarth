import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";

const [action,name="primary",pgRaw="55432",s3Raw="5900"]=process.argv.slice(2);
if(process.platform!=="darwin"||!["init","start","stop"].includes(action)||!/^[a-z][a-z0-9-]{0,29}$/.test(name))
  throw Error("用法：macos-product-storage.mjs init|start|stop <实例名> <PG端口> <S3端口>");
const locations=path.join(homedir(),"Library/Application Support/OneEarth Next");
const state=path.join(locations,"storage-"+name);
const metaFile=path.join(state,"installation.json");
const envFile=path.join(state,"deployment.env");
const garageCfg=path.join(state,"garage.toml");
const pgData=path.join(state,"postgres");
const rg=()=>randomBytes(32).toString("hex");
const trusted=(file,mode=0o600)=>{const stat=statSync(file);if(stat.uid!==process.getuid()||(stat.mode&0o077)!==0)throw Error("安装目录或配置须仅当前用户可访问。");return mode;};
const write=(file,content)=>writeFileSync(file,content,{mode:0o600,flag:"wx"});
function exec(binary,args,options={}){
  try{return execFileSync(binary,args,{encoding:"utf8",stdio:[options.input===undefined?"ignore":"pipe","pipe","pipe"],...options});}
  catch(e){throw Error(path.basename(binary)+" "+args[0]+" failed ("+(e.status ?? e.code)+")");}
}

mkdirSync(locations,{recursive:true,mode:0o700});
if(action==="init"){
  const pg=Number(pgRaw),s3=Number(s3Raw),rpc=s3+1;
  if(![pg,s3,rpc].every(x=>Number.isInteger(x)&&x>=1024&&x<=65535&&x!==5174)||new Set([pg,s3,rpc]).size!==3)
    throw Error("存储端口无效。");
  mkdirSync(state,{mode:0o700});
  const binaries=process.env.ONEEARTH_PG_BIN_DIR;
  if(!binaries || !path.isAbsolute(binaries))throw Error("请将 ONEEARTH_PG_BIN_DIR 设为自带 PostGIS 的 PostgreSQL bin 绝对路径。");
  const garage=process.env.ONEEARTH_GARAGE_BIN || "/opt/homebrew/bin/garage";
  const socket=mkdtempSync(path.join(tmpdir(),"/oneearth-pg-"));
  const install={pg,s3,rpc,binaries,garage,socket};
  write(metaFile,JSON.stringify(install));
  write(garageCfg,`metadata_dir = ${JSON.stringify(path.join(state,"garage-meta"))}
data_dir = ${JSON.stringify(path.join(state,"garage-data"))}
db_engine = "lmdb"
replication_factor = 1
rpc_bind_addr = "127.0.0.1:${rpc}"
rpc_public_addr = "127.0.0.1:${rpc}"
rpc_secret = "${rg()}"
[s3_api]
s3_region = "garage"
api_bind_addr = "127.0.0.1:${s3}"
`);
  exec(path.join(binaries,"initdb"),["-D",pgData,"-U","oneearth_admin","--no-locale","--encoding=UTF8",
    "--auth-local=trust","--auth-host=scram-sha-256"]);
}
trusted(state);
trusted(metaFile);
const {pg,s3,binaries,garage,socket}=JSON.parse(readFileSync(metaFile,"utf8"));
const pgCommand=(name,args,options)=>exec(path.join(binaries,name),args,options);
const garageCommand=(...args)=>exec(garage,["-c",garageCfg,...args]);
const pgStatus=()=>{try{pgCommand("pg_ctl",["status","-D",pgData]);return true;}catch{return false;}};
const admin=(db,sql)=>pgCommand("psql",["-h",socket,"-p",String(pg),"-U","oneearth_admin","-d",db,
  "-X","-q","-v","ON_ERROR_STOP=1"],{input:sql});
if(action==="stop"){
  if(pgStatus())pgCommand("pg_ctl",["-D",pgData,"stop","-m","fast"]);
  const pidfile=path.join(state,"garage.pid");
  if(existsSync(pidfile)){
    const pid=Number(readFileSync(pidfile,"utf8"));
    try{
      const command=exec("/bin/ps",["-p",String(pid),"-o","command="]);
      if(command.includes(garageCfg) && command.includes("server"))process.kill(pid,"SIGTERM");
    }catch{/* Already stopped. */}
  }
  process.exit(0);
}
if(!pgStatus()){
  mkdirSync(socket,{recursive:true,mode:0o700});
  pgCommand("pg_ctl",["-D",pgData,"-l",path.join(state,"postgres.log"),"-w","start",
    "-o",'-p '+pg+' -h 127.0.0.1 -k "'+socket+'"']);
}
try{garageCommand("status");}
catch{
  const log=openSync(path.join(state,"garage.log"),"a",0o600);
  try{
    const daemon=spawn(garage,["-c",garageCfg,"server"],{detached:true,stdio:["ignore",log,log]});
    daemon.once("error",()=>{});
    if(daemon.pid)writeFileSync(path.join(state,"garage.pid"),String(daemon.pid),{mode:0o600});
    daemon.unref();
  }finally{closeSync(log);}
  for(let i=0;;i++){
    try{garageCommand("status");break;}
    catch(error){if(i===50)throw error;await pause(200);}
  }
}
if(action==="init"){
  const pass=rg();
  const databases=["runtime","discovery","spatial"];
  admin("postgres","CREATE ROLE oneearth_app LOGIN PASSWORD '"+pass+"';\n"+
    databases.map(db=>"CREATE DATABASE oneearth_"+db+" OWNER oneearth_app;").join("\n"));
  admin("oneearth_spatial","CREATE EXTENSION IF NOT EXISTS postgis;");
  const node=garageCommand("node","id","-q").trim().split("@")[0];
  if(!/^[a-f0-9]{16,64}$/.test(node))throw Error("Garage 节点 ID 无效。");
  garageCommand("layout","assign","-z","macmini","-c","10GB",node);
  garageCommand("layout","apply","--version","1");
  const bucket="oneearth-layers";
  garageCommand("bucket","create",bucket);
  const keyText=garageCommand("key","create","oneearth-layer-store");
  const keyID=/^Key ID:\s*(\S+)/mi.exec(keyText)?.[1];
  const secret=/^Secret key:\s*(\S+)/mi.exec(keyText)?.[1];
  if(!keyID||!secret)throw Error("无法读取新建的对象存储访问权限。");
  garageCommand("bucket","allow",bucket,"--read","--write","--key",keyID);
  const vars={
    ...Object.fromEntries(databases.map(db=>["ONEEARTH_"+db.toUpperCase()+"_DATABASE_URL","postgresql://oneearth_app:"+pass+"@127.0.0.1:"+pg+"/oneearth_"+db])),
    ONEEARTH_OBJECT_ENDPOINT:"http://127.0.0.1:"+s3,
    ONEEARTH_OBJECT_BUCKET:bucket,ONEEARTH_OBJECT_PATH_STYLE:"1", AWS_REGION:"garage",
    AWS_ACCESS_KEY_ID:keyID,AWS_SECRET_ACCESS_KEY:secret,
    ONEEARTH_CREDENTIALS_FILE:path.join(locations,"access.json"),
    ONEEARTH_STATE_DIR:path.join(state,"app-state"),
  };
  write(envFile,Object.entries(vars).map(([k,v])=>k+"="+JSON.stringify(v)).join("\n")+"\n");
}
console.log(JSON.stringify({setting:envFile,postgresPort:pg,s3Port:s3}));
