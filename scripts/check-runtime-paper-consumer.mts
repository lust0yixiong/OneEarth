import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {queryPapers} from '../server/discovery-a2a-client.ts';
import {spatialCoverageClient} from '../server/spatial-coverage-client.ts';

// Explicit isolated endpoints only. This script never publishes, searches,
// creates scopes, opens a database, or invokes a model.
const configPath=process.argv[2],outputPath=process.argv[3];
if(!configPath||!outputPath)throw Error('Usage: node --import tsx scripts/check-runtime-paper-consumer.mts <config.json> <new-report.json>');
const config=JSON.parse(readFileSync(configPath,'utf8'));
function origin(raw:string){const url=new URL(raw);if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.port||[5174,5474,5814].includes(Number(url.port))||url.username||url.password||url.pathname!=='/')throw Error('Explicit isolated loopback origin required');return url.origin;}
const runtime=origin(config.runtimeUrl),discovery=origin(config.discoveryUrl),spatial=config.spatialUrl?origin(config.spatialUrl):undefined;
process.env.ONEEARTH_DISCOVERY_URL=discovery;
const signal=AbortSignal.timeout(90000),calls:string[]=[];
const plain=(value:any):any=>Array.isArray(value)?value.map(plain):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,plain(value[key])])):value;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(plain(value))).digest('hex');
async function get(route:string){calls.push('GET '+route);const res=await fetch(new URL(route,runtime),{signal});if(!res.ok)throw Error(route+' HTTP '+res.status);return res.json();}
const before=config.taskId?await get('/api/tasks/'+config.taskId+'/record'):undefined;
async function scan(read:(cursor:string)=>Promise<any>){
 let cursor='',revision:string|undefined,total:number|undefined;const seen=new Set<string>(),ids=new Set<string>(),keys=new Set<string>();let pages=0;
 for(;;){const page=await read(cursor);pages++;assert.equal(typeof page.catalog?.revision,'string');assert.ok(page.catalog.revision.length);
  if(revision===undefined){revision=page.catalog.revision;total=page.total;}
  assert.equal(page.catalog.revision,revision,'Publication changed during probe; retry from a new head');assert.equal(page.total,total);
  for(const record of page.records){assert.ok(!ids.has(record.id));assert.ok(!keys.has(record.dsKey));ids.add(record.id);keys.add(record.dsKey);}
  if(page.nextCursor===null)break;assert.equal(typeof page.nextCursor,'string');assert.ok(page.records.length&&page.nextCursor!==cursor&&!seen.has(page.nextCursor));seen.add(page.nextCursor);cursor=page.nextCursor;
 }
 assert.equal(ids.size,total);return{revision,total,pages,ids:[...ids].sort()};
}
const provider=await scan(cursor=>{calls.push('A2A paper.list');return queryPapers({operation:'list',view:'catalog',cursor,limit:500},signal);});
const publicView=await scan(cursor=>get('/api/paper-records?view=catalog&limit=500&cursor='+encodeURIComponent(cursor)));
assert.equal(publicView.revision,provider.revision,'Publication changed between provider and runtime probes; retry');assert.deepEqual(publicView.ids,provider.ids);
const finalHead=await queryPapers({operation:'list',view:'catalog',cursor:'',limit:1},signal);assert.equal(finalHead.catalog.revision,provider.revision,'Publication changed during probe; retry');
const exact=[];
for(const item of config.exact||[]){assert.match(item.id,/^earthnano:[a-f0-9]{64}$/);const rows=await get('/api/paper-records?ids='+encodeURIComponent(item.id));assert.ok(rows.every((r:any)=>r.id===item.id));
 const found=rows[0];if(item.expectedMissing)assert.equal(rows.length,0);else{assert.equal(rows.length,1);if(item.dsKey)assert.equal(found.dsKey,item.dsKey);if(item.expectedSha256)assert.equal(hash(found),item.expectedSha256);}
 exact.push({id:item.id,found:!!found,sha256:found?hash(found):null});
}
const scopes=[];
for(const sample of config.scopes||[]){assert.ok(spatial);calls.push('POST existing coverage.cells');const result=await spatialCoverageClient(spatial)({cell:sample.cell,scope:{id:sample.id,revision:sample.revision}},signal);
 assert.equal(result.status,sample.expectedStatus);if(sample.expectedReason&&result.status==='unknown')assert.equal(result.reason,sample.expectedReason);
 if(result.status==='ready'){if(sample.expectedCount!==undefined)assert.equal(result.count,sample.expectedCount);if(sample.expectedSourceIds)assert.deepEqual([...result.sourceIds].sort(),[...sample.expectedSourceIds].sort());}
 scopes.push({id:sample.id,revision:sample.revision,status:result.status,...(result.status==='ready'?{count:result.count,sourceIds:result.sourceIds}:{reason:result.reason})});
}
const after=config.taskId?await get('/api/tasks/'+config.taskId+'/record'):undefined;
if(before){assert.equal(hash(after),hash(before),'Original runtime research archive changed');if(config.expectedTaskSha256)assert.equal(hash(before),config.expectedTaskSha256);}
const report={checkedAt:new Date().toISOString(),runtime,discovery,spatial,provider,publicView,exact,scopes,archive:before?{id:config.taskId,sha256:hash(before),unchanged:true}:null,operations:calls,modelOrSearchRequests:0,storageOpened:false};
mkdirSync(path.dirname(path.resolve(outputPath)),{recursive:true});writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({ok:true,revision:provider.revision,total:provider.total,exact:exact.length,scopes:scopes.length,archiveUnchanged:!!before,report:outputPath}));
