import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
const {waitForApiDeployment}=await import(process.env.API_GATE_SOURCE||new URL('../../scripts/wait-for-api-deployment.mjs',import.meta.url).href);

// Actual Git history/diffs, synthetic files. No production or GitHub requests.
const cwd=mkdtempSync(join(tmpdir(),'api-ui-gate-'));
const git=(...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
git('init','-q','-b','main');git('config','user.name','Local test');git('config','user.email','local@example.invalid');
const write=(path:string,text:string)=>{mkdirSync(dirname(join(cwd,path)),{recursive:true});writeFileSync(join(cwd,path),text);};
const commit=()=>{git('add','.');git('commit','-qm','fixture');return git('rev-parse','HEAD');};
write('README.md','before API');const older=commit();
const paths=['src/api.ts','supabase/config.toml','migrations/postgres/test.sql','package-lock.json','.github/workflows/deploy-api.yml'];
for(const p of paths)write(p,'api-v1');const sha=commit();
write('trial-ui/index.html','new UI');const newer=commit();
const changed=paths.map(p=>{git('checkout','-q',newer);write(p,'api-v2');return commit();});
git('checkout','-q',newer);git('branch','-f','main',newer);git('remote','add','origin',cwd);
after(()=>rmSync(cwd,{recursive:true,force:true}));
const run=(id:number,head_sha=sha,status='completed',conclusion:string|null='success',extra={})=>({id,head_sha,status,conclusion,head_branch:'main',event:'push',head_repository:{full_name:'owner/repo'},run_attempt:1,run_started_at:new Date(id*1000).toISOString(),...extra});
function fixture(frames:any[][],{deployed=true,mainRef=newer}={}){
 let time=0,calls=0,jobsRead=0;
 const github={rest:{actions:{
  listWorkflowRuns:async(p:any)=>{assert.equal(p.workflow_id,'deploy-api.yml');const runs=frames[Math.min(calls++,frames.length-1)]!;return {data:{workflow_runs:p.head_sha?runs.filter(r=>r.head_sha===p.head_sha):runs}};},
  listJobsForWorkflowRun:async()=>{jobsRead++;return {data:{jobs:[{steps:[{name:'Triển khai Edge Function',status:'completed',conclusion:deployed?'success':'skipped'}]}]}};},
 }}};
 return {options:{github,owner:'owner',repo:'repo',sha,cwd,mainRef,timeoutMs:100,pollMs:20,now:()=>time,sleep:async(ms:number)=>{time+=ms;}},calls:()=>calls,jobsRead:()=>jobsRead};
}
test('UI waits for a matching API main run while queued/running',async()=>{
 const f=fixture([[],[run(12,sha,'queued',null)],[run(12,sha,'in_progress',null)],[run(12)]]);
 assert.equal(await waitForApiDeployment(f.options),12);assert.equal(f.calls(),4);assert.equal(f.jobsRead(),1);
});
test('8a783 failure + newer d186 success with identical API tree allows UI',async()=>{
 const f=fixture([[run(12,newer),run(11,sha,'completed','failure')]]);
 assert.equal(await waitForApiDeployment(f.options),12);assert.equal(f.jobsRead(),1);
});
test('every API path difference blocks the newer green run',async()=>{
 for(const head of changed){const f=fixture([[run(12,head),run(11)]],{mainRef:head});await assert.rejects(()=>waitForApiDeployment(f.options),/API_SOURCE_MISMATCH/);assert.equal(f.jobsRead(),0);}
});
test('the newest main commit failure/cancellation never falls back to older green',async()=>{
 for(const conclusion of ['failure','cancelled']){
  const f=fixture([[run(13,newer,'completed',conclusion),run(12)]]);
  await assert.rejects(()=>waitForApiDeployment(f.options),new RegExp('API_DEPLOYMENT_'+conclusion.toUpperCase()));assert.equal(f.jobsRead(),0);
 }
});
test('the latest run of the same newer commit wins over its earlier green run',async()=>{
 const f=fixture([[run(13,newer,'completed','failure'),run(12,newer),run(11)]]);
 await assert.rejects(()=>waitForApiDeployment(f.options),/API_DEPLOYMENT_FAILURE/);
 const pending=fixture([[run(13,newer,'in_progress',null),run(12,newer),run(11)]]);
 await assert.rejects(()=>waitForApiDeployment(pending.options),/API_DEPLOYMENT_TIMEOUT/);assert.equal(pending.jobsRead(),0);
 const rerun=fixture([[run(12,newer,'completed','failure',{run_attempt:2,run_started_at:new Date(15000).toISOString()}),run(13,newer)]]);
 await assert.rejects(()=>waitForApiDeployment(rerun.options),/API_DEPLOYMENT_FAILURE/);
});
test('successful workflow still requires the actual Edge deployment step',async()=>{
 const f=fixture([[run(12,newer)]],{deployed:false});await assert.rejects(()=>waitForApiDeployment(f.options),/API_DEPLOYMENT_SKIPPED/);
});
test('PR/fork/feature branch green runs are never evidence of a main deployment',async()=>{
 for(const extra of [{event:'pull_request'},{head_branch:'feature'},{head_repository:{full_name:'fork/repo'}}]){
  const f=fixture([[run(12,newer,'completed','success',extra)]]);await assert.rejects(()=>waitForApiDeployment(f.options),/API_DEPLOYMENT_TIMEOUT/);
 }
});
test('main ancestry wins over API list ordering, with no stale rerun overwriting proof',async()=>{
 const f=fixture([[run(11),run(12,newer)]]);assert.equal(await waitForApiDeployment(f.options),12);
 const stale=fixture([[run(11,sha,'completed','failure',{run_attempt:2,run_started_at:new Date(15000).toISOString()}),run(12,newer)]]);
 await assert.rejects(()=>waitForApiDeployment(stale.options),/API_DEPLOYMENT_SUPERSEDED/);
 const rollback=fixture([[run(10,older,'completed','success',{run_started_at:new Date(15000).toISOString()}),run(12,newer)]]);
 await assert.rejects(()=>waitForApiDeployment(rollback.options),/API_DEPLOYMENT_SUPERSEDED/);
});
test('non-main or missing history fails closed rather than using older green',async()=>{
 const f=fixture([[run(13,changed[0]),run(12)]]);
 await assert.rejects(()=>waitForApiDeployment(f.options),/API_DEPLOYMENT_NOT_ON_MAIN/);
 await assert.rejects(()=>waitForApiDeployment({...f.options,sha:'f'.repeat(40)}),/API_SOURCE_NOT_ON_MAIN/);
});
test('a main run created after checkout can refresh and verify its actual Git history',async()=>{
 const mainRef='refs/remotes/origin/main';git('update-ref',mainRef,sha);
 const f=fixture([[run(12,newer)]],{mainRef});assert.equal(await waitForApiDeployment(f.options),12);
 assert.equal(git('rev-parse',mainRef),newer);
});
test('invalid source or unreadable repository never bypasses the gate',async()=>{
 const f=fixture([[run(12,newer)]]);
 await assert.rejects(()=>waitForApiDeployment({...f.options,sha:'--help'}),/API_SOURCE_SHA_INVALID/);
 await assert.rejects(()=>waitForApiDeployment({...f.options,cwd:join(cwd,'missing')}),/API_SOURCE_UNVERIFIED/);
});
test('failed/missing runs block without dispatch/cancel/deploy APIs',async()=>{
 const f=fixture([[run(12,sha,'completed','failure')]]);await assert.rejects(()=>waitForApiDeployment(f.options),/API_DEPLOYMENT_FAILURE/);
 const missing=fixture([[]]);await assert.rejects(()=>waitForApiDeployment(missing.options),/API_DEPLOYMENT_TIMEOUT/);
});
test('source paths stay aligned with the API workflow and UI has full Git history',()=>{
 const api=readFileSync(new URL('../../.github/workflows/deploy-api.yml',import.meta.url),'utf8');
 for(const p of ['src/**','supabase/**','migrations/postgres/**','package-lock.json','.github/workflows/deploy-api.yml'])assert.ok(api.includes("'"+p+"'"));
 assert.match(readFileSync(new URL('../../.github/workflows/deploy-ui.yml',import.meta.url),'utf8'),/fetch-depth: 0/);
});
