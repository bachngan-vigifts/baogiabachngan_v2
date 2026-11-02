import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
let value;
if(existsSync('wrangler.toml')){
 // A real TOML parser handles inline `ai = {}` and [ai] without duplicate keys.
 value=JSON.parse(execFileSync(process.env.CATALOGUE_PYTHON||'python3',['-c','import tomllib,json,sys; print(json.dumps(tomllib.load(open(sys.argv[1],"rb"))))','wrangler.toml'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
}else if(existsSync('wrangler.json'))value=JSON.parse(readFileSync('wrangler.json','utf8'));
else throw Error('Download the current Pages configuration before configuring catalogue AI.');
value.env||={};
for(const target of [value,value.env.production||={},value.env.preview||={}]){
 if(target.ai?.binding&&target.ai.binding!=='AI')throw Error('Existing AI binding name differs; preserve it for review.');
 target.ai={...(target.ai||{}),binding:'AI'};
}
value.pages_build_output_dir='trial-ui';
writeFileSync('wrangler.json',JSON.stringify(value,null,2)+'\n');
if(existsSync('wrangler.toml'))renameSync('wrangler.toml','wrangler.downloaded.'+Date.now()+'.toml');
console.log('Catalogue AI configured for production and preview; downloaded Pages settings retained.');
