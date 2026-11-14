'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const freshness = require('../../scripts/ci/pr-freshness.cjs');
const A = 'a'.repeat(40), B = 'b'.repeat(40), H = 'c'.repeat(40), M = 'd'.repeat(40);
function fixture() {
  const pr = { number: 7, state: 'open', draft: false, head: {sha:H},
    base: {ref:'main',repo:{full_name:'owner/repo'}} };
  const context = { eventName:'pull_request',sha:M,repo:{owner:'owner',repo:'repo'},
    payload:{pull_request:structuredClone(pr)} };
  const data = {pr, bases:[B,B], comparison:{status:'ahead',behind_by:0,merge_base_commit:{sha:B}},
    commit:{sha:M,parents:[{sha:B},{sha:H}]}};
  let calls=0, reads=0;
  const wrap = fn => async args => { calls++; return {data:fn(args)}; };
  const github = {rest:{
    pulls:{get:wrap(() => { reads++; return data.onPR ? data.onPR(reads) : data.pr; })},
    git:{getRef:wrap(() => ({object:{sha:data.bases.shift()}}))},
    repos:{
      compareCommitsWithBasehead:wrap(args => {
        assert.equal(args.basehead,B+'...'+H); return data.comparison;
      }),
      getCommit:wrap(args => {assert.equal(args.ref,M);return data.commit;})
    }
  }};
  return { data,context,github, calls:()=>calls };
}
test('current ready PR validates exact head, base and tested merge',async()=>{
  const f=fixture();await freshness(f);assert.equal(f.calls(),6);
});
test('identical base/head accepted only with valid merge ancestry',async()=>{
  const f=fixture(); f.data.comparison.status='identical';await freshness(f);
});
for(const status of ['behind','diverged','unknown',null]) test('reject comparison '+status,async()=>{
  const f=fixture();f.data.comparison.status=status;await assert.rejects(freshness(f),/Update branch/);
});
for(const mutation of [
  f=>f.data.comparison.merge_base_commit.sha=A,
  f=>f.data.comparison.behind_by=1,
  f=>delete f.data.comparison.behind_by,
  f=>f.data.commit.sha=A,
  f=>f.data.commit.parents[0].sha=A,
  f=>f.data.commit.parents[1].sha=A,
  f=>f.data.commit.parents=[],
  f=>f.data.bases=[B,A],
]) test('reject stale or malformed ancestry '+mutation.toString(),async()=>{
  const f=fixture();mutation(f);await assert.rejects(freshness(f),/Update branch/);
});
for(const mutation of [
  pr=>pr.head.sha=A, pr=>pr.base.ref='other',pr=>pr.base.repo.full_name='other/repo',
  pr=>pr.state='closed',pr=>pr.draft=true
]) for(const when of [1,2]) test('PR mutation on read '+when+' '+mutation.toString(),async()=>{
  const f=fixture();f.data.onPR=n=>{const pr=structuredClone(f.data.pr);if(n===when)mutation(pr);return pr};
  await assert.rejects(freshness(f),/changed/);
});
for(const [group,method] of [['pulls','get'],['git','getRef'],['repos','compareCommitsWithBasehead'],['repos','getCommit']])
 for(const status of [403,404,429,500]) test('API '+group+'.'+method+' '+status+' fails closed',async()=>{
  const f=fixture();f.github.rest[group][method]=async()=>{throw Error('HTTP '+status)};
  await assert.rejects(freshness(f),new RegExp('HTTP '+status));
});
test('network failure fails closed',async()=>{
 const f=fixture();f.github.rest.pulls.get=async()=>{throw Error('timeout')};
 await assert.rejects(freshness(f),/timeout/);
});
test('malformed base rejected',async()=>{
 const f=fixture();f.data.bases=['bad'];await assert.rejects(freshness(f),/Invalid base/);
});
test('invalid event rejected',async()=>{
 const f=fixture();f.context.payload.pull_request.head.sha='bad';
 await assert.rejects(freshness(f),/Invalid PR event/);assert.equal(f.calls(),0);
});
test('draft gets feedback with one read and no ancestry API',async()=>{
 const f=fixture();f.data.pr.draft=true;f.context.payload.pull_request.draft=true;
 await freshness(f);assert.equal(f.calls(),1);
});
test('draft becoming ready invalidates old smoke run',async()=>{
 const f=fixture();f.context.payload.pull_request.draft=true;
 await assert.rejects(freshness(f),/changed/);
});
test('manual run never queries a PR or reuses PR results',async()=>{
 const f=fixture();f.context.eventName='workflow_dispatch';await freshness(f);assert.equal(f.calls(),0);
});
const workflow=readFileSync(new URL('../../.github/workflows/ci.yml','file://'+__filename),'utf8');
const aggregate=workflow.split('      - name: Require every expected check to pass')[1].split('        run: |\n')[1]
 .split('\n').map(line=>line.replace(/^          /,'')).join('\n');
for(const prepare of ['success','failure','cancelled','skipped',''])
 for(const shard of ['success','failure','cancelled','skipped',''])
  for(const mode of ['ready','draft','manual-full','manual-smoke']) test('aggregate '+[mode,prepare,shard].join('/'),()=>{
   const full=['ready','manual-full'].includes(mode);
   const result=spawnSync('bash',['-e','-c',aggregate],{env:{...process.env,
    IS_PR:String(['ready','draft'].includes(mode)),FULL_REQUIRED:String(full),
    PREPARE_RESULT:prepare,SHARD_RESULT:shard}});
   const pass=mode!=='draft'&&prepare==='success'&&shard===(full?'success':'skipped');
   assert.equal(result.status===0,pass,result.stdout?.toString()+result.stderr?.toString());
  });
test('workflow keeps full suite and always aggregate, no duplicate push trigger',()=>{
 assert.match(workflow,/if: always\(\)/);
 assert.match(workflow,/needs: \[prepare, full-shards\]/);
 assert.match(workflow,/shard: \[1, 2, 3, 4\]/);
 assert.match(workflow,/--test-shard=\$\{\{ matrix.shard \}\}\/4 "tests\/\*\*\/\*\.test.ts" "src\/\*\*\/\*\.test.ts"/);
 assert.match(workflow,/ready_for_review, converted_to_draft/);
 assert.doesNotMatch(workflow,/pull_request_target:|\n  push:|checks: write|statuses: write|continue-on-error/);
 assert.equal((workflow.match(/persist-credentials: false/g)||[]).length,3);
 assert.equal((workflow.match(/pr-freshness.cjs/g)||[]).length,3);
 assert.match(workflow,/'manual shard'/);
 assert.match(workflow,/'manual validation'/);
 assert.ok(workflow.indexOf('pr-freshness.cjs')<workflow.indexOf('npm ci'));
});

test('blocked PR shards settle as failure before checkout/npm, not skipped green',()=>{
 const shards=workflow.split('  full-shards:')[1].split('\n  test:')[0];
 const script=shards.split('        run: |\n')[1].split('      - uses:')[0]
  .split('\n').map(line=>line.replace(/^          /,'')).join('\n');
 assert.match(shards,/if: always\(\) &&/);
 for(const prepare of ['success','failure','skipped','cancelled',''])
  for(const full of ['true','false','']) {
   const result=spawnSync('bash',['-e','-c',script],{env:{...process.env,PREPARE_RESULT:prepare,FULL:full}});
   assert.equal(result.status===0,prepare==='success'&&full==='true');
  }
 assert.ok(shards.indexOf('Refuse unvalidated')<shards.indexOf('actions/checkout'));
});
