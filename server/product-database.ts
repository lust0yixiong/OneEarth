import { Pool } from "pg";

export function productDatabase(name:"RUNTIME"|"DISCOVERY"|"SPATIAL") {
  const variable="ONEEARTH_"+name+"_DATABASE_URL";
  const value=process.env[variable];
  if(!value)throw Error(variable+" 缺失，产品服务需要独立 PostgreSQL 数据库。");
  const url=new URL(value);
  if(!["postgresql:","postgres:"].includes(url.protocol)||!url.hostname||url.pathname.length<2)
    throw Error(variable+" 必须明确指定 PostgreSQL 服务器与数据库。");
  const assertionHost=process.env.ONEEARTH_ASSERTION_PG_HOST;
  const assertionPort=process.env.ONEEARTH_ASSERTION_PG_PORT || "5432";
  if(assertionHost && url.hostname.toLowerCase()===assertionHost.toLowerCase() &&
    (url.port || "5432")===assertionPort)
    throw Error(variable+" 不能指向断言库服务器。");
  const pool=new Pool({connectionString:value,application_name:"oneearth-"+name.toLowerCase(),connectionTimeoutMillis:5000,max:8});
  pool.on("error",()=>console.error("OneEarth "+name.toLowerCase()+" PostgreSQL idle connection lost"));
  return pool;
}
