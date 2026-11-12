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
test('spreadsheet formulas stay inert even after leading spaces or control whitespace',()=>{
 for(const name of ['  =SUM(1,2)','\t+1+1','\r@SUM(1,1)','\uFEFF-HYPERLINK("x")']){const out=csv([{key:'name',label:'Tên'}],[{name}]);assert.ok(out.includes('"\''+name.replaceAll('"','""')+'"'));}
});
test('date and numeric filters reject impossible days, Infinity and partial input',()=>{
 for(const f of [{from:'2026-02-29'},{asOf:'2026-1-2'},{max:'Infinity'},{min:'12abc'},{from:'2026-11-12" autofocus'}])assert.ok(validateFilters(f));
 assert.equal(validateFilters({from:'2024-02-29',to:'2024-02-29',min:'0',max:'0'}),'');
 assert.deepEqual(filterRows([{date:'',total:1}],{to:'2026-11-12'}),[]);
});
test('partly paid, due today and confirmed credits have independent states',()=>{
 const base={id:'o',supplierId:sid,approvalStatus:'approved',status:'confirmed',date:'2026-11-01',dueDate:REVIEW_DATE,total:1000};
 const d={orders:[base],payments:[{id:'p',supplierId:sid,orderId:'o',date:REVIEW_DATE,amount:300,status:'posted'}],credits:[]};
 let row=ledger(d,sid,REVIEW_DATE)[0];assert.equal(row.paid,300);assert.equal(row.remaining,700);assert.equal(row.status,'owing');
 row=ledger(d,sid,'2026-11-13')[0];assert.equal(row.status,'overdue');
 d.credits.push({id:'c',supplierId:sid,orderId:'o',effectiveDate:'2026-11-13',amount:700});assert.equal(ledger(d,sid,REVIEW_DATE)[0].remaining,700);assert.equal(ledger(d,sid,'2026-11-13')[0].status,'settled');
});
test('10k-order ledger aggregates 20k payments without counting another supplier or duplicates',()=>{
 const orders=Array.from({length:10000},(_,i)=>({id:String(i),supplierId:sid,approvalStatus:'approved',status:'confirmed',date:'2026-11-01',dueDate:'2026-11-15',total:100000}));
 const payments=orders.flatMap(o=>[1,2].map(n=>({id:o.id+'-'+n,supplierId:sid,orderId:o.id,date:'2026-11-02',amount:10000,status:'posted'})));
 payments.push({...payments[0]},{...payments[0],supplierId:'other',amount:999999});
 const started=performance.now(),rows=ledger({orders,payments,credits:[]},sid,REVIEW_DATE),elapsed=performance.now()-started;
 assert.equal(rows.length,10000);assert.equal(rows.reduce((n,r)=>n+r.remaining,0),800000000);assert.ok(rows.every(r=>r.paid===20000));
 console.log('10k orders / 20k payments ledger: '+elapsed.toFixed(1)+' ms (synthetic local model, not production database)');
});
