/** One-file offline design review. Synthetic workspace data; login has preview-only handlers. */
import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=process.env.SUPPLIER_REVIEW_DIR||'/workspace/output/supplier-workspace-review';
const read=p=>readFile(root+p,'utf8');
const supplier=await read('trial-ui/supplier.html'),section=supplier.match(/<section id="supplier-auth"[\s\S]*?<\/section>/)?.[0].replace(' hidden>','>');if(!section)throw Error('Missing supplier auth form');
let loginCss='';for(const file of ['style.css','typography.css','mobile-actions.css','supplier-portal.css'])loginCss+=await read('trial-ui/'+file);
loginCss=loginCss.replace(/url\([^)]*\)/g,'none').replace(/@import[^;]*;/g,'');
const brand=await readFile(root+'trial-ui/brand-strip.jpeg');
const loginHtml=`<!doctype html><html lang="vi" class="app-shell"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${loginCss}</style></head><body class="portal">${section.replace('src="brand-strip.jpeg"','src="data:image/jpeg;base64,'+brand.toString('base64')+'"')}<script>document.getElementById('supplier-show-password').onchange=e=>document.getElementById('login-password').type=e.target.checked?'text':'password';document.getElementById('login-form').onsubmit=e=>{e.preventDefault();document.getElementById('supplier-auth-error').textContent='Bản duyệt ngoại tuyến: không gửi tài khoản hoặc đăng nhập CRM.';};document.getElementById('supplier-forgot-password').onclick=()=>document.getElementById('supplier-auth-error').textContent='Bản duyệt ngoại tuyến: không gửi email đặt lại mật khẩu.';</script></body></html>`;
const entry='const PORTABLE_LOGIN='+JSON.stringify(loginHtml)+';\n'+(await read('design/supplier-workspace/workspace.js')).replace('src="/crm/supplier.html"','srcdoc="${esc(PORTABLE_LOGIN)}"');
const bundle=await build({stdin:{contents:entry,resolveDir:root+'design/supplier-workspace',sourcefile:'portable-review.js'},bundle:true,write:false,format:'iife',target:'es2020',minify:true});
const script=bundle.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
await writeFile(out+'/ban-tuong-tac.html',`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Duyệt cổng NCC — Ngoại tuyến</title><style>${await read('design/supplier-workspace/workspace.css')}</style></head><body><div id="app"></div><div id="toast" role="status" aria-live="polite" hidden></div><script>${script}</script></body></html>`);
console.log('Portable UI review: '+out+'/ban-tuong-tac.html');
if(process.env.PLAYWRIGHT_MODULE){
 const assert=(await import('node:assert/strict')).default,{chromium}=await import(process.env.PLAYWRIGHT_MODULE),{PAGES}=await import('../../design/supplier-workspace/pages.js');
 const {createServer}=await import('node:http');
 const server=createServer(async(_req,res)=>res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(await readFile(out+'/ban-tuong-tac.html'))).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),errors=[],network=[];
 try{for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
  await context.route('**/*',r=>{if(!r.request().url().startsWith(origin+'/')&&!r.request().url().startsWith('data:')){network.push(r.request().url());return r.abort();}return r.continue();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  for(const [key,def] of Object.entries(PAGES)){await page.goto(origin+'/#'+key);await page.locator('h1').filter({hasText:def.title}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);}
  await page.goto(origin+'/#login');const frame=page.frameLocator('iframe');await frame.locator('#login-form').waitFor();await frame.locator('#supplier-show-password').check();assert.equal(await frame.locator('#login-password').getAttribute('type'),'text');await frame.locator('#login-form').evaluate(f=>f.requestSubmit());assert.ok((await frame.locator('#supplier-auth-error').textContent()).includes('không gửi'));await context.close();
 }assert.deepEqual(errors,[]);assert.deepEqual(network,[]);await writeFile(out+'/portable-tests.json',JSON.stringify({pages:20,widths:[390,1440],singleHtmlViaLocalhost:true,offlineLogin:true,errors,network},null,2));console.log('Portable: 20 page renders, offline login verified, no external network or JS error');}finally{await browser.close();server.close();}
}
