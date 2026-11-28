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
const dir='/workspace/scratch/contract-document-consistency';await mkdir(dir,{recursive:true});
const results=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);for(const file of ['fflate.min.js','contract-word-edit.js','contract-document.js','jszip.min.js','docx-preview.min.js'])await page.addScriptTag({url:origin+'/'+file});
 for(const file of ['style.css','typography.css','mobile-actions.css','mobile-design.css'])await page.addStyleTag({url:origin+'/'+file});
 for(const brand of ['bach-ngan','vigifts']){
  const result=await page.evaluate(async({brand})=>{
   const check=(v,m)=>{if(!v)throw Error(m);},W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
   const unpack=b=>new DOMParser().parseFromString(fflate.strFromU8(fflate.unzipSync(new Uint8Array(b))['word/document.xml']),'application/xml');
   const text=p=>[...p.getElementsByTagNameNS(W,'t')].map(t=>t.textContent).join('');
   const paragraphs=b=>[...unpack(b).getElementsByTagNameNS(W,'p')];
   const table=b=>[...unpack(b).getElementsByTagNameNS(W,'tbl')].find(t=>/STT/.test(text(t))&&/Thành\s*[Tt]iền/.test(text(t)));
   const serializer=new XMLSerializer(),tableXml=b=>serializer.serializeToString(table(b));
   const q={quote_type:brand==='vigifts'?'VIGIFTS':'B2B',quote_date:'2026-10-05',quote_number:'BG_TEST',customer:{name:'Công ty kiểm thử',contact_name:'Trần Văn An',address:'Địa chỉ khách'},subtotal:300000,vat_amount:24000,total:324000,
    items:[{name:'Bộ trà Jasmine Trắng (SKU-TEST)',quantity:2,unit:'Bộ',price_after_discount:150000,line_total:300000,tax_percent:8,bundle_contents:'01 ấm + 06 tách',print_description:'Logo hai vị trí',packaging_description:'Túi vải 37 × 37 cm'}]};
   const details={signedDate:'2026-10-20',deliveryAddress:'Kho nhận <A> & B, 123 Nguyễn Huệ',representativeName:'Trần Văn An',depositRate:30,paymentDays:7};
   const templates=await Promise.all(ContractDocument.templatesFor(q).map(async t=>({...t,templateBytes:await(await fetch(t.path)).arrayBuffer()})));
   const options=type=>({quote:q,details,contractNumber:'TEST/2026',documentType:type,templateBytes:templates.find(t=>t.file===type).templateBytes});
   check(ContractDocument.templatesFor({quote_type:'B2B'}).find(t=>t.file==='BBNT').path===ContractDocument.templatesFor({quote_type:'VIGIFTS'}).find(t=>t.file==='BBNT').path,'one shared handover template');
   // Reproduce an edit saved before the typography update, using the former raw-font pipeline.
   const currentBuilder=ContractDocument,legacySource=(await(await fetch('/contract-document.js')).text()).replace('normalizeFonts(files);','');
   let legacyDoc;
   try{(0,eval)(legacySource);legacyDoc=await ContractDocument.build(options('HDKT'));}finally{globalThis.ContractDocument=currentBuilder;}
   const legacyInfo=await ContractWordEdit.prepare(legacyDoc),legacyParagraphs=paragraphs(legacyDoc),legacyIndex=legacyParagraphs.findIndex(p=>text(p).includes('Logo hai vị trí'));
   const migrated=await ContractDocument.build({...options('HDKT'),quote:{...q,contract_word_edits:[{index:legacyIndex,hash:legacyInfo.paragraphs.find(p=>p.index===legacyIndex).hash,text:'Mô tả đã lưu trước khi đổi phông chữ'}]}});
   check(paragraphs(migrated).some(p=>text(p).includes('Mô tả đã lưu trước khi đổi phông chữ')),'old font edit safely migrated');
   const old=await ContractDocument.build({...options('HDKT'),details:{...details,signedDate:'2026-10-05',deliveryAddress:'Địa chỉ cũ'}});const info=await ContractWordEdit.prepare(old),ps=paragraphs(old);
   const makeEdit=(predicate,value)=>{const index=ps.findIndex(predicate),hash=info.paragraphs.find(x=>x.index===index)?.hash;check(hash,'missing edit paragraph '+predicate);return {index,hash,text:typeof value==='function'?value(text(ps[index])):value};};
   q.contract_word_edits=[makeEdit(p=>/^Hôm nay/.test(text(p)),'Hôm nay, ngày 05 tháng 10 năm 2026, chúng tôi gồm:'),makeEdit(p=>/^5\.2\s*Địa điểm giao hàng/.test(text(p)),'5.2 Địa điểm giao hàng: Địa chỉ cũ'),makeEdit(p=>text(p).includes('Logo hai vị trí'),t=>t.replace('Logo hai vị trí','In logo khách theo bản duyệt cuối HĐKT'))];
   const hdkt=await ContractDocument.build(options('HDKT')),hdktText=paragraphs(hdkt).map(text).join('\n');
   check(hdktText.includes('ngày 20 tháng 10 năm 2026'),'signed date authoritative');check(!hdktText.includes('ngày 05 tháng 10'),'stale date removed');check(hdktText.includes('5.2   Địa điểm giao hàng: '+details.deliveryAddress),'delivery address 5.2');check(!hdktText.includes('Địa chỉ cũ'),'stale address removed');
   const oldBB=await ContractDocument.build(options('BBNT')),bbInfo=await ContractWordEdit.prepare(oldBB);
   // Use XML nodes from the same document to identify table paragraphs.
   const bbDoc=unpack(oldBB),bbAll=[...bbDoc.getElementsByTagNameNS(W,'p')],bbTable=[...bbDoc.getElementsByTagNameNS(W,'tbl')].find(t=>/STT/.test(text(t))&&/Thành\s*[Tt]iền/.test(text(t)));
   const lastProductIndex=bbAll.findLastIndex(p=>bbTable.contains(p));
   const legalIndex=bbAll.findIndex((p,i)=>i>lastProductIndex&&!bbTable.contains(p)&&text(p).trim());
   check(legalIndex>=0,'outside paragraph');
   const productIndex=bbAll.findIndex(p=>bbTable.contains(p)&&text(p).includes('Bộ trà'));
   q.contract_document_edits={BBNT:[{...bbInfo.paragraphs.find(x=>x.index===legalIndex),text:'Biên bản bàn giao – điều khoản riêng đã lưu'},{...bbInfo.paragraphs.find(x=>x.index===productIndex),text:'Mô tả cũ không theo HĐKT'}]};
   const prepared=await ContractDocument.prepareDocument({...options('BBNT'),contractBytes:hdkt}),bb=await ContractWordEdit.apply(prepared.base,prepared.edits);
   check(tableXml(bb)===tableXml(hdkt),'same exact contract table');const styles=fflate.strFromU8(fflate.unzipSync(bb)['word/styles.xml']);for(const node of table(bb).getElementsByTagNameNS(W,'tblStyle'))check(styles.includes('w:styleId="'+node.getAttributeNS(W,'val')+'"'),'table style copied');const bbText=paragraphs(bb).map(text).join('\n');
   for(const expected of ['In logo khách theo bản duyệt cuối HĐKT','01 ấm + 06 tách','Túi vải 37 × 37 cm','300.000','24.000','324.000','Tổng tiền','VAT'])check(bbText.includes(expected),'BBNT includes '+expected);
   check(bbText.includes('điều khoản riêng đã lưu'),'outside edits retained');check(prepared.edits[0].index!==legalIndex,'outside edit remapped after table size change');check(!bbText.includes('Mô tả cũ'),'stale product edit removed');check(prepared.locked.length>10,'table locked in BBNT');
   q.contract_document_edits.BBNT=prepared.edits;const again=await ContractDocument.build({...options('BBNT'),contractBytes:hdkt});check(tableXml(again)===tableXml(hdkt),'migrated edits reopen');
   const pack=await ContractDocument.buildPack({quote:q,details,contractNumber:'TEST/2026',templateFiles:[...templates].reverse()}),files=fflate.unzipSync(pack.bytes);
   check(tableXml(files['HDKT.docx'])===tableXml(files['BBNT.docx']),'zip same table regardless template order');
   const preview=await ContractWordEdit.prepare(prepared.base,prepared.edits);document.querySelector('main').innerHTML='';await docx.renderAsync(preview.preview,document.querySelector('main'),undefined,{inWrapper:true});
   check(document.body.innerText.includes('In logo khách theo bản duyệt cuối HĐKT'),'rendered description');check(document.body.innerText.includes('324.000'),'rendered payment total');
   // Refuse unrelated stale legal edits rather than moving them to an arbitrary paragraph.
   let rejected=false;try{await ContractDocument.build({...options('BBNT'),quote:{...q,contract_document_edits:{BBNT:[{index:legalIndex,hash:'invalid',text:'stale'}]}},contractBytes:hdkt});}catch{rejected=true;}check(rejected,'stale unrelated edit rejected');
   globalThis.documentTestFixture={quote:q,details,sharedTemplate:[...new Uint8Array(templates.find(t=>t.file==='BBNT').templateBytes)]};
   return {brand,date:true,address:true,exactTable:true,savedContractDescription:true,outsideEdits:true,zip:true,preview:true,staleEditsGuard:true};
  },{brand});
  await page.screenshot({path:dir+'/'+brand+'-bbnt.png',fullPage:true});
  // Exercise the real editor, including tab switching and the single-file download path.
  await page.evaluate(async({brand})=>{
   document.querySelector('main').innerHTML='';
   const {quote:q,details}=documentTestFixture,{openContractDocs}=await import('/contract-ui.js');
   const detail={order:{quoteType:q.quote_type,quoteNo:q.quote_number,quoteId:'fixture',subtotal:q.subtotal,tax:q.vat_amount,total:q.total,customerName:q.customer.name,contact:q.customer.contact_name,address:q.customer.address},
    contract:{id:'fixture',revision:1,quoteRevision:3,sourceTerms:{depositRate:40,paymentDays:15,deliveryTime:'Giao hàng ngày 06/11/2026',deliveryAddress:'Kho báo giá nguồn'},contractNo:'TEST/2026',legalEntity:brand==='vigifts'?'VG':'BN',canEdit:true,canEditFinancial:true,depositRate:30,paymentDays:7,signedDate:details.signedDate,data:{details}},
    lines:q.items.map(i=>({name:i.name,unit:i.unit,qty:i.quantity,unitPrice:i.price_after_discount,amount:i.line_total,taxRate:i.tax_percent}))};
   await openContractDocs({detail,api:async(path,method,body)=>{if(method==='PUT'){globalThis.fixtureSaves||=[];globalThis.fixtureSaves.push(body);return {ok:true,quoteRevision:body.quoteRevision+1};}await new Promise(r=>setTimeout(r,300));return {data:{rows:q.items.map(i=>({name:i.name,qty:i.quantity,bundleContents:i.bundle_contents,printDescription:i.print_description,packagingDescription:i.packaging_description}))}};},toast:(m,kind)=>{if(kind==='err')throw Error(m);}});
  },{brand});
  assert.equal(await page.locator('[data-d="depositRate"]').inputValue(),'40');
  assert.equal(await page.locator('[data-d="paymentDays"]').inputValue(),'15');
  assert.equal(await page.locator('[data-d="deliveryAddress"]').inputValue(),'Kho báo giá nguồn');
  const earlyZipEvent=page.waitForEvent('download');await page.locator('[data-zip]').click();const earlyZip=await earlyZipEvent;const earlyZipPath=dir+'/'+brand+'-early.zip';await earlyZip.saveAs(earlyZipPath);
  const earlyBytes=await readFile(earlyZipPath);
  assert.equal(await page.evaluate(bytes=>{const files=fflate.unzipSync(new Uint8Array(bytes)),xml=fflate.strFromU8(fflate.unzipSync(files['BBNT.docx'])['word/document.xml']);return xml.includes('Logo hai vị trí')&&xml.includes('01 ấm + 06 tách');},[...earlyBytes]),true);
  const frame=page.frameLocator('.cd-frame');
  await frame.locator('p').filter({hasText:'Hôm nay, ngày 20 tháng 10 năm 2026'}).waitFor();
  assert.equal(await frame.locator('p').filter({hasText:'Hôm nay, ngày 20 tháng 10 năm 2026'}).getAttribute('contenteditable'),null);
  await page.locator('[data-d="signedDate"]').fill('2026-10-27');
  await page.locator('[data-d="deliveryAddress"]').fill('Kho nhận mới – mục 5.2');
  await page.locator('[data-refresh]').click();await frame.locator('p').filter({hasText:'Hôm nay, ngày 27 tháng 10 năm 2026'}).waitFor();
  assert.ok(await frame.locator('p').filter({hasText:'5.2   Địa điểm giao hàng: Kho nhận mới – mục 5.2'}).count());
  const payment=frame.locator('p[contenteditable]').filter({hasText:'Thời hạn thanh toán'}).first();
  await payment.fill('- Thời hạn thanh toán: Theo lịch đã thống nhất.');
  await page.locator('[data-refresh]').click();
  await frame.getByText('Theo lịch đã thống nhất.',{exact:false}).first().waitFor();
  const description=frame.locator('[contenteditable]').filter({hasText:'Logo hai vị trí'}).first();
  await description.fill('Bộ gồm: 01 ấm + 06 tách · Mô tả đã chỉnh trực tiếp trong HĐKT · Đóng gói túi vải');
  await page.locator('[data-doc="BBNT"]').click();
  await frame.locator('p').filter({hasText:'Mô tả đã chỉnh trực tiếp trong HĐKT'}).waitFor();
  assert.equal(await frame.locator('[contenteditable]').filter({hasText:'Mô tả đã chỉnh trực tiếp trong HĐKT'}).count(),0);
  assert.ok(await frame.locator('td').filter({hasText:'324.000'}).count());
  assert.ok((await frame.locator('body').innerText()).includes('27/10/2026')||(await frame.locator('body').innerText()).includes('ngày 27 tháng 10 năm 2026'));
  const downloadEvent=page.waitForEvent('download');await page.locator('[data-one]').click();const download=await downloadEvent;await download.saveAs(dir+'/'+brand+'-BBNT.docx');
  assert.ok(download.suggestedFilename().startsWith('BBNT_'));
  const downloaded=await readFile(dir+'/'+brand+'-BBNT.docx');
  assert.equal(await page.evaluate(({bytes,brand})=>{
   const files=fflate.unzipSync(new Uint8Array(bytes)),raw=fflate.strFromU8(files['word/document.xml']),doc=new DOMParser().parseFromString(raw,'application/xml');
   const fonts=[...doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','rFonts')];
   const shared=fflate.unzipSync(new Uint8Array(globalThis.documentTestFixture.sharedTemplate));
   const expectedLogo=shared[brand==='vigifts'?'word/media/logo-vigifts.png':'word/media/image1.png'];
   if(!files['word/media/image1.png'].every((v,i)=>v===expectedLogo[i]))return false;
   if(!fonts.length||fonts.some(f=>[...f.attributes].some(a=>a.value!=='Times New Roman')))return false;
   return raw.includes(brand==='vigifts'?'1801291722':'1801686576')&&!raw.includes(brand==='vigifts'?'1801686576':'1801291722');
  },{bytes:[...downloaded],brand}),true);
  await page.locator('[data-d="depositRate"]').fill('60');await page.locator('[data-d="paymentDays"]').fill('21');
  await page.locator('[data-save]').click();await page.waitForFunction(()=>globalThis.fixtureSaves?.length===1);
  const saved=await page.evaluate(()=>globalThis.fixtureSaves[0]);
  assert.equal(saved.quoteRevision,3);assert.equal(saved.syncQuoteTerms,true);assert.equal(saved.depositRate,60);assert.equal(saved.paymentDays,21);
  assert.equal(saved.deliveryTime,'Giao hàng ngày 06/11/2026');assert.equal(saved.deliveryAddress,'Kho nhận mới – mục 5.2');
  await page.locator('[data-d="deliveryAddress"]').fill('Kho cập nhật lần hai');await page.locator('[data-save]').click();await page.waitForFunction(()=>globalThis.fixtureSaves.length===2);
  const second=await page.evaluate(()=>globalThis.fixtureSaves[1]);assert.equal(second.quoteRevision,4);assert.equal(second.depositRate,undefined);assert.equal(second.paymentDays,undefined);
  await page.evaluate(()=>{globalThis.fixtureSaves=[];});

  await frame.locator('td').filter({hasText:'Mô tả đã chỉnh trực tiếp trong HĐKT'}).first().scrollIntoViewIfNeeded();
  await page.screenshot({path:dir+'/'+brand+'-editor-1280.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:dir+'/'+brand+'-editor-390.png',fullPage:true});
  page.once('dialog',d=>d.accept());await page.locator('.contract-docs .modal-foot [data-x]').click();await page.setViewportSize({width:1280,height:1000});
  results.push({...result,editor:true,formRefresh:true,singleDownload:true,earlyZip:true,sharedTemplate:true,timesNewRoman:true,sourceTerms:true,reverseSave:true,legacyFontEdit:true});
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify(results));
}finally{await writeFile(dir+'/results.json',JSON.stringify(results,null,2));await browser.close();server.close();}
