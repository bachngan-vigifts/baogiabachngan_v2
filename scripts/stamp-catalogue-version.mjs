import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
const root=new URL('../trial-ui/catalogue/',import.meta.url),version=process.argv[2];
if(!/^[\w.-]{1,40}$/.test(version||''))throw Error('Invalid catalogue release version.');
for(const name of readdirSync(root)){
 if(!/\.(?:js|html|css)$/.test(name))continue;
 const path=new URL(name,root),source=readFileSync(path,'utf8');
 const result=source.replace(/((?:\bfrom\s*|\bimport\s*|\b(?:src|href)=)["'])(\.\.?\/[^"'?]+\.(?:js|css))(["'])/g,(_,start,file,end)=>start+file+'?v='+version+end);
 if(result!==source)writeFileSync(path,result);
}
console.log('Stamped catalogue release',version);
