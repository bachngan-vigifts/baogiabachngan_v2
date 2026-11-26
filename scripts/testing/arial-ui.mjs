/** Verify the shipped page styles without signing in or calling business APIs. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=new URL('../../trial-ui/',import.meta.url),out='/tmp/arial-ui';await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname.slice(1);let data=await readFile(new URL(path,root));if(path.endsWith('.html'))data=Buffer.from(data.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));res.setHeader('content-type',path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html');res.end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{for(const width of [390,1417])for(const file of ['index.html','login.html','register.html','reset-password.html','customer.html','supplier.html','catalogue/index.html','breathing.html']){
 const page=await browser.newPage({viewport:{width,height:1017}});await page.route('**/*',r=>r.request().url().startsWith(origin+'/')&&r.request().method()==='GET'?r.continue():r.abort());await page.goto(origin+'/'+file);
 // Load the POS screen stylesheet late, like runtime navigation does.
 if(file==='index.html')for(const css of ['pos.css','pos-reference.css','pos-mobile.css'])await page.addStyleTag({url:origin+'/'+css});
 await page.evaluate(()=>{const box=document.createElement('section');box.id='font-probe';box.innerHTML='<h1>Tiêu đề · Bách Ngân</h1><form><label>Bộ lọc <select><option>Tất cả</option></select></label><input placeholder="Tìm hàng" value="Minh Long"><textarea>Tiếng Việt</textarea><button class="btn primary">Xác nhận</button><strong>Thành tiền</strong><b>Mã hàng</b><em>Ghi chú</em><span style="font:700 16px monospace">Giá</span></form>';document.body.append(box);const style=document.createElement('style');style.textContent='#font-probe button{font-family:serif!important;font-weight:900!important}';document.head.append(style);});
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('#font-probe button')).fontFamily.startsWith('Arial'));
 const bad=await page.evaluate(()=>[...document.body.querySelectorAll('*')].filter(n=>!['SCRIPT','STYLE','SVG','PATH'].includes(n.tagName)&&n.namespaceURI==='http://www.w3.org/1999/xhtml').filter(n=>{const s=getComputedStyle(n);return !s.fontFamily.startsWith('Arial')||s.fontWeight!=='400'||s.fontStyle!=='normal';}).map(n=>({tag:n.tagName,cls:n.className})));assert.deepEqual(bad,[],file+' '+width);
 assert.equal(await page.locator('#font-probe input').inputValue(),'Minh Long');
 await page.screenshot({path:out+'/'+file.replaceAll('/','-')+'-'+width+'.png'});
 await page.emulateMedia({media:'print'});assert.equal(await page.locator('#font-probe button').evaluate(n=>getComputedStyle(n).fontWeight),'900','screen override must not alter print');
 results.push({file,width,arialRegular:true,printUnchanged:true});await page.close();
}console.log(JSON.stringify(results,null,2));}finally{await browser.close();await new Promise(r=>server.close(r));}
