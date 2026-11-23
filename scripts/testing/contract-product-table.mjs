/** Real editor/Word/print checks, synthetic data only; all network stays on localhost. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const manifest=JSON.parse(await readFile(new URL('../../src/modules/sales/domain/contract-template-manifest.json',import.meta.url),'utf8'));
const dir=process.env.ARTIFACT_DIR||'/tmp/contract-product-table';await mkdir(dir,{recursive:true});
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://localhost').pathname;
 res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript;charset=utf-8':path.endsWith('.css')?'text/css':path.endsWith('.docx')?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'text/html;charset=utf-8');
 res.end(path==='/'?'<!doctype html><html><body></body></html>':await readFile(root+path));
}catch{res.writeHead(404).end();}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const results=[];
try{for(const brand of ['BN','VG'])for(const width of [390,1280]){
 const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 try{
  await page.goto(origin);for(const f of ['style.css','typography.css','mobile-actions.css','mobile-design.css'])await page.addStyleTag({url:origin+'/'+f});
  await page.evaluate(async({brand,base})=>{
   const {openContractDocs}=await import('/contract-ui.js');
   const master={brand,revision:2,sourceHash:base.sourceHash,edits:[{index:0,hash:'0'.repeat(64),text:'Điều khoản mẫu chung đã lưu'}],locked:base.paragraphs.filter(p=>p.locked).map(p=>p.index)};
   const detail={order:{id:'local-order',quoteType:brand==='VG'?'VIGIFTS':'B2B',quoteNo:'LOCAL-BG',customerName:'Khách kiểm thử',contact:'Người thử',address:'Kho thử',subtotal:8000,tax:640,total:8640},
    contract:{id:'local-contract',contractNo:'LOCAL/2026',legalEntity:brand,canEdit:true,canEditFinancial:true,canManageTemplates:true,revision:1,signedDate:'2026-11-23',depositRate:30,paymentDays:5,data:{templateSnapshot:structuredClone(master)}},
    lines:[{sku:'LY',name:'Ly kiểm thử',unit:'Cái',qty:2,unitPrice:1000,amount:2000,taxRate:8},{sku:'TRA',name:'Bộ trà kiểm thử',unit:'Bộ',qty:3,unitPrice:2000,amount:6000,taxRate:8}]};
   globalThis.fixture={detail,master};globalThis.notices=[];globalThis.saves=[];
   const api=async(path,method,body)=>{if(path.startsWith('/contract-templates/')){if(method==='PUT'){saves.push(structuredClone(body));Object.assign(master,body,{revision:master.revision+1});}return structuredClone(master);}if(method==='PUT'){saves.push(structuredClone(body));return {ok:true};}return {data:{rows:[]}};};
   globalThis.openFixture=()=>openContractDocs({detail,api,toast:m=>notices.push(m)});await openFixture();
  },{brand,base:manifest[brand]});
  const ready=()=>page.waitForFunction(()=>document.querySelector('.contract-docs')?.getAttribute('aria-busy')==='false'&&document.querySelector('.cd-frame')?.contentDocument.querySelector('article'));
  await ready();
  const checkPreview=async(units=true)=>page.locator('.cd-frame').evaluate((frame,units)=>{
   const doc=frame.contentDocument,table=[...doc.querySelectorAll('table')].find(t=>/STT/.test(t.innerText)&&/Thành\s*[Tt]iền/.test(t.innerText));
   if(!table)throw Error('Bảng sản phẩm không hiển thị');const header=table.rows[0];
   if([...header.cells].some(c=>!['rgba(0, 0, 0, 0)','rgb(255, 255, 255)'].includes(doc.defaultView.getComputedStyle(c).backgroundColor)))throw Error('Tiêu đề vẫn có nền');
   if(/Số\s*lượng\s*\(\s*Bộ\s*\)/i.test(header.innerText))throw Error('Tiêu đề cố định Bộ');
   if(units){const texts=[...table.rows].map(r=>r.innerText);if(!texts.some(t=>t.includes('2 Cái'))||!texts.some(t=>t.includes('3 Bộ')))throw Error('Sai/mất ĐVT theo dòng');}
   return table.outerHTML;
  },units);
  await checkPreview();assert.match(await page.frameLocator('.cd-frame').locator('body').innerText(),/Điều khoản mẫu chung đã lưu/);
  // Header format must also hold when the editor displays the raw, hash-bound shared template.
  await page.locator('[data-template]').click();await ready();await checkPreview(false);
  await page.locator('[data-template]').click();await ready();
  for(const type of ['HDKT','BBNT']){
   if(type==='BBNT'){await page.locator('[data-doc="BBNT"]').click();await ready();}
   await checkPreview();
   const [download]=await Promise.all([page.waitForEvent('download'),page.locator('[data-one]').click()]);const file=dir+'/'+brand+'-'+type+'-'+width+'.docx';await download.saveAs(file);
   const downloaded=[...await readFile(file)];
   assert.equal(await page.evaluate(bytes=>{
    const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',files=fflate.unzipSync(new Uint8Array(bytes)),doc=new DOMParser().parseFromString(fflate.strFromU8(files['word/document.xml']),'application/xml');
    if(doc.querySelector('parsererror'))return false;const text=n=>[...n.getElementsByTagNameNS(W,'t')].map(t=>t.textContent).join('');
    const table=[...doc.getElementsByTagNameNS(W,'tbl')].find(t=>/STT/.test(text(t))&&/Thành\s*[Tt]iền/.test(text(t))),header=table.getElementsByTagNameNS(W,'tr')[0];
    return [...header.getElementsByTagNameNS(W,'shd')].every(n=>['FFFFFF','auto'].includes(n.getAttributeNS(W,'fill')))&&text(table).includes('2 Cái')&&text(table).includes('3 Bộ')&&text(table).includes('8.640');
   },downloaded),true,'Word dùng cùng định dạng/ĐVT');
   // Test the actual print action, then print the iframe into a standalone Chromium PDF.
   await page.locator('.cd-frame').evaluate(f=>{f.contentWindow.print=()=>{f.dataset.printed='yes';};});await page.locator('[data-print]').click();assert.equal(await page.locator('.cd-frame').getAttribute('data-printed'),'yes');
   const printPage=await context.newPage();const html=await page.locator('.cd-frame').evaluate(f=>f.contentDocument.documentElement.outerHTML);await printPage.setContent(html);await printPage.emulateMedia({media:'print'});
   const pdfBytes=await printPage.pdf({path:dir+'/'+brand+'-'+type+'-'+width+'.pdf',format:'A4',printBackground:true});await printPage.close();
   const loading=getDocument({data:new Uint8Array(pdfBytes),useSystemFonts:true}),pdf=await loading.promise;let pdfText='';
   try{for(let i=1;i<=pdf.numPages;i++)pdfText+=(await(await pdf.getPage(i)).getTextContent()).items.map(x=>x.str||'').join(' ')+' ';}finally{await loading.destroy();}
   assert.match(pdfText,/2\s+Cái/);assert.match(pdfText,/3\s+Bộ/);assert.match(pdfText,/8\.640/);
   await page.frameLocator('.cd-frame').locator('table').filter({hasText:'Ly kiểm thử'}).first().scrollIntoViewIfNeeded();await page.screenshot({path:dir+'/'+brand+'-'+type+'-'+width+'.png'});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>notices),[]);assert.deepEqual(await page.evaluate(()=>saves),[],'chỉ xem/tải không ghi dữ liệu');
  results.push({brand,width,passed:true,sharedSnapshot:true,rawTemplate:true,word:true,pdf:true,pageerrors:errors});
 }catch(e){results.push({brand,width,passed:false,error:e.message,pageerrors:errors});}finally{await context.close();}
}
 assert.equal(browser.contexts().length,0);await writeFile(dir+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));assert.ok(results.every(r=>r.passed));
}finally{await browser.close();await new Promise(r=>server.close(r));}
