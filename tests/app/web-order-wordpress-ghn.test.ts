import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,'');
const source=readFileSync(`${root}/handoff/lock-ghn-wordpress/install_web_order_action_bridge.js`,'utf8');
const literal=source.match(/const code = (`[\s\S]*?`);/)?.[1];
assert.ok(literal,'PHP bridge template exists');
const variables={
  tokenHash:createHash('sha256').update('fake-bridge-token-32-characters-long').digest('hex'),
  ghnService:readFileSync(`${root}/handoff/lock-ghn-wordpress/ghn-service.php`,'utf8').replace(/^<\?php\s*/,''),
  ghnProvider:readFileSync(`${root}/handoff/lock-ghn-wordpress/ghn-provider.php`,'utf8').replace(/^<\?php\s*/,''),
};
for(const expression of literal.matchAll(/\$\{([^}]+)\}/g))assert.ok(Object.hasOwn(variables,expression[1]!), 'only known template variables; never execute installer');
const bridge=runInNewContext(literal,variables,{timeout:1000}) as string;
const scenarios=[
 'handler-missing','config-missing','success','existing','found','address-invalid','selected-address','partial-address',
 'lookup-unavailable','lookup-ambiguous','lookup-permission','lookup-wrong-client','lookup-wrong-shop',
 'ghn-rejected','ghn-address-rejected','ghn-empty-message','empty-response','malformed-response','timeout-found','timeout-late',
 'persist-throw','persist-drop','persist-unreadable','post-status-fail','intent-fail','intent-drop','order-changed','concurrent','legacy-71','legacy-125',
 'relation-mismatch','invalid-metadata','lock-lost','lock-busy',
 'cancel-success','cancel-rejected','cancel-pending','cancel-concurrent','cancel-stale-code',
];
for(const scenario of scenarios)test(`WordPress GHN mock: ${scenario}`,()=>{
  const image=process.env.GHN_TEST_PHP_DOCKER_IMAGE;
  const args=image?['--host=unix:///var/run/docker.sock','run','--rm','--network=none','-i','--mount',`type=bind,src=${root},dst=${root},readonly`,'--workdir',root,image,'php','tests/wordpress/lock-ghn-fixture.php']:['tests/wordpress/lock-ghn-fixture.php'];
  const result=spawnSync(image?'docker':'php',args,{
    cwd:root,encoding:'utf8',timeout:30000,maxBuffer:1024*1024,
    input:JSON.stringify({scenario,bridge,bridgeToken:'fake-bridge-token-32-characters-long'}),
  });
  assert.ifError(result.error);
  assert.equal(result.status,0,result.stderr);
  assert.doesNotMatch(result.stderr,/fake-ghn-private-token/,'diagnostics exclude secrets');
  assert.doesNotMatch(result.stderr,/PHP (Warning|Fatal error|Parse error|Deprecated)/,'backend errors do not emit PHP exceptions or warnings');
  const data=JSON.parse(result.stdout);
  assert.equal(data.ok,true);assert.ok(data.checks>4);assert.ok(data.creates<=1);
});
