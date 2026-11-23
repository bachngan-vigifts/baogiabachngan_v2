import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const validSha=value=>/^[a-f0-9]{40}$/.test(value||'');
async function git(cwd,args){return (await exec('git',args,{cwd,timeout:30_000,maxBuffer:10*1024*1024})).stdout.trim();}
/** Reads Actions + Git. May fetch main to verify newly seen commits; never deploys. */
export async function waitForApiDeployment({github,owner,repo,sha,timeoutMs=35*60_000,pollMs=20_000,
  cwd=process.cwd(),mainRef='refs/remotes/origin/main',
  now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),log=()=>{}}) {
  if(!validSha(sha))throw Error('API_SOURCE_SHA_INVALID');
  let history=[];
  async function readHistory(refresh=false){
    try{
      if(refresh)await git(cwd,['fetch','--no-tags','origin','main']);
      history=(await git(cwd,['rev-list','--first-parent',mainRef,'--'])).split('\n');
    }catch{throw Error('API_SOURCE_UNVERIFIED: full main Git history is required; UI release blocked');}
  }
  await readHistory();
  if(!history.includes(sha))await readHistory(true);
  if(!history.includes(sha))throw Error('API_SOURCE_NOT_ON_MAIN: UI release blocked');
  const deadline=now()+timeoutMs;
  while(now()<deadline){
    // GitHub orders by creation, not rerun start. Read all available pages so
    // an old commit rerun after a green release cannot hide beyond page one.
    const all=[];
    for(let page=1;page<=10;page++){
      const response=await github.rest.actions.listWorkflowRuns({owner,repo,workflow_id:'deploy-api.yml',branch:'main',per_page:100,page});
      const {workflow_runs:rows,total_count:count}=response.data;
      if(count>1000)throw Error('API_DEPLOYMENT_HISTORY_INCOMPLETE: Actions search limit reached; UI release blocked');
      all.push(...rows);
      if(all.length>=count||rows.length<100)break;
      if(page===10)throw Error('API_DEPLOYMENT_HISTORY_INCOMPLETE: UI release blocked');
    }
    const runs=all.filter(r=>validSha(r.head_sha)&&r.head_branch==='main'
      &&['push','workflow_dispatch'].includes(r.event)&&r.head_repository?.full_name===`${owner}/${repo}`);
    const started=r=>Date.parse(r.run_started_at||r.created_at||'');
    if(runs.some(r=>!Number.isFinite(started(r))))throw Error('API_DEPLOYMENT_TIME_UNVERIFIED: UI release blocked');
    runs.sort((a,b)=>started(b)-started(a)||b.id-a.id);
    const run=runs[0];
    if(run){
      if(!history.includes(run.head_sha))await readHistory(true);
      if(!history.includes(sha))throw Error('API_SOURCE_NOT_ON_MAIN: UI release blocked');
      if(!history.includes(run.head_sha))throw Error('API_DEPLOYMENT_NOT_ON_MAIN: cannot verify run ancestry; UI release blocked');
      if(history.indexOf(run.head_sha)>history.indexOf(sha))throw Error('API_DEPLOYMENT_SUPERSEDED: the latest API run predates required source; UI release blocked');
    }
    if(run?.status==='completed'){
      if(run.conclusion!=='success')throw Error(`API_DEPLOYMENT_${String(run.conclusion).toUpperCase()}: UI release blocked; inspect API run ${run.id}`);
      const jobs=await github.rest.actions.listJobsForWorkflowRun({owner,repo,run_id:run.id,per_page:100});
      const deployed=jobs.data.jobs.some(job=>job.steps?.some(step=>step.name==='Triển khai Edge Function'&&step.status==='completed'&&step.conclusion==='success'));
      if(!deployed)throw Error('API_DEPLOYMENT_SKIPPED: workflow success without a successful Edge deployment; UI release blocked');
      log(`Required API ${sha} is included in deployed main ${run.head_sha} (run ${run.id}); UI release allowed.`);
      return run.id;
    }
    log(`Waiting for API source ${sha}: ${run?.status??'workflow not registered yet'}.`);
    await sleep(pollMs);
  }
  throw Error('API_DEPLOYMENT_TIMEOUT: UI release blocked; finish the API deployment and rerun UI');
}
