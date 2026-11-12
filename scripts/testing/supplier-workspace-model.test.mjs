import test from 'node:test';
import assert from 'node:assert/strict';
import {REVIEW_DATA as data,SUPPLIER,REVIEW_DATE} from '../../design/supplier-workspace/fixtures.js';
import {ledger,pageRows,filterRows,validateFilters,metrics,csv} from '../../design/supplier-workspace/model.js';
const sid=SUPPLIER.id,clone=()=>structuredClone(data);
test('all fixture lines reconcile quantity, subtotal, VAT and total',()=>{
 for(const o of data.orders){assert.equal(o.quantity,o.lines.reduce((n,l)=>n+l.qty,0));assert.equal(o.subtotal,o.lines.reduce((n,l)=>n+l.qty*l.price,0));assert.equal(o.tax,Math.round(o.subtotal*.08));assert.equal(o.total,o.subtotal+o.tax);}
 for(const i of data.invoices)assert.equal(i.total,i.subtotal+i.tax);
});
test('supplier boundary applies to every page and the payment ledger',()=>{
 const d=clone();for(const key of ['products','stock','orders','requests','transfers','advances','invoices','deliveries'])d[key].push({...d[key][0],id:'other-'+key,supplierId:'other'});
 d.payments.push({...d.payments[0],id:'other-payment',supplierId:'other',amount:999999999});
 for(const page of ['products','stock','orders','requests','transfers','advances','invoices','deliveries','balances'])assert.deepEqual(pageRows(page,d),pageRows(page,data));
});
test('duplicate delivery of a payment or credit cannot change balances',()=>{
 const d=clone();d.payments.push({...d.payments[0]});d.credits.push({...d.credits[0]});assert.deepEqual(ledger(d,sid,REVIEW_DATE),ledger(data,sid,REVIEW_DATE));
});
test('voided, future and unposted payments are excluded',()=>{
 const d=clone();for(const extra of [{voidedAt:'2026-11-12'}, {date:'2026-11-13'}, {status:'draft'}])d.payments.push({...d.payments[0],id:JSON.stringify(extra),amount:99999999,...extra});assert.deepEqual(ledger(d,sid,REVIEW_DATE),ledger(data,sid,REVIEW_DATE));
});
test('cancelled, unapproved and future orders never enter financial ledger',()=>{
 const d=clone();for(const extra of [{status:'cancelled'}, {date:'2026-11-13'}, {approvalStatus:'pending'}])d.orders.push({...d.orders[0],id:JSON.stringify(extra),...extra});assert.deepEqual(ledger(d,sid,REVIEW_DATE),ledger(data,sid,REVIEW_DATE));
});
test('invoice, delivery and advance requests never add to received money or debt',()=>{
 const d=clone();d.invoices.push(...d.invoices);d.deliveries.push(...d.deliveries);d.advances.push(...d.advances);assert.deepEqual(ledger(d,sid,REVIEW_DATE),ledger(data,sid,REVIEW_DATE));
});
test('balances reconcile and surplus remains explicit instead of disappearing',()=>{
 const rows=ledger(data,sid,REVIEW_DATE);for(const r of rows)assert.equal(r.remaining,r.total-r.paid-r.credit);
 assert.ok(rows.some(r=>r.status==='overpaid'&&r.remaining<0));const m=metrics('balances',rows);assert.equal(m[0].value,rows.reduce((n,r)=>n+Math.max(0,r.remaining),0));
});
test('historic cut-off excludes payments and credits after that date',()=>{
 const rows=ledger(data,sid,'2026-11-10');assert.ok(rows.every(r=>r.date<='2026-11-10'));assert.ok(rows.every(r=>r.credit===0));
 const d=clone();d.payments=d.payments.filter(p=>p.date<='2026-11-10');assert.deepEqual(rows,ledger(d,sid,'2026-11-10'));
});
test('unknown inventory remains null; zero stock is distinguishable',()=>{
 const rows=pageRows('stock',data),unknown=rows.find(r=>r.status==='unknown'),zero=rows.find(r=>r.status==='out');assert.equal(unknown.available,null);assert.equal(zero.available,0);
 assert.ok(!filterRows(rows,{min:'0',valueField:'available'}).includes(unknown));assert.ok(filterRows(rows,{max:'0',valueField:'available'}).includes(zero));
 for(const r of rows.filter(r=>r.onHand!=null))assert.equal(r.available,Math.max(0,r.onHand-r.reserved));
});
test('filters use inclusive date and amount bounds and can search order line SKU',()=>{
 const o=data.orders[0],f={from:o.date,to:o.date,min:String(o.total),max:String(o.total),q:o.lines[0].sku};assert.deepEqual(filterRows(data.orders,f),[o]);
 assert.ok(filterRows(data.products,{q:'binh giu nhiet'}).length>1);
 assert.equal(filterRows(data.orders,{q:'no such supplier record'}).length,0);
});
test('invalid date and amount ranges produce no misleading result',()=>{
 for(const f of [{from:'2026-11-31'},{from:'2026-11-12',to:'2026-11-01'},{min:'-1'},{max:'NaN'},{min:'2',max:'1'}]){assert.ok(validateFilters(f));assert.deepEqual(filterRows(data.orders,f),[]);}
});
test('CSV exports only requested columns and escapes spreadsheet formulas',()=>{
 const out=csv([{key:'name',label:'Tên'},{key:'amount',label:'Tiền'}],[{name:'=SUM(1,2)',amount:2,secret:'never export'},{name:'A "quoted" name',amount:-5}]);assert.ok(out.startsWith('\ufeff'));assert.ok(out.includes("\"'=SUM(1,2)\""));assert.ok(out.includes('A ""quoted"" name'));assert.ok(out.includes('"-5"'));assert.ok(!out.includes('never export'));
});
test('three-year-sized sample is filtered without rendering its entire data set',()=>{
 const rows=Array.from({length:10000},(_,i)=>({...data.orders[i%data.orders.length],id:'perf-'+i}));const started=performance.now();const found=filterRows(rows,{q:'DMH',from:'2026-01-01',to:'2026-12-31'});assert.equal(found.length,10000);const elapsed=performance.now()-started;assert.ok(elapsed<2000,'10k rows took '+elapsed+'ms');console.log('10k local review rows: '+elapsed.toFixed(1)+' ms; not a production API benchmark');
});
