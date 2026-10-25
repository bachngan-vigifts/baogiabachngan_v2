import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore External plain-JS entrypoint shared with OpenClaw.
import {runSupplierReceipt} from '../../scripts/sapo_goods_receipt_from_quote_web.js';
// @ts-ignore External plain-JS contract.
import {validateReceiptPayload,exactMatch} from '../../scripts/supplier_receipt_contract_v1.js';

function fixture(action='create_purchase_receipt') {
 const p:any={schema_version:1,action,source:'crm_supplier_receipt',idempotency_key:'receipt-id',
  crm_order:{id:'order-id',code:'DMH_TEST',note:'đơn'},crm_receipt:{id:'receipt-id',code:'PNH_TEST',received_date:'2026-10-25',note:'phiếu'},
  supplier:{id:'crm-supplier',name:'NCC',tax_code:'00123'},warehouse:{name:'Kho đúng'},employee:{id:'crm-employee',name:'Nhân viên'},
  items:[{crm_line_id:'line',sku:'00123',name:'Ly',unit:'Cái',good_quantity:2,unit_price:0,purchase_discount_percent:0,vat_percent:8,note:''}],
  ...(action==='reconcile_existing'?{reconciliation_id:'reconcile-id'}:{})};
 const calls:string[]=[],callbacks:any[]=[];
 const master:any={warehouse:[{id:'1',name:'Kho đúng'}],supplier:[{id:'2',name:'NCC',tax_code:'00123'}],employee:[{id:'3',name:'Nhân viên'}],product:[{id:'4',sku:'00123'}]};
 const doc:any={kind:'purchase_order',id:'100',status:'completed',receipt_status:'received',receipt_id:'200',receipt_code:'PCN_TEST',
  url:'https://bachngankiengiang.mysapogo.com/admin/purchase_orders/100',crm_receipt_id:p.crm_receipt.id,crm_receipt_code:p.crm_receipt.code,
  crm_order_code:p.crm_order.code,received_date:p.crm_receipt.received_date,warehouse:master.warehouse[0],supplier:master.supplier[0],employee:master.employee[0],items:structuredClone(p.items)};
 const crm:any={claim:async()=>{calls.push('claim');return {lease_token:'lease',lease_until:new Date(Date.now()+900_000).toISOString(),payload:p};},
  callback:async(b:any)=>{calls.push('callback');callbacks.push(b);}};
 const sapo:any={searchPurchaseReceipts:async(ref:any)=>{calls.push('search');assert.deepEqual(ref,{crm_receipt_id:'receipt-id',receipt_code:'PNH_TEST',order_code:'DMH_TEST'});return {complete:true,matches:[]};},
  lookup:async(kind:string)=>{calls.push('lookup:'+kind);return master[kind];},
  createPurchaseOrder:async(body:any)=>{calls.push('purchase');assert.equal(body.warehouse.id,'1');assert.equal(body.supplier.id,'2');assert.equal(body.employee.id,'3');assert.equal(body.items[0].unit_price,0);assert.equal(body.items[0].sapo_variant_id,'4');return {id:'100'};},
  activatePurchaseOrder:async(id:string)=>{calls.push('activate');assert.equal(id,'100');},
  receiveAllGoodItems:async(id:string,b:any)=>{calls.push('receive');assert.equal(id,'100');assert.equal(b.items[0].good_quantity,2);},
  readPurchaseReceipt:async()=>{calls.push('read');return doc;}};
 const run=()=>runSupplierReceipt({crm,sapo,notification:p});
 return {p,calls,callbacks,master,doc,crm,sapo,run};
}

