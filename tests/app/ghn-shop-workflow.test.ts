import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const yaml=readFileSync('.github/workflows/probe-ghn-ml-shops.yml','utf8');
const script=yaml.slice(yaml.indexOf('          response=$(curl')).split('\n').map(line=>line.slice(10)).join('\n');
const secret='test-token-never-log';
const run=(response:unknown)=>spawnSync('bash',['-e','-c','curl(){ printf "%s" "$MOCK_RESPONSE"; }\n'+script],{encoding:'utf8',env:{...process.env,GHN_ML_API_TOKEN:secret,MOCK_RESPONSE:JSON.stringify(response)}});
test('GHN probe lists actual _id and compatible IDs, without dumping token or response metadata',()=>{
 const result=run({code:200,data:{shops:[{_id:123,name:'Minh Long',status:1},{shop_id:456,name:'Kho khác',status:1},{id:'789',name:'Legacy',status:0}],private_token:secret}});
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/"shop_id":123/);assert.match(result.stdout,/"shop_id":456/);assert.match(result.stdout,/"shop_id":"789"/);
 assert.ok(!result.stdout.includes(secret));assert.ok(!result.stderr.includes(secret));assert.ok(!result.stdout.includes('private_token'));
});
test('GHN probe rejects unsuccessful or malformed shop responses instead of choosing an arbitrary ID',()=>{
 for(const body of [{code:401,message:'denied'},{code:200,data:{shops:[{name:'Missing ID'}]}},{code:200,data:{shops:[{_id:'not-a-number',name:'Bad ID'}]}}])assert.notEqual(run(body).status,0);
});
