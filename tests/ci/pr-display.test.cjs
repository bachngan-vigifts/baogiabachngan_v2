'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {spawnSync}=require('node:child_process');
const workflow=readFileSync(new URL('../../.github/workflows/ci.yml','file://'+__filename),'utf8');
const aggregate=workflow.split('      - name: Require every expected check to pass')[1].split('        run: |\n')[1]
 .split('\n').map(line=>line.replace(/^          /,'')).join('\n');
const shard=workflow.split('  full-shards:')[1].split('\n  test:')[0].split('        run: |\n')[1].split('      - uses:')[0]
 .split('\n').map(line=>line.replace(/^          /,'')).join('\n');
function run(script,env) {
 return spawnSync('bash',['-e','-c',script],{encoding:'utf8',env:{...process.env,GITHUB_STEP_SUMMARY:'/dev/null',...env}});
}
test('draft summary reports smoke success only after successful prepare',()=>{
 for(const prepare of ['success','failure','cancelled','skipped','']) {
  const r=run(aggregate,{IS_PR:'true',FULL_REQUIRED:'false',PREPARE_RESULT:prepare,SHARD_RESULT:'failure'});
  assert.equal(r.status,1);
  if(prepare==='success') assert.match(r.stdout,/NHÁP.*TypeScript và smoke đạt/);
  else {assert.match(r.stdout,/prepare lỗi/);assert.doesNotMatch(r.stdout,/TypeScript và smoke đạt/);}
 }
});
test('shard messages distinguish draft, preparation failure and unknown mode',()=>{
 for(const [prepare,full,draft,expected] of [
  ['success','false','true',/NHÁP — CHƯA CHẠY FULL SUITE/],
  ['failure','false','true',/bước chuẩn bị lỗi/],
  ['success','','false',/LỖI CHẾ ĐỘ CI/],
  ['success','false','false',/LỖI CHẾ ĐỘ CI/]
 ]) {
  const r=run(shard,{PREPARE_RESULT:prepare,FULL:full,IS_DRAFT:draft});
  assert.equal(r.status,1);assert.match(r.stdout,expected);
 }
});
test('ready shard errors cannot display draft-only explanation',()=>{
 for(const state of ['failure','cancelled','skipped','']) {
  const r=run(aggregate,{IS_PR:'true',FULL_REQUIRED:'true',PREPARE_RESULT:'success',SHARD_RESULT:state});
  assert.equal(r.status,1);assert.match(r.stdout,/CHƯA ĐẠT FULL SUITE/);assert.doesNotMatch(r.stdout,/NHÁP/);
 }
});
const scripts=[...workflow.matchAll(/          script: \|\n([\s\S]*?)(?=      - |  full-shards:)/g)]
 .map(match=>match[1].split('\n').map(line=>line.replace(/^            /,'')).join('\n'));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
for(const [i,script] of scripts.entries()) {
 test('gate summary '+i+' preserves failures and distinguishes stale/API/race',async()=>{
  for(const message of ['Update branch: stale','HTTP 403','PR head/base/state changed during CI.']) {
   const original=Error(message), headings=[];
   const summary={addHeading(text){headings.push(text);return this},addRaw(){return this},async write(){}};
   const fn=new AsyncFunction('require','github','context','core',script);
   await assert.rejects(fn(()=>async()=>{throw original},{},{},{summary}),error=>error===original);
   assert.match(headings[0],message.startsWith('Update branch:')?/CHƯA CẬP NHẬT NHÁNH/:/LỖI XÁC MINH/);
  }
 });
 test('gate summary '+i+' does not convert successful freshness into full pass',async()=>{
  const fn=new AsyncFunction('require','github','context','core',script);
  await fn(()=>async()=>{}, {}, {}, {summary:{addHeading(){throw Error('unexpected summary')}}});
 });
}
test('display labels leave required names and manual isolation intact',()=>{
 assert.equal(scripts.length,3);
 assert.match(workflow,/run-name: >-\n/);
 assert.match(workflow,/NHÁP — chưa kiểm thử đầy đủ/);
 assert.match(workflow,/CHẠY TAY — smoke, không thay check PR/);
 assert.match(workflow,/name: \$\{\{ github.event_name == 'pull_request' && 'test shard' \|\| 'manual shard' \}\} \$\{\{ matrix.shard \}\}\/4/);
 assert.match(workflow,/name: \$\{\{ github.event_name == 'pull_request' && 'test' \|\| 'manual validation' \}\}/);
});
