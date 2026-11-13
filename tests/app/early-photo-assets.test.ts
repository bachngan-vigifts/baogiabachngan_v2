import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {contentVersions} from '../../scripts/stamp-ui-version.ts';

test('self-hosted OCR engine/worker get content hashes and a vendor update invalidates the loader',()=>{
 const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
 const before=contentVersions(root,'release-before');
 for(const name of ['tesseract.min.js','worker.min.js']){
  const asset='vendor/ocr-6.0.1/'+name,version=before.versions.get(asset);
  assert.match(version||'',/^[a-f0-9]{10}$/);
  assert.ok(before.stamped.get('early-photo-ocr.js')!.includes('./'+asset+'?v='+version));
  // Simulate updated vendor bytes, without touching vendored files/checksums.
  const after=contentVersions(root,'release-after',{bytes:file=>{
   const path=join(root,file);if(!existsSync(path))return null;
   const raw=readFileSync(path);return file===asset?Buffer.concat([raw,Buffer.from('\n// synthetic vendor update')]):raw;
  }});
  assert.notEqual(after.versions.get(asset),version);
  assert.notEqual(after.versions.get('early-photo-ocr.js'),before.versions.get('early-photo-ocr.js'));
 }
});
