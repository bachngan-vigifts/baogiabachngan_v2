/** Release ordering: read Actions metadata only. Never dispatches, cancels or deploys anything. */
export async function waitForApiDeployment({github,owner,repo,sha,timeoutMs=35*60_000,pollMs=20_000,
  now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),log=()=>{}}) {
  if(!/^[a-f0-9]{40}$/.test(sha))throw Error('API_SOURCE_SHA_INVALID');
  const deadline=now()+timeoutMs;
  while(now()<deadline){
    const response=await github.rest.actions.listWorkflowRuns({owner,repo,workflow_id:'deploy-api.yml',head_sha:sha,per_page:20});
    const run=response.data.workflow_runs.find(r=>r.head_sha===sha);
    if(run?.status==='completed'){
      if(run.conclusion!=='success')throw Error(`API_DEPLOYMENT_${String(run.conclusion).toUpperCase()}: UI release blocked; inspect API run ${run.id}`);
      const jobs=await github.rest.actions.listJobsForWorkflowRun({owner,repo,run_id:run.id,per_page:100});
      const deployed=jobs.data.jobs.some(job=>job.steps?.some(step=>step.name==='Triển khai Edge Function'&&step.status==='completed'&&step.conclusion==='success'));
      if(!deployed)throw Error('API_DEPLOYMENT_SKIPPED: workflow success without a successful Edge deployment; UI release blocked');
      log(`API source ${sha} deployed successfully (run ${run.id}); UI release allowed.`);
      return run.id;
    }
    log(`Waiting for API source ${sha}: ${run?.status??'workflow not registered yet'}.`);
    await sleep(pollMs);
  }
  throw Error('API_DEPLOYMENT_TIMEOUT: UI release blocked; finish the API deployment and rerun UI');
}
