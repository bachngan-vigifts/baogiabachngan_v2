import {chromium} from '/tmp/ai-seo/node_modules/playwright/index.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('seo-evidence',{recursive:true});
const report=[];
const browser=await chromium.launch({headless:true});
for(const host of ['locknlockonline.com','minhlongonline.com']){
 const record={host,fetches:[],pages:[]};
 for(const path of ['/robots.txt','/sitemap_index.xml','/wp-sitemap.xml']){
  try{const r=await fetch('https://'+host+path,{signal:AbortSignal.timeout(30000)});const t=await r.text();record.fetches.push({path,status:r.status,url:r.url,type:r.headers.get('content-type'),body:t.slice(0,16000)});}
  catch(e){record.fetches.push({path,error:e.message});}
 }
 const ctx=await browser.newContext();
 const page=await ctx.newPage();
 await page.route('**/*',route=>{
  const r=route.request(),u=new URL(r.url());
  if(!['GET','HEAD'].includes(r.method())||u.searchParams.has('add-to-cart')||u.searchParams.has('lnl_buy'))return route.abort();
  return route.continue();
 });
 const urls=['https://'+host+'/'];
 for(let i=0;i<urls.length&&i<4;i++){
  const url=urls[i];
  try{
   const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
   await page.waitForTimeout(3500);
   const data=await page.evaluate(()=>{
    const text=document.body.innerText;
    const schemas=Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(s=>{try{return JSON.parse(s.textContent)}catch{return {parseError:true}}});
    const links=Array.from(document.querySelectorAll('a[href]')).map(a=>({url:a.href,text:a.innerText.trim()}));
    return {title:document.title,canonical:document.querySelector('link[rel="canonical"]')?.href,robots:Array.from(document.querySelectorAll('meta[name="robots"],meta[name="googlebot"]')).map(m=>m.content),h1:Array.from(document.querySelectorAll('h1')).map(n=>n.innerText),schemas,text:text.slice(0,65000),links};
   });
   record.pages.push({url,status:response?.status(),xRobots:response?.headers()['x-robots-tag'],...data});
   if(i===0){
    const same=data.links.filter(l=>l.url.startsWith('https://'+host+'/'));
    for(const re of [/gioi-thieu/i,/san-pham\//i,/danh-muc/i]){
     const a=same.find(l=>re.test(l.url)&&!urls.includes(l.url));if(a)urls.push(a.url);
    }
   }
   await page.screenshot({path:'seo-evidence/'+host+'-'+i+'.png',fullPage:false});
  }catch(e){record.pages.push({url,error:e.message});}
 }
 await ctx.close();report.push(record);
}
await browser.close();
await writeFile('seo-evidence/audit.json',JSON.stringify(report,null,2));
for(const r of report){
 console.log('SEO_HOST',r.host);
 for(const f of r.fetches)console.log('SEO_ENDPOINT',JSON.stringify({...f,body:f.body?.slice(0,9000)}));
 for(const p of r.pages){
  const schemas=p.schemas||[];
  const addressLines=(p.text||'').split('\n').filter(t=>/Ngô|102B|OneShield|security check|BÁCH NGÂN|VIGIFTS/.test(t));
  console.log('SEO_PAGE',JSON.stringify({url:p.url,status:p.status,error:p.error,title:p.title,canonical:p.canonical,robots:p.robots,xRobots:p.xRobots,h1:p.h1,addressLines,schemas}));
 }
}
