import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
const {makeShipmentDemo,lineFacts,demoProductRows,demoCalendarDays,shiftDemoCalendar,addDemoShipment}:any=await import(new URL('../../trial-ui/order-shipment-demo-data.js',import.meta.url).href);

test('product prototype preserves distinct lines of same SKU and computes partial deliveries from shipment lines',()=>{
 const data=makeShipmentDemo('2026-11-07'),before=JSON.stringify(data),rows=demoProductRows(data,{status:'all'});
 assert.equal(rows.length,6);assert.equal(rows.filter((l:any)=>l.sku==='MẪU-CHEN').length,2);
 const first=rows.find((l:any)=>l.id==='demo-l1'),second=rows.find((l:any)=>l.id==='demo-l2');
 assert.equal(first.facts.delivered,100);assert.equal(first.facts.remaining,50);assert.equal(first.facts.available,0);
 assert.equal(second.facts.delivered,0);assert.equal(second.facts.remaining,40);
 assert.deepEqual(demoProductRows(data,{status:'partial'}).map((l:any)=>l.id),['demo-l1']);
 assert.deepEqual(demoProductRows(data,{status:'overdue'}).map((l:any)=>l.id),['demo-l5']);
 assert.deepEqual(demoProductRows(data,{status:'unscheduled'}).map((l:any)=>l.id),['demo-l3']);
 assert.deepEqual(demoProductRows(data,{q:'dong ho treo',status:'all'}).map((l:any)=>l.id),['demo-l6']);
 assert.equal(demoProductRows(data,{owner:'Nhân viên mẫu B',status:'all'}).length,2);
 assert.equal(JSON.stringify(data),before);
});

test('calendar starts Monday, includes adjacent days, handles leap years and month/year changes',()=>{
 const nov=demoCalendarDays('2026-11-07','month');assert.equal(nov[0],'2026-10-26');assert.equal(nov.at(-1),'2026-12-06');assert.equal(nov.length,42);
 const leap=demoCalendarDays('2028-02-10','month');assert.ok(leap.includes('2028-02-29'));assert.equal(leap.length%7,0);
 assert.deepEqual(demoCalendarDays('2026-11-07','day'),['2026-11-07']);
 assert.equal(demoCalendarDays('2026-11-07','week')[0],'2026-11-02');
 assert.deepEqual(demoCalendarDays('2026-11-07','agenda'),['2026-11-07','2026-11-08','2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13']);
 assert.equal(shiftDemoCalendar('2026-12-31','month',1),'2027-01-31');
 assert.equal(shiftDemoCalendar('2027-01-31','month',1),'2027-02-28');
 assert.equal(shiftDemoCalendar('2026-11-07','day',-1),'2026-11-06');
 assert.equal(shiftDemoCalendar('2026-11-07','agenda',1),'2026-11-14');
});

test('trial scheduling mutates only its own synthetic dataset, respects remaining quantities and cancelled trips',()=>{
 const data=makeShipmentDemo('2026-11-07'),fresh=makeShipmentDemo('2026-11-07'),l=data.lines.find((l:any)=>l.id==='demo-l3');
 const created=addDemoShipment(data,l.id,{date:'2026-11-08',qty:20});
 assert.equal(created.time,'Chưa xác định giờ');assert.equal(lineFacts(data,l).available,40);assert.equal(lineFacts(data,l).remaining,60,'scheduled is not delivered');
 assert.equal(lineFacts(fresh,fresh.lines.find((x:any)=>x.id===l.id)).available,60);
 for(const change of [{date:'2026-11-08',qty:41},{date:'2026-11-06',qty:1},{date:'2026-02-30',qty:1},{date:'invalid',qty:1},{date:'2026-11-08',qty:0},{date:'2026-11-08',qty:1,time:'x'.repeat(81)}]){
  const before=JSON.stringify(data);assert.throws(()=>addDemoShipment(data,l.id,change));assert.equal(JSON.stringify(data),before);
 }
 created.status='cancelled';assert.equal(lineFacts(data,l).available,60);
 assert.ok(data.orders.every((o:any)=>o.id.startsWith('demo-')));assert.ok(data.shipments.every((s:any)=>s.id.startsWith('demo-')));
});
