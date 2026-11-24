/** Local DOM + real DOCX integration, with a text-only preview adapter (no layout engine).
 * Does not substitute for docx-preview/browser layout/selection QA.
 * Install jsdom separately, or set JSDOM_MODULE to its module path. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const {JSDOM}=await import(process.env.JSDOM_MODULE||'jsdom');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const sourceManifest=JSON.parse(await readFile(new URL('../../src/modules/sales/domain/contract-source-manifest.json',import.meta.url),'utf8'));
const manifest=JSON.parse(await readFile(new URL('../../src/modules/sales/domain/contract-template-manifest.json',import.meta.url),'utf8'));
const origin='https://contract-local.test';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:origin,runScripts:'dangerously',pretendToBeVisual:true});
const w=dom.window;
Object.defineProperty(w,'crypto',{value:globalThis.crypto});w.TextEncoder=class extends TextEncoder{encode(text){return new w.Uint8Array(super.encode(text));}};w.TextDecoder=TextDecoder;
const append=w.document.head.append.bind(w.document.head);w.document.head.append=(...nodes)=>{for(const node of nodes){append(node);if(node.tagName==='SCRIPT'){try{w.eval(readFileSync(root+new URL(node.src).pathname,'utf8'));if(node.src.includes('docx-preview'))w.docx.renderAsync=renderTextPreview;queueMicrotask(()=>node.dispatchEvent(new w.Event('load')));}catch(e){console.error(e);queueMicrotask(()=>node.dispatchEvent(new w.Event('error')));}}}};
async function renderTextPreview(bytes,host){
 Object.defineProperty(host.ownerDocument.defaultView.HTMLElement.prototype,'innerText',{get(){return this.textContent;},set(v){this.textContent=v;},configurable:true});
 const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',zip=w.fflate.unzipSync(new w.Uint8Array(bytes));
 const xml=new w.DOMParser().parseFromString(w.fflate.strFromU8(zip['word/document.xml']),'application/xml');
 assert.equal(xml.getElementsByTagName('parsererror').length,0);
 for(const source of xml.getElementsByTagNameNS(W,'p')){
  const p=host.ownerDocument.createElement('p');p.style.fontSize='16px';p.textContent=[...source.getElementsByTagNameNS(W,'t')].map(t=>t.textContent).join('');
  for(const mark of source.getElementsByTagNameNS(W,'bookmarkStart')){const span=host.ownerDocument.createElement('span');span.id=mark.getAttributeNS(W,'name');p.prepend(span);}host.append(p);
 }
}
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){return this.textContent;},set(v){this.textContent=v;},configurable:true});
for(const key of ['document','DOMParser','XMLSerializer','NodeFilter'])globalThis[key]=w[key];
for(const key of ['fflate','ContractWordEdit','ContractDocument','docx'])Object.defineProperty(globalThis,key,{get:()=>w[key],configurable:true});
globalThis.fetch=async url=>new Response(await readFile(root+new URL(url,origin).pathname));globalThis.confirm=()=>true;
const {openContractDocs}=await import('../../trial-ui/contract-ui.js');
const wait=async(predicate,label)=>{for(let i=0;i<500;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out: '+label+' '+w.document.querySelector('[data-status]')?.textContent);};
const results=[];
try{
 for(const brand of ['BN','VG']){

  const base=manifest[brand];let master={brand,revision:0,sourceHash:base.sourceHash,edits:[],locked:base.paragraphs.filter(p=>p.locked).map(p=>p.index)};
  let contractSaves=0,fail=false;const notices=[];
  const detail={order:{id:'o',quoteType:brand==='VG'?'VIGIFTS':'B2B',quoteNo:'TEST',customerName:'Khách thử',contact:'Trần Văn An',address:'Kho thử',subtotal:300000,tax:24000,total:324000},contract:{id:'k',contractNo:'TEST/2026',legalEntity:brand,canEdit:true,canEditFinancial:true,canManageTemplates:true,revision:1,signedDate:'2026-11-14',depositRate:30,paymentDays:15,data:{}},lines:[{sku:'SP1',name:'Sản phẩm thử',unit:'Bộ',qty:2,unitPrice:150000,amount:300000,taxRate:8}]};
  const api=async(path,method,body)=>{
   if(path.startsWith('/contract-template-sources/')){const type=path.split('/').pop(),base=sourceManifest[brand][type];return {brand,documentType:type,revision:0,sourceHash:base.sourceHash,requiredFields:base.fields,source:null};}
   if(path.startsWith('/contract-templates/')){if(method==='PUT'){if(fail)throw Error('Manager khác đã sửa mẫu');master={...master,...structuredClone(body),edits:body.edits.map(e=>({...structuredClone(e),hash:'0'.repeat(64)})),revision:master.revision+1};}return structuredClone(master);}
   if(method==='PUT'){contractSaves++;return {ok:true};}return {};
  };
  await openContractDocs({detail,api,toast:m=>notices.push(m)});
  const dlg=()=>document.querySelector('.contract-docs'),q=s=>dlg().querySelector(s),ready=()=>wait(()=>dlg().getAttribute('aria-busy')==='false','preview');
  await ready();assert.equal(q('[data-format]').hidden,true);assert.equal(q('[data-status]').textContent,'');assert.equal(q('[data-template]').hidden,false);
  q('[data-format-toggle]').click();assert.equal(q('[data-format]').hidden,false);q('[data-format-toggle]').click();assert.equal(q('[data-format]').hidden,true);
  const original=q('.cd-frame').contentDocument.body.textContent;
  q('[data-template]').click();await wait(()=>q('[data-save]').textContent==='Lưu mẫu chung','master mode');await ready();
  assert.equal(q('.cd-form').hidden,true);assert.equal(q('[data-zip]').hidden,true);assert.equal(q('[data-format]').hidden,true);
  const doc=q('.cd-frame').contentDocument;assert.ok(doc.body.textContent.includes('<<'),'raw placeholders visible');
  assert.equal([...doc.querySelectorAll('[data-word-index]')].some(p=>master.locked.includes(Number(p.dataset.wordIndex))),false);
  const paragraph=doc.querySelector('[data-word-index]');assert.ok(paragraph);const idx=Number(paragraph.dataset.wordIndex);
  paragraph.textContent='Điều khoản chung kiểm thử '+brand;paragraph.dispatchEvent(new w.Event('input',{bubbles:true}));
  fail=true;q('[data-save]').click();await ready();assert.equal(master.revision,0);assert.match(q('[data-dirty]').textContent,/chưa lưu/);assert.ok(notices.includes('Manager khác đã sửa mẫu'));
  fail=false;q('[data-save]').click();await ready();assert.equal(master.revision,1);assert.equal(master.edits[0].index,idx);assert.equal(contractSaves,0);
  q('[data-template]').click();await ready();assert.equal(q('.cd-frame').contentDocument.body.textContent,original,'legacy document stays unchanged');
  q('[data-x]').click();assert.equal(dlg(),null);
  detail.contract.data.templateSnapshot={brand,sourceHash:base.sourceHash,revision:1,edits:master.edits};
  await openContractDocs({detail,api,toast:m=>notices.push(m)});await ready();
  const newText=q('.cd-frame').contentDocument.body.textContent;assert.ok(newText.includes('Điều khoản chung kiểm thử '+brand));assert.ok(newText.includes('Sản phẩm thử'));assert.ok(newText.includes('324.000'));
  // Build actual packages with snapshot edits and check preserved dynamic fields and XML.
  const raw=await(await fetch(brand==='BN'?'/mau-hop-dong-bach-ngan-hdkt.docx':'/mau-hop-dong-vigifts-hdkt.docx')).arrayBuffer();
  const prepared=await ContractWordEdit.prepare(raw),rebased=master.edits.map(e=>({...e,hash:prepared.paragraphs.find(p=>p.index===e.index).hash}));
  const edited=await ContractWordEdit.apply(raw,rebased),zip=fflate.unzipSync(new Uint8Array(edited));
  const xml=new DOMParser().parseFromString(fflate.strFromU8(zip['word/document.xml']),'application/xml');assert.equal(xml.querySelector('parsererror'),null);assert.ok(xml.documentElement.textContent.includes('<<'));
  assert.deepEqual(Object.keys(zip).sort(),Object.keys(fflate.unzipSync(new Uint8Array(raw))).sort());
  q('[data-x]').click();detail.contract.canManageTemplates=false;await openContractDocs({detail,api,toast:m=>notices.push(m)});await ready();assert.equal(q('[data-template]').hidden,true);q('[data-x]').click();
  detail.contract.data.templateSnapshot.sourceHash='0'.repeat(64);await openContractDocs({detail,api,toast:m=>notices.push(m)});await ready();assert.match(q('[data-status]').textContent,/không khớp phiên bản/);assert.equal(q('.cd-frame').contentDocument.querySelector('[data-word-index]'),null);q('[data-x]').click();
  results.push({brand,masterSaved:true,legacyUnchanged:true,newContractUsesMaster:true,lockedFields:true,errorRetainsEdits:true,employeeButtonHidden:true});
 }
 console.log(JSON.stringify(results,null,2));
}finally{dom.window.close();}
