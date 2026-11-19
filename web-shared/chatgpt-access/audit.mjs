import {mkdir,writeFile} from 'node:fs/promises';
function groups(txt){
 const out=[];let agents=[],rules=[],started=false;
 for(const line of txt.split(/\r?\n/)){
  const m=line.split('#')[0].trim().match(/^([^:]+):\s*(.*)$/);if(!m)continue;
  const field=m[1].toLowerCase(),value=m[2].trim();
  if(field==='user-agent'){
   if(started){out.push({agents,rules});agents=[];rules=[];started=false;}
   agents.push(value.toLowerCase());
  }else if(['allow','disallow'].includes(field)&&agents.length){
   rules.push({allow:field==='allow',path:value});started=true;
  }
 }
 if(agents.length)out.push({agents,rules});return out;
}
function allowed(txt,agent,path){
 const gs=groups(txt),specific=gs.filter(g=>g.agents.includes(agent.toLowerCase()));
 const chosen=specific.length?specific:gs.filter(g=>g.agents.includes('*'));
 let best=-1,result=true;
 for(const r of chosen.flatMap(g=>g.rules)){
  if(!r.path)continue;
  const end=r.path.endsWith('$'),raw=end?r.path.slice(0,-1):r.path;
  const pattern=raw.split('*').map(s=>s.replace(/[.+?^$()|[\]\\{}]/g,'\\$&')).join('.*');
  if(!new RegExp('^'+pattern+(end?'$':'')).test(path))continue;
  const length=Buffer.byteLength(raw.replaceAll('*',''));
  if(length>best||(length===best&&r.allow)){best=length;result=r.allow;}
 }
 return result;
}

await mkdir('chatgpt-access-evidence',{recursive:true});
const results=[];
for(const host of ['locknlockonline.com','minhlongonline.com']){
 const response=await fetch('https://'+host+'/robots.txt',{signal:AbortSignal.timeout(45000)});
 if(response.status!==200)throw Error('Robots HTTP '+response.status+' '+host);
 const text=await response.text();
 await writeFile('chatgpt-access-evidence/'+host+'-robots.txt',text);
 const publicPaths=['/','/san-pham/','/danh-muc/','/sitemap_index.xml'];
 const privatePaths=['/wp-admin/','/cart/','/checkout/','/my-account/','/gio-hang/','/thanh-toan/','/tai-khoan/','/?add-to-cart=1','/wp-content/uploads/wc-logs/a.log'];
 const bots={};
 for(const agent of ['OAI-SearchBot','ChatGPT-User','GPTBot','Google-Extended']){
  bots[agent]={publicPaths:Object.fromEntries(publicPaths.map(p=>[p,allowed(text,agent,p)])),privatePaths:Object.fromEntries(privatePaths.map(p=>[p,allowed(text,agent,p)]))};
 }
 const pages=[];
 for(const path of ['/','/sitemap_index.xml']){
  try{const r=await fetch('https://'+host+path,{signal:AbortSignal.timeout(45000)});const body=await r.text();pages.push({path,status:r.status,challenge:/Please complete one more step|Just a moment|Verify you are human/i.test(body),xRobots:r.headers.get('x-robots-tag'),hasIndex:body.includes('follow, index'),hasNoindex:/<meta[^>]+content=["'][^"']*noindex/i.test(body)});}catch(e){pages.push({path,error:e.message});}
 }
 const record={host,bots,pages};results.push(record);console.log('CHATGPT_ACCESS_AUDIT',JSON.stringify(record));
}
await writeFile('chatgpt-access-evidence/result.json',JSON.stringify(results,null,2));
console.log('READ_ONLY_AUDIT_COMPLETE');
