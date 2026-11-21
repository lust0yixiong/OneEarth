import test from 'node:test';
import assert from 'node:assert/strict';
import {ExecutorFailure,executorDiagnostic} from '../../server/executor-failure';
const failure=(stderr:string,stdout='')=>executorDiagnostic({stderr,stdout,exitCode:1,signal:null,elapsedMs:100});
test('process failures do not infer authentication from author, login pages or source HTTP status prose',()=>{
 assert.equal(failure('user\nThe author discussed login forms and source page HTTP 403.','{"message":"The author gives 401 samples."}').kind,'unknown');
 assert.equal(failure('ERROR: stream disconnected before completion\nThe author gives 401 samples.').kind,'network');
 assert.equal(failure('ERROR: 403 Forbidden').kind,'unknown','403 alone does not establish a login problem');
});
test('specific CLI error records distinguish credentials, limits and transport without retaining raw diagnostics',()=>{
 assert.equal(failure('ERROR: 401 Unauthorized: authentication failed').kind,'authentication');
 assert.equal(failure('ERROR: rate limit exceeded (429)').kind,'rate-limit');
 assert.equal(failure('',JSON.stringify({type:'turn.failed',error:{message:'maximum context length exceeded'}})).kind,'context-limit');
 const info=failure('ERROR: stream disconnected before completion; secret-token-private-value');
 assert.equal(info.kind,'network');assert.ok(!JSON.stringify(new ExecutorFailure(info)).includes('secret-token-private-value'));
});
test('cancellation and output limits are not mislabeled as install or login failures',()=>{
 const base={stderr:'',stdout:'',exitCode:null,signal:'SIGKILL',elapsedMs:110000};
 assert.equal(executorDiagnostic({...base,aborted:true}).kind,'aborted');
 assert.equal(executorDiagnostic({...base,outputLimited:true}).kind,'output-limit');
 assert.equal(executorDiagnostic(base).kind,'unknown');
 assert.equal(executorDiagnostic({...base,signal:'SIGSEGV',stderr:'ERROR: authentication failed'}).kind,'unknown');
 assert.equal(executorDiagnostic({...base,timedOut:true}).kind,'timeout');
 assert.equal(executorDiagnostic({...base,signal:null,spawnFailed:true}).kind,'spawn');
});

test('the actual child-process adapter exposes only safe failure diagnostics',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');
 const dir=await mkdtemp(path.join(tmpdir(),'oneearth-executor-fixture-')),oldPath=process.env.PATH;
 try{
  await writeFile(path.join(dir,'codex'),'#!'+process.execPath+'\nprocess.stdin.resume();process.stdin.on("end",()=>{process.stderr.write("ERROR: stream disconnected before completion; private-marker-not-for-diagnostics\\n");process.exit(1);});\n',{mode:0o755});
  process.env.PATH=dir+path.delimiter+oldPath;
  const {runExecutor}=await import('../../server/chat-executor');
  await assert.rejects(runExecutor({executor:'codex',model:''},'fixture prompt that must not be retained',new AbortController().signal),err=>{
   assert.ok(err instanceof ExecutorFailure);assert.equal(err.code,'EXECUTOR_NETWORK');assert.equal(err.diagnostic.exitCode,1);
   assert.ok(!JSON.stringify(err).includes('private-marker-not-for-diagnostics'));assert.ok(!JSON.stringify(err).includes('fixture prompt'));
   return true;
  });
 }finally{if(oldPath===undefined)delete process.env.PATH;else process.env.PATH=oldPath;await rm(dir,{recursive:true,force:true});}
});


test('native structured-output schema errors are configuration failures without raw diagnostic leakage',()=>{
 const payload={type:'error',error:{message:"Invalid schema for response_format 'codex_output_schema': 'schema.required' is required to include every key in properties. Missing 'calculationRequests'.",code:'invalid_json_schema'}};
 const d=failure('ERROR: '+JSON.stringify(payload));
 assert.equal(d.kind,'schema');const error=new ExecutorFailure(d);
 assert.equal(error.code,'EXECUTOR_SCHEMA');assert.ok(!JSON.stringify(error).includes('calculationRequests'));
 assert.equal(failure('user\nInvalid schema for response_format appears in an article.').kind,'unknown');
});
