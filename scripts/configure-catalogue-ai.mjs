import {existsSync,readFileSync,writeFileSync} from 'node:fs';
// Download from Pages first: preserve its existing compatibility, variables and bindings.
const toml='wrangler.toml';
if(existsSync(toml)){
 let text=readFileSync(toml,'utf8');
 if(/^\[ai\]/m.test(text)){
  const block=text.match(/^\[ai\]([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1]||'';
  if(!/binding\s*=\s*["']AI["']/.test(block))throw Error('An existing AI binding has a different name; preserve it and review the catalogue configuration.');
 }else text+='\n[ai]\nbinding = "AI"\n';
 if(!/^pages_build_output_dir\s*=/m.test(text))text='pages_build_output_dir = "trial-ui"\n'+text;
 writeFileSync(toml,text);
 console.log('Catalogue Workers AI binding configured; existing Pages settings retained.');
}else if(existsSync('wrangler.json')){
 const value=JSON.parse(readFileSync('wrangler.json','utf8'));
 if(value.ai?.binding&&value.ai.binding!=='AI')throw Error('Existing AI binding name differs.');
 value.ai={...(value.ai||{}),binding:'AI'};value.pages_build_output_dir='trial-ui';writeFileSync('wrangler.json',JSON.stringify(value,null,2));
 console.log('Catalogue Workers AI binding configured in downloaded JSON settings.');
}else throw Error('Download the existing Pages configuration before configuring catalogue AI.');
