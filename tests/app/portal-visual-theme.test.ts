import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const root=new URL('../../trial-ui/',import.meta.url);
test('account and external portals share the existing screen-only theme without a competing CRM theme',()=>{
 for(const name of ['register.html','reset-password.html','customer.html','supplier.html']){
  const html=readFileSync(new URL(name,root),'utf8');
  assert.match(html,/<html\b[^>]*class="[^"]*\b(?:app-shell|visual-surface)\b/,name);
  assert.match(html,/<link rel="stylesheet" href="visual-theme\.css" media="screen">/,name);
  assert.doesNotMatch(html,/kiot-theme\.css/,name);
  if(name!=='supplier.html')assert.doesNotMatch(html,/<html\b[^>]*class="[^"]*\bapp-shell\b/,name+' must keep native scrolling');
 }
 assert.equal(existsSync(new URL('kiot-theme.css',root)),false,'do not ship a second global theme');
 const index=readFileSync(new URL('index.html',root),'utf8');assert.doesNotMatch(index,/kiot-theme\.css/);
 assert.match(readFileSync(new URL('visual-theme.css',root),'utf8'),/@media screen/);
});
