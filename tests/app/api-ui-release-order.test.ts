import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Plain-JS Actions helper.
import {waitForApiDeployment} from '../../scripts/wait-for-api-deployment.mjs';
const sha='a'.repeat(40),other='b'.repeat(40);
function fixture(runs:any[],deployed=true){
 let time=0,calls=0,jobsRead=0;
 const github={rest:{actions:{
  listWorkflowRuns:async(p:any)=>{assert.equal(p.head_sha,sha);assert.equal(p.workflow_id,'deploy-api.yml');return {data:{workflow_runs:runs[Math.min(calls++,runs.length-1)]}};},
  listJobsForWorkflowRun:async(p:any)=>{jobsRead++;assert.equal(p.run_id,12);return {data:{jobs:[{steps:[{name:'Triển khai Edge Function',status:'completed',conclusion:deployed?'success':'skipped'}]}]}};},
 }}};
 return {options:{github,owner:'owner',repo:'repo',sha,timeoutMs:100,pollMs:20,now:()=>time,sleep:async(ms:number)=>{time+=ms;}},calls:()=>calls,jobsRead:()=>jobsRead};
}
test('UI waits for the matching API commit, including a queued job behind an older deployment',async()=>{
 const f=fixture([
  [{id:11,head_sha:other,status:'completed',conclusion:'success'}],
  [{id:12,head_sha:sha,status:'pending'}],
  [{id:12,head_sha:sha,status:'in_progress'}],
  [{id:12,head_sha:sha,status:'completed',conclusion:'success'}],
 ]);
 assert.equal(await waitForApiDeployment(f.options),12);assert.equal(f.calls(),4);assert.equal(f.jobsRead(),1);
});
test('A successful workflow with a skipped deployment cannot publish the new UI',async()=>{
 const f=fixture([[{id:12,head_sha:sha,status:'completed',conclusion:'success'}]],false);
 await assert.rejects(()=>waitForApiDeployment(f.options),/API_DEPLOYMENT_SKIPPED/);
});
test('Failed or cancelled API validation and missing runs block UI without triggering deployment',async()=>{
 for(const conclusion of ['failure','cancelled']){
  const f=fixture([[{id:12,head_sha:sha,status:'completed',conclusion}]]);
  await assert.rejects(()=>waitForApiDeployment(f.options),new RegExp('API_DEPLOYMENT_'+conclusion.toUpperCase()));assert.equal(f.jobsRead(),0);
 }
 const f=fixture([[]]);await assert.rejects(()=>waitForApiDeployment(f.options),/API_DEPLOYMENT_TIMEOUT/);
});