test('Consumer: claim → exact lookup → purchase order → activate → receive → readback → callback',async()=>{
 const f=fixture();assert.deepEqual(await f.run(),{ok:true,status:'done'});
 assert.deepEqual(f.calls,['claim','search','lookup:warehouse','lookup:supplier','lookup:employee','lookup:product','search','purchase','activate','receive','read','callback']);
 assert.equal(f.callbacks[0].lease_token,'lease');assert.equal(f.callbacks[0].sapo_receipt_id,'200');assert.equal(f.callbacks[0].sapo_purchase_order_id,'100');
});
test('Consumer: existing verified / reconcile never creates, activates, receives',async()=>{
 for(const action of ['create_purchase_receipt','reconcile_existing']){
  const f=fixture(action);f.sapo.searchPurchaseReceipts=async()=>{f.calls.push('search');return {complete:true,matches:[f.doc]};};
  assert.equal((await f.run()).ok,true);assert.deepEqual(f.calls,['claim','search','callback']);
  if(action==='reconcile_existing')assert.equal(f.callbacks[0].reconciliation_id,'reconcile-id');
 }
 const f=fixture('reconcile_existing');assert.equal((await f.run()).status,'needs_review');assert.deepEqual(f.calls,['claim','search','callback']);
});
test('Consumer: competing execution claim failure never touches Sapo',async()=>{
 const f=fixture();f.crm.claim=async()=>{throw Error('409 claimed');};
 await assert.rejects(f.run,/409/);assert.deepEqual(f.calls,[]);assert.deepEqual(f.callbacks,[]);
});
test('Consumer: missing/ambiguous identity, null price, partial order, incomplete search fail closed',async()=>{
 for(const scenario of ['missing-sku','near-sku','ambiguous-supplier','wrong-warehouse','null-price','draft-existing','incomplete-search','sales-order']){
  const f=fixture();
  if(scenario==='missing-sku')f.master.product=[];
  if(scenario==='near-sku')f.master.product=[{id:'4',sku:'123'}];
  if(scenario==='ambiguous-supplier')f.master.supplier.push({...f.master.supplier[0],id:'5'});
  if(scenario==='wrong-warehouse')f.master.warehouse[0].name='Kho gần đúng';
  if(scenario==='null-price')f.p.items[0].unit_price=null;
  if(scenario==='draft-existing'||scenario==='sales-order'){
   if(scenario==='draft-existing')f.doc.status='draft';else f.doc.kind='sales_order';
   f.sapo.searchPurchaseReceipts=async()=>({complete:true,matches:[f.doc]});
  }
  if(scenario==='incomplete-search')f.sapo.searchPurchaseReceipts=async()=>({complete:false,matches:[]});
  assert.equal((await f.run()).status,'needs_review',scenario);assert.ok(!f.calls.includes('purchase'),scenario);
  assert.equal(f.callbacks[0].ok,false);
 }
});
test('Consumer: timeout after purchase / wrong readback never recreates and reports needs_review',async()=>{
 for(const step of ['purchase','activate','receive','read','wrong-qty','wrong-discount','wrong-tax','wrong-warehouse','wrong-employee','wrong-date']){
  const f=fixture();
  const method:any={purchase:'createPurchaseOrder',activate:'activatePurchaseOrder',receive:'receiveAllGoodItems',read:'readPurchaseReceipt'};
  if(method[step])f.sapo[method[step]]=async()=>{f.calls.push(step);throw Error('private session timeout');};
  if(step==='wrong-qty')f.doc.items[0].good_quantity=3;
  if(step==='wrong-discount')f.doc.items[0].purchase_discount_percent=10;
  if(step==='wrong-tax')f.doc.items[0].vat_percent=0;
  if(step==='wrong-warehouse')f.doc.warehouse={id:'99',name:'Sai'};
  if(step==='wrong-employee')f.doc.employee={id:'99',name:'Sai'};
  if(step==='wrong-date')f.doc.received_date='2026-01-01';
  assert.equal((await f.run()).status,'needs_review',step);assert.equal(f.calls.filter(c=>c==='purchase').length,1);
  assert.ok(!JSON.stringify(f.callbacks).includes('private'));
 }
});
test('Consumer: callback transport error does not retry create or send contradictory failure callback',async()=>{
 const f=fixture();let count=0;f.crm.callback=async()=>{count++;throw Error('callback offline');};
 await assert.rejects(f.run,/callback offline/);assert.equal(count,1);assert.equal(f.calls.filter(c=>c==='purchase').length,1);
});
test('Consumer: lease expired stops mutation; late existing found on recheck prevents duplicate create',async()=>{
 const f=fixture();f.crm.claim=async()=>({lease_token:'lease',lease_until:'2000-01-01',payload:f.p});
 assert.equal((await f.run()).status,'needs_review');assert.ok(!f.calls.includes('purchase'));
 const g=fixture();let searches=0;g.sapo.searchPurchaseReceipts=async()=>({complete:true,matches:++searches===1?[]:[g.doc]});
 assert.equal((await g.run()).ok,true);assert.ok(!g.calls.includes('purchase'));
});
test('Contract: exact IDs win over name, no CRM/Sapo ID confusion; no damaged/null/invalid numbers',()=>{
 assert.equal(exactMatch([{id:'10',name:'Renamed'}],{id:'10',name:'Old'},'warehouse').id,'10');
 assert.equal(exactMatch([{id:'20',name:'NCC',tax_code:'00123'}],{id:'crm-id',name:'NCC',tax_code:'00123'},'supplier').id,'20');
 for(const key of ['unit_price','purchase_discount_percent','vat_percent','good_quantity']){
  for(const value of [null,NaN,-1]){const f=fixture();f.p.items[0][key]=value;assert.throws(()=>validateReceiptPayload(f.p));}
 }
 const f=fixture();f.p.items[0].damaged_quantity=1;assert.throws(()=>validateReceiptPayload(f.p));
});
