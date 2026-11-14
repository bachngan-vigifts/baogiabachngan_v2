import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-ignore Maintenance script, pure helpers only.
import {shouldReplace,compress,MIN_BYTES} from '../../scripts/maintenance/recompress-product-images.mjs';

test('images are replaced only for a real saving, never for small files',()=>{
 assert.equal(shouldReplace(400_000,100_000),true);assert.equal(shouldReplace(400_000,340_000),true);
 assert.equal(shouldReplace(400_000,341_000),false,'tiết kiệm dưới 15% thì giữ nguyên');assert.equal(shouldReplace(400_000,400_000),false);assert.equal(shouldReplace(400_000,500_000),false);
 assert.equal(shouldReplace(MIN_BYTES-1,1000),false);assert.equal(shouldReplace(400_000,0),false);
});

test('unsupported or tiny files are left alone without touching the image library',async()=>{
 const never=()=>{throw new Error('must not decode');};
 assert.equal(await compress(never,Buffer.alloc(100_000),'image/gif'),null);assert.equal(await compress(never,Buffer.alloc(100_000),'image/webp'),null);assert.equal(await compress(never,Buffer.alloc(1000),'image/jpeg'),null);
});

test('workflow defaults to a dry run and the script never logs the service key',()=>{
 const workflow=readFileSync(new URL('../../.github/workflows/recompress-product-images.yml',import.meta.url),'utf8'),script=readFileSync(new URL('../../scripts/maintenance/recompress-product-images.mjs',import.meta.url),'utf8');
 assert.match(workflow,/default: dry-run/);assert.doesNotMatch(workflow,/\bpush:|pull_request:|schedule:/);assert.match(workflow,/workflow_dispatch/);
 assert.match(script,/process\.env\.MODE==='apply'/);assert.match(script,/::add-mask::/);assert.doesNotMatch(script,/console\.(log|error)\([^)]*serviceKey(?!\))/);
});
