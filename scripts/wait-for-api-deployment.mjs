import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
// Keep identical to the API source paths used by deploy-api.yml / deploy-ui.yml.
const API_PATHS=['src/','supabase/','migrations/postgres/','package-lock.json','.github/workflows/deploy-api.yml'];
const validSha=value=>/^[a-f0-9]{40}$/.test(value||'');
async function git(cwd,args){return (await exec('git',args,{cwd,timeout:30_000,maxBuffer:10*1024*1024})).stdout.trim();}
async function sameSource(cwd,from,to){
  try{await git(cwd,['diff','--quiet',from,to,'--',...API_PATHS]);return true;}
  catch(e){if(e.code===1)return false;throw Error('API_SOURCE_UNVERIFIED: cannot compare Git source; UI release blocked');}
}
/** Reads Actions + Git. May fetch main to verify newly seen commits; never deploys. */
export async function waitForApiDeployment({github,owner,repo,sha,timeoutMs=35*60_000,pollMs=20_000,
  cwd=process.cwd(),mainRef='refs/remotes/origin/main',
  now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),log=()=>{}}) {
  if(!validSha(sha))throw Error('API_SOURCE_SHA_INVALID');
  let history=[];const checkedSources=new Map();
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
    const response=await github.rest.actions.listWorkflowRuns({owner,repo,workflow_id:'deploy-api.yml',branch:'main',per_page:100});
    const runs=response.data.workflow_runs.filter(r=>validSha(r.head_sha)&&r.head_branch==='main'
      &&['push','workflow_dispatch'].includes(r.event)&&r.head_repository?.full_name===`${owner}/${repo}`);
    if(runs.some(r=>!history.includes(r.head_sha)))await readHistory(true);
    if(runs.some(r=>!history.includes(r.head_sha)))throw Error('API_DEPLOYMENT_NOT_ON_MAIN: cannot verify run ancestry; UI release blocked');
    // Commit order, not the API response order, selects the newest main commit.
    // Within that commit the newest run wins, including its current rerun attempt.
    const relevant=runs.filter(r=>history.indexOf(r.head_sha)<=history.indexOf(sha));
    const started=r=>Date.parse(r.run_started_at||r.created_at||'')||0;
    relevant.sort((a,b)=>history.indexOf(a.head_sha)-history.indexOf(b.head_sha)||started(b)-started(a)||b.id-a.id);
    const run=relevant[0];
    if(run){
      if(!checkedSources.has(run.head_sha))checkedSources.set(run.head_sha,await sameSource(cwd,sha,run.head_sha));
      if(!checkedSources.get(run.head_sha))throw Error(`API_SOURCE_MISMATCH: UI release blocked; inspect API run ${run.id}`);
      // An old commit rerun after the chosen green run can replace production.
      // Do not treat that older green evidence as proof of the current API.
      if(runs.some(r=>r.id!==run.id&&started(r)>started(run)))throw Error('API_DEPLOYMENT_SUPERSEDED: a different API run started later; UI release blocked');
    }
    if(run?.status==='completed'){
      if(run.conclusion!=='success')throw Error(`API_DEPLOYMENT_${String(run.conclusion).toUpperCase()}: UI release blocked; inspect API run ${run.id}`);
      const jobs=await github.rest.actions.listJobsForWorkflowRun({owner,repo,run_id:run.id,per_page:100});
      const deployed=jobs.data.jobs.some(job=>job.steps?.some(step=>step.name==='Triển khai Edge Function'&&step.status==='completed'&&step.conclusion==='success'));
      if(!deployed)throw Error('API_DEPLOYMENT_SKIPPED: workflow success without a successful Edge deployment; UI release blocked');
      log(`API source ${sha} matches deployed main ${run.head_sha} (run ${run.id}); UI release allowed.`);
      return run.id;
    }
    log(`Waiting for API source ${sha}: ${run?.status??'workflow not registered yet'}.`);
    await sleep(pollMs);
  }
  throw Error('API_DEPLOYMENT_TIMEOUT: UI release blocked; finish the API deployment and rerun UI');
}
