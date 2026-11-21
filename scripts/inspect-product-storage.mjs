import assert from "node:assert/strict";
import { Pool } from "pg";

const runtime=new Pool({connectionString:process.env.ONEEARTH_RUNTIME_DATABASE_URL});
const discovery=new Pool({connectionString:process.env.ONEEARTH_DISCOVERY_DATABASE_URL});
const spatial=new Pool({connectionString:process.env.ONEEARTH_SPATIAL_DATABASE_URL});
try{
  const counts=async(pool,names)=>{
    const data={};
    for(const name of names)data[name]=Number((await pool.query("SELECT count(*) AS n FROM "+name)).rows[0].n);
    return data;
  };
  const r=await counts(runtime,["runtime_tasks","runtime_events","runtime_confirmations","runtime_references","result_snapshots"]);
  const d=await counts(discovery,["discovery_tasks","discovery_events","discovery_findings","discovery_channels","discovery_papers"]);
  const s=await counts(spatial,["layers","layer_chunks"]);
  const confirmation=(await runtime.query("SELECT count(*) AS n FROM runtime_confirmations WHERE decision IS NOT NULL AND parent_task_id IS NOT NULL")).rows[0].n;
  const versions=(await spatial.query("SELECT current_setting('server_version') AS postgresql, postgis_lib_version() AS postgis")).rows[0];
  assert.ok(r.runtime_tasks>0 && r.runtime_events>0 && r.runtime_references>0);
  assert.ok(d.discovery_tasks>0 && d.discovery_events>0 && d.discovery_findings>0 && d.discovery_channels>0 && d.discovery_papers>0);
  assert.ok(s.layer_chunks>0 && s.layers>0);
  console.log(JSON.stringify({versions,runtime:r,discovery:d,spatial:s,recordedUserDecisions:Number(confirmation)},null,2));
}finally{await Promise.all([runtime.end(),discovery.end(),spatial.end()]);}
