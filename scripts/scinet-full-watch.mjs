// Current-run progress observer; exits at the configured phase boundary, never schedules future work.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
const out=path.resolve('output/scinet-full-capability-2026-11-14');
const read=(p,f=null)=>fs.readFile(p,'utf8').then(JSON.parse).catch(()=>f);
await fs.writeFile(out+'/watch-process.json',JSON.stringify({pid:process.pid,started:new Date().toISOString(),script:'scripts/scinet-full-watch.mjs'}));
for(;;){
 await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/scinet-full-summary.mjs'],{stdio:'inherit'});child.on('error',reject);child.on('close',resolve);});
 const aggregate=await read(out+'/aggregate-progress.json'),states=await Promise.all([1,2,3].map(n=>read(out+'/shard-'+n+'/progress.json')));
 if(aggregate?.phase?.ended===aggregate.phase.total&&states.every(s=>s?.stopped&&!Object.keys(s.running||{}).length))break;
 await new Promise(resolve=>setTimeout(resolve,20000));
}
console.log('PHASE_OBSERVER_END',new Date().toISOString());
