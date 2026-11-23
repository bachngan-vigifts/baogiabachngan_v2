/** Real templates, Word edit migration, preview and downloads; synthetic data only. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out='/workspace/artifacts/contract-printing-clause';await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript;charset=utf-8':path.endsWith('.css')?'text/css;charset=utf-8':'text/html;charset=utf-8');res.end(path==='/'?'<!doctype html><html><body></body></html>':await readFile(root+path));}catch{res.writeHead(404).end();}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}});await page.goto(origin);
 for(const file of ['fflate.min.js','contract-word-edit.js','contract-document.js','jszip.min.js','docx-preview.min.js'])await page.addScriptTag({url:origin+'/'+file});
 for(const file of ['style.css','typography.css','mobile-actions.css','mobile-design.css'])await page.addStyleTag({url:origin+'/'+file});
 for(const brand of ['bach-ngan','vigifts'])for(const printing of [true,false]){
  const result=await page.evaluate(async({brand,printing})=>{
   const check=(value,message)=>{if(!value)throw Error(message);},W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
   const unpack=bytes=>{const files=fflate.unzipSync(new Uint8Array(bytes)),xml=new DOMParser().parseFromString(fflate.strFromU8(files['word/document.xml']),'application/xml');check(!xml.getElementsByTagName('parsererror').length,'valid XML');return xml;};
   const paragraphs=bytes=>[...unpack(bytes).getElementsByTagNameNS(W,'p')],text=p=>[...p.getElementsByTagNameNS(W,'t')].map(t=>t.textContent).join('');
   const quote={quote_type:brand==='vigifts'?'VIGIFTS':'B2B',quote_date:'2026-11-18',items:[{name:'Bộ trà thử',quantity:10,price_after_discount:100000,line_total:1000000,tax_percent:8}],customer:{name:'Khách thử'},subtotal:1000000,vat_amount:80000,total:1080000};
   const options={quote,contractNumber:'TEST-PRINT',details:{depositRate:30,paymentDays:7},templateBytes:await(await fetch('/mau-hop-dong-'+brand+'-hdkt.docx')).arrayBuffer()};
   const old=await ContractDocument.prepareDocument(options),all=paragraphs(old.base),index=all.findIndex(p=>/^4\.1/.test(text(p))),prepared=await ContractWordEdit.prepare(old.base),info=prepared.paragraphs.find(p=>p.index===index);
   const edit={...info,text:'4.1 Điều khoản riêng cần giữ nguyên khi thay mục 2.1'},q={...quote,printing_enabled:printing,contract_word_edits:[edit]};
   const next=await ContractDocument.prepareDocument({...options,quote:q}),bytes=await ContractWordEdit.apply(next.base,next.edits),ps=paragraphs(bytes),from=ps.findIndex(p=>/^2\.1/.test(text(p))),to=ps.findIndex((p,i)=>i>from&&/^\s*2\.2/.test(text(p))),clause=ps.slice(from,to).map(text).join('\n');
   check(clause.includes(printing?'80% trở lên':'2.1 Quy cách sản phẩm:'),'correct conditional terms');check(clause.includes('Chất lượng hàng hóa theo tiêu chuẩn NSX'),'quality term');check(ps.some(p=>text(p)===edit.text),'legacy unrelated edit preserved');check(next.locked.filter(i=>i>=from&&i<to).length===to-from,'generated clause pinned');
   const marker={version:1,printing},saved={...q,contract_print_clause:marker,contract_word_edits:next.edits};
   const reopened=await ContractDocument.build({...options,quote:saved});check(paragraphs(reopened).some(p=>text(p)===edit.text),'saved/reopened unrelated edit retained');
   const toggled=await ContractDocument.build({...options,quote:{...saved,printing_enabled:!printing}}),toggle=paragraphs(toggled).map(text).join('\n');check(toggle.includes(!printing?'80% trở lên':'2.1 Quy cách sản phẩm:'),'printing mode changed');check(toggle.includes(edit.text),'edits survive printing mode change');
   // A shared template previously shortened to nonprinting must still restore the printing clause.
   const raw=await ContractWordEdit.prepare(options.templateBytes),rawPs=paragraphs(options.templateBytes),start=rawPs.findIndex(p=>/^2\.1/.test(text(p))),end=rawPs.findIndex((p,i)=>i>start&&/^\s*2\.2/.test(text(p)));
   const overrides=raw.paragraphs.filter(p=>p.index>=start&&p.index<end).map(p=>({...p,text:p.index===start?'2.1 Quy cách sản phẩm:':p.index===end-1?'- Chất lượng hàng hóa theo tiêu chuẩn NSX':''}));
   const custom=await ContractWordEdit.apply(options.templateBytes,overrides),restored=await ContractDocument.build({...options,templateBytes:custom,quote:{...quote,printing_enabled:true}});check(paragraphs(restored).map(text).join('\n').includes('80% trở lên'),'shared nonprinting template restores printing terms');
   document.body.innerHTML='<div id="preview"></div>';await docx.renderAsync(new Blob([bytes]),document.querySelector('#preview'),undefined,{inWrapper:true,ignoreWidth:false,ignoreHeight:false,breakPages:true});
   check(document.querySelector('#preview').textContent.includes(printing?'80% trở lên':'2.1 Quy cách sản phẩm:'),'preview matches DOCX');
   const pack=await ContractDocument.buildPack({quote:saved,contractNumber:'TEST-PRINT',details:options.details,templateFiles:[{file:'HDKT',name:'HDKT',templateBytes:options.templateBytes}]});check(fflate.unzipSync(pack.bytes)['HDKT.docx'],'ZIP contains correct contract');
   return{brand,printing,sharedTemplate:true,unrelatedEdits:true,reopen:true,toggle:true,preview:true,zip:true};
  },{brand,printing});results.push(result);await page.screenshot({path:out+'/'+brand+'-'+printing+'.png',fullPage:true,animations:'disabled'});
 }
 // Exercise the actual modal's classification and save metadata on desktop/mobile.
 for(const width of [1440,390])for(const printing of [true,false]){
  await page.setViewportSize({width,height:1100});await page.goto(origin);for(const file of ['style.css','typography.css','mobile-actions.css','mobile-design.css'])await page.addStyleTag({url:origin+'/'+file});
  await page.evaluate(async({printing})=>{const {openContractDocs}=await import('/contract-ui.js');globalThis.clauseSaved=null;await openContractDocs({detail:{order:{id:'o',quoteId:'q',quoteType:'B2B',customerName:'Khách thử',subtotal:1000000,tax:80000,total:1080000},contract:{id:'k',contractNo:'TEST',legalEntity:'BN',canEdit:true,canEditFinancial:true,revision:1,signedDate:'2026-11-18',depositRate:30,paymentDays:7,data:{}},lines:[{sku:'SKU1',name:'Bộ trà thử',unit:'Bộ',qty:10,unitPrice:100000,amount:1000000,taxRate:8}]},api:async(path,method,body)=>{if(method==='PUT'){globalThis.clauseSaved=body;return{};}return{data:{rows:[{sku:'SKU1',name:'Bộ trà thử',qty:10,printFee:printing?10000:0,printDescription:printing?'In logo thử':'Không in'}]}};},toast(){}});},{printing});
  const frame=page.frameLocator('.cd-frame');await frame.locator('article').first().waitFor();await page.waitForFunction(()=>document.querySelector('[data-save]')&&!document.querySelector('[data-save]').disabled);
  const body=await frame.locator('body').innerText();assert(body.includes(printing?'80% trở lên':'2.1 Quy cách sản phẩm:'));if(!printing)assert(!body.includes('80% trở lên'));
  await page.locator('[data-save]').click();await page.waitForFunction(()=>globalThis.clauseSaved!==null);assert.equal(await page.evaluate(()=>clauseSaved.details.printingClause.printing),printing);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await frame.locator('p').filter({hasText:/^2\.1/}).first().scrollIntoViewIfNeeded();await page.screenshot({path:out+'/modal-'+width+'-'+printing+'.png',fullPage:true,animations:'disabled'});results.push({width,printing,actualModal:true,savedMetadata:true});
 }
 await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();server.close();}
