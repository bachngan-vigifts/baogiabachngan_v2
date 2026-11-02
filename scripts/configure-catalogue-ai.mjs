import {existsSync,readFileSync,writeFileSync} from 'node:fs';
// Download the current Pages config first; preserve all unrelated settings.
const tables=['ai','env.production.ai','env.preview.ai'];
if(existsSync('wrangler.toml')){
 let text=readFileSync('wrangler.toml','utf8');
 for(const table of tables){const escaped=table.replaceAll('.','\\.');const start=new RegExp('^\\['+escaped+'\\]\\s*$','m');const match=start.exec(text);if(match){const after=text.slice(match.index+match[0].length);const block=after.split(/^\[/m)[0];if(!/binding\s*=\s*["']AI["']/.test(block))throw Error('Existing '+table+' binding uses another name; review without overwriting it.');}else text+='\n['+table+']\nbinding = "AI"\n';}
 if(!/^pages_build_output_dir\s*=/m.test(text))text='pages_build_output_dir = "trial-ui"\n'+text;
 writeFileSync('wrangler.toml',text);
}else if(existsSync('wrangler.json')){
 const value=JSON.parse(readFileSync('wrangler.json','utf8'));value.env||={};
 for(const target of [value,value.env.production||=( {} ),value.env.preview||=( {} )]){if(target.ai?.binding&&target.ai.binding!=='AI')throw Error('Existing AI binding name differs.');target.ai={...(target.ai||{}),binding:'AI'};}
 value.pages_build_output_dir='trial-ui';writeFileSync('wrangler.json',JSON.stringify(value,null,2));
}else throw Error('Download the current Pages configuration before configuring catalogue AI.');
console.log('Catalogue AI binding configured for production and preview; existing settings retained.');
