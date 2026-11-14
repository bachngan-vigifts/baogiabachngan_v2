/** Checks real DOCX templates, saved edits, preview and downloads locally; no production writes. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://localhost').pathname;
 res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript;charset=utf-8':path.endsWith('.css')?'text/css':'text/html;charset=utf-8');
 res.end(path==='/'?'<!doctype html><html><body><main></main></body></html>':await readFile(root+path));
}catch(e){res.writeHead(404).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const dir='/workspace/scratch/contract-formatting';await mkdir(dir,{recursive:true});
const results=[];
try{for(const brand of ['BN','VG']){
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
 for(const f of ['style.css','typography.css','mobile-design.css'])await page.addStyleTag({url:origin+'/'+f});
 await page.evaluate(async brand=>{
  const {openContractDocs}=await import('/contract-ui.js');
  const detail={order:{id:'o',quoteType:brand==='VG'?'VIGIFTS':'B2B',quoteNo:'BG_TEST',customerName:'Khách kiểm thử',contact:'Trần Văn An',address:'Kho thử',subtotal:300000,tax:24000,total:324000},contract:{id:'k',contractNo:'TEST/2026',legalEntity:brand,canEdit:true,canEditFinancial:true,revision:1,signedDate:'2026-11-14',depositRate:30,paymentDays:15,data:{}},lines:[{sku:'SP1',name:'Sản phẩm minh họa',unit:'Bộ',qty:2,unitPrice:150000,amount:300000,taxRate:8}]};
  const api=async(path,method,body)=>{if(method==='PUT'){await new Promise(r=>setTimeout(r,250));globalThis.savedBody=structuredClone(body);return {ok:true};}return {};};
  globalThis.toasts=[];globalThis.fixture={detail,api,toast:(message,kind)=>toasts.push({message,kind})};await openContractDocs(fixture);
 },brand);
 const ready=()=>page.waitForFunction(()=>!document.querySelector('.contract-docs')?.matches('[aria-busy="true"]')&&document.querySelector('.cd-frame')?.contentDocument.querySelector('[data-word-index]'));
 await ready();const frame=page.frameLocator('.cd-frame'),p=frame.locator('[data-word-index]').filter({hasText:'Sản phẩm minh họa'}).first();
 await p.fill('Sản phẩm minh họa | chữ thử định dạng <nội dung> & ký hiệu');
 const selectText=()=>p.evaluate(p=>{const walker=p.ownerDocument.createTreeWalker(p,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){const start=n.textContent.indexOf('chữ thử');if(start>=0){const r=p.ownerDocument.createRange();r.setStart(n,start);r.setEnd(n,start+7);p.focus();const s=p.ownerDocument.getSelection();s.removeAllRanges();s.addRange(r);return;}}throw Error('text selection missing');});
 await p.click();await page.waitForTimeout(50);if(await page.getByRole('button',{name:'Đậm',exact:true}).getAttribute('aria-pressed')==='true')await page.getByRole('button',{name:'Đậm',exact:true}).click();
 await selectText();await page.getByRole('button',{name:'Đậm',exact:true}).click();await page.getByRole('button',{name:'Nghiêng',exact:true}).click();await page.getByRole('button',{name:'Gạch chân',exact:true}).click();await page.getByRole('button',{name:'Gạch ngang',exact:true}).click();
 await page.getByRole('combobox',{name:'Phông chữ',exact:true}).selectOption('Arial');await page.getByRole('combobox',{name:'Cỡ chữ',exact:true}).selectOption('18');await page.getByRole('combobox',{name:'Màu chữ',exact:true}).selectOption('1D4ED8');
 await page.getByRole('combobox',{name:'Căn lề',exact:true}).selectOption('center');await page.getByRole('combobox',{name:'Giãn dòng',exact:true}).selectOption('1.5');await page.getByRole('combobox',{name:'Thụt lề',exact:true}).selectOption('720');await page.getByRole('combobox',{name:'Danh sách',exact:true}).selectOption('bullet');
 await page.locator('[data-save]').click();assert.match(await page.locator('[data-save]').textContent(),/Đang lưu/);assert.equal(await page.locator('[data-doc="BBNT"]').isDisabled(),true);
 await page.waitForFunction(()=>globalThis.savedBody&&document.querySelector('[data-save]').textContent==='Lưu chỉnh sửa');
 const saved=await page.evaluate(()=>savedBody.details.edits.HDKT.find(e=>e.text.includes('chữ thử')));
 assert.equal(saved.align,'center');assert.equal(saved.list,'bullet');assert.equal(saved.indent,720);assert.equal(saved.lineSpacing,1.5);
 const run=saved.runs.find(r=>r.text.includes('chữ thử'));assert.ok(run,JSON.stringify(saved));assert.equal(run.bold,true);assert.equal(run.italic,true);assert.equal(run.underline,true);assert.equal(run.strike,true);assert.equal(run.fontSize,18);assert.equal(run.fontFamily,'Arial');assert.equal(run.color,'1D4ED8');assert.ok(saved.runs.some(r=>!r.bold),'only selected text is bold');
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('[data-zip]').click()]);const packPath=dir+'/'+brand+'-formatted.zip';await download.saveAs(packPath);
 const inspect=await page.evaluate(async bytes=>{
  const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',files=fflate.unzipSync(new Uint8Array(bytes));const results=[];
  for(const name of ['HDKT.docx','BBNT.docx']){
   const zip=fflate.unzipSync(files[name]),xml=new DOMParser().parseFromString(fflate.strFromU8(zip['word/document.xml']),'application/xml');if(xml.querySelector('parsererror'))throw Error('Invalid DOCX XML');
   const p=[...xml.getElementsByTagNameNS(W,'p')].find(p=>p.textContent.includes('chữ thử'));const r=[...p.getElementsByTagNameNS(W,'r')].find(r=>r.textContent.includes('chữ thử'));
   const value=tag=>r.getElementsByTagNameNS(W,tag)[0]?.getAttributeNS(W,'val');
   const nums=new DOMParser().parseFromString(fflate.strFromU8(zip['word/numbering.xml']),'application/xml'),numId=p.getElementsByTagNameNS(W,'numId')[0].getAttributeNS(W,'val');
   const num=[...nums.getElementsByTagNameNS(W,'num')].find(n=>n.getAttributeNS(W,'numId')===numId),aid=num.getElementsByTagNameNS(W,'abstractNumId')[0].getAttributeNS(W,'val');
   const abstract=[...nums.getElementsByTagNameNS(W,'abstractNum')].find(n=>n.getAttributeNS(W,'abstractNumId')===aid);
   results.push({name,b:value('b'),i:value('i'),u:value('u'),strike:value('strike'),indent:p.getElementsByTagNameNS(W,'ind')[0]?.getAttributeNS(W,'left'),size:value('sz'),font:r.getElementsByTagNameNS(W,'rFonts')[0]?.getAttributeNS(W,'ascii'),color:value('color'),align:p.getElementsByTagNameNS(W,'jc')[0]?.getAttributeNS(W,'val'),line:p.getElementsByTagNameNS(W,'spacing')[0]?.getAttributeNS(W,'line'),list:abstract.getElementsByTagNameNS(W,'numFmt')[0]?.getAttributeNS(W,'val'),escaped:p.textContent.includes('<nội dung> & ký hiệu')});
  }return results;
 },[...await readFile(packPath)]);
 for(const r of inspect)assert.deepEqual(r,{name:r.name,b:'1',i:'1',u:'single',strike:'1',indent:'720',size:'36',font:'Arial',color:'1D4ED8',align:'center',line:'360',list:'bullet',escaped:true});
 // Pasted markup remains literal text; line breaks stay inside the tracked paragraph.
 await page.locator('[data-doc="TAM_UNG"]').click();await ready();const paste=frame.locator('[data-word-index]').first();
 await paste.evaluate(p=>{p.focus();const range=p.ownerDocument.createRange();range.selectNodeContents(p);const selection=p.ownerDocument.getSelection();selection.removeAllRanges();selection.addRange(range);const clipboardData=new DataTransfer();clipboardData.setData('text/plain','Dòng 1\n<img src=x onerror=alert(1)>');clipboardData.setData('text/html','<img src=x onerror=alert(1)>');p.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData}));});
 assert.match(await paste.innerText(),/Dòng 1\n<img/);assert.equal(await paste.locator('img').count(),0);
 await page.locator('[data-save]').click();await page.waitForFunction(()=>document.querySelector('[data-save]').textContent==='Lưu chỉnh sửa');
 // Reopen saved edits and ensure new runs, not HTML, drive the preview.
 await page.locator('.modal-foot [data-x]').click();await page.evaluate(async()=>{const {openContractDocs}=await import('/contract-ui.js');await openContractDocs(fixture);});await ready();
 assert.ok(await frame.locator('[data-word-index]').filter({hasText:'chữ thử'}).count());
 const [single]=await Promise.all([page.waitForEvent('download'),page.locator('[data-one]').click()]);assert.ok(single.suggestedFilename().endsWith('.docx'));
 await page.locator('.cd-frame').evaluate(f=>{f.contentWindow.print=()=>{f.dataset.printed='yes';};});await page.locator('[data-print]').click();assert.equal(await page.locator('.cd-frame').getAttribute('data-printed'),'yes');
 // Both operation failure and success restore the explicit action label.
 await page.evaluate(()=>{globalThis.oldPrepare=ContractDocument.prepareDocument;ContractDocument.prepareDocument=async()=>{throw Error('Fixture failure');};});await page.locator('[data-one]').click();await page.waitForFunction(()=>toasts.some(t=>t.message==='Fixture failure'));assert.equal(await page.locator('[data-one]').textContent(),'Tải Word (.docx)');assert.equal(await page.locator('[data-one]').isEnabled(),true);await page.evaluate(()=>ContractDocument.prepareDocument=oldPrepare);
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.locator('.contract-docs').evaluate(d=>d.scrollWidth<=d.clientWidth),true);assert.equal(await page.locator('.contract-docs .modal-foot').evaluate(d=>d.getBoundingClientRect().bottom<=innerHeight),true);await page.screenshot({path:dir+'/'+brand+'-'+width+'.png'});}
 await page.locator('.modal-foot [data-x]').click();await page.evaluate(async()=>{fixture.detail.contract.canEdit=false;fixture.detail.contract.canEditFinancial=false;const {openContractDocs}=await import('/contract-ui.js');await openContractDocs(fixture);});await page.waitForFunction(()=>!document.querySelector('.contract-docs').matches('[aria-busy="true"]'));
 assert.equal(await page.locator('[data-format]').isHidden(),true);assert.equal(await frame.locator('[contenteditable]').count(),0);assert.equal(await page.locator('[data-save]').isHidden(),true);
 assert.deepEqual(errors,[]);results.push({brand,selectedText:true,saved:true,reopened:true,wordAndZip:true,bbntNumbering:true,readOnly:true,mobile:true});await page.close();
}console.log(JSON.stringify(results));}finally{await writeFile(dir+'/results.json',JSON.stringify(results,null,2));await browser.close();server.close();}
