import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
import {readFileSync} from 'node:fs';
import {bundleProductCustody,CUSTODY_CONTRACT_OUT} from '../../scripts/build-trial-ui.ts';
import {eq,sql} from 'drizzle-orm';
import {setupCustody as fixture} from '../helpers/product-custody-fixture.ts';
import {customers,customerStaff} from '../../src/modules/customers/schema.ts';
import {custodyTickets,custodyEvents} from '../../src/modules/product-custody/schema.ts';
import {custodyDeadline,custodyToday,validCustodyDate} from '../../src/modules/product-custody/domain/custody.ts';
const today=()=>custodyToday(),body=(kind='warranty')=>({clientKey:crypto.randomUUID(),kind,supplierId:kind==='warranty'?'a':undefined,customerId:kind==='sample'?'custody-customer':undefined,responsibleId:'emp',startDate:today(),dueDate:today(),issue:'Nứt men',lines:[{sku:'031106000',qty:3,conditionOut:'Giao đủ, đã chụp tình trạng'}]});
test('custody UI contract bundle stays aligned with server domain',()=>{assert.equal(readFileSync(CUSTODY_CONTRACT_OUT,'utf8'),bundleProductCustody());});
test('custody date boundary uses Vietnam and stops warning when physical return is complete',()=>{
 assert.equal(custodyToday(new Date('2026-11-07T17:05:00Z')),'2026-11-08');assert.equal(validCustodyDate('2026-02-30'),false);
 assert.equal(custodyDeadline('borrowed','2026-11-07','2026-11-07').overdue,false);assert.equal(custodyDeadline('borrowed','2026-11-06','2026-11-07').overdue,true);assert.equal(custodyDeadline('returned','2026-11-06','2026-11-07').overdue,false);assert.equal(custodyDeadline('sent','2026-11-10','2026-11-07').dueSoon,true);assert.equal(custodyDeadline('sent','2026-11-11','2026-11-07').dueSoon,false);
});
test('custody creates idempotently, enforces order, records partial returns and never changes stock',async()=>{
 const f=await fixture(),movesBefore=await f.db.execute(sql`select * from stock_moves order by id`),before=await f.db.execute(sql`select sku,warehouse_id,qty from stock_balances order by sku,warehouse_id`),b=body(),created=f.ok(await f.call('/product-custody',f.cookies.emp,'POST',b),201),id=created.ticket.id;
 assert.match(created.ticket.ticketNumber,/^BH_001_\d{8}$/);assert.equal(created.ticket.status,'pending');assert.equal(f.ok(await f.call('/product-custody',f.cookies.emp,'POST',b),201).ticket.id,id);
 assert.equal((await f.call('/product-custody',f.cookies.emp,'POST',{...b,note:'changed'})).status,409);
 const act=(p:unknown)=>f.call('/product-custody/'+id+'/actions',f.cookies.emp,'POST',p);
 assert.equal((await act({clientKey:crypto.randomUUID(),revision:1,action:'status',status:'completed',date:today(),result:'Xong'})).status,400);
 const sent=f.ok(await act({clientKey:crypto.randomUUID(),revision:1,action:'status',status:'sent',date:today()}));assert.equal(sent.ticket.sentDate,today());
 const line=sent.ticket.lines[0],partial={clientKey:crypto.randomUUID(),revision:2,action:'receive',date:today(),lines:[{id:line.id,qty:1,condition:'Đã sửa, đạt'}]};
 const received=f.ok(await act(partial));assert.equal(received.ticket.status,'sent');assert.equal(received.ticket.lines[0].returnedQty,1);assert.equal(f.ok(await act(partial)).ticket.lines[0].returnedQty,1);
 assert.equal((await act({...partial,clientKey:crypto.randomUUID(),revision:3,lines:[{id:line.id,qty:3,condition:'Đạt'}]})).status,400);
 assert.equal((await act({...partial,clientKey:crypto.randomUUID(),revision:2})).status,409);
 const full=f.ok(await act({...partial,clientKey:crypto.randomUUID(),revision:3,lines:[{id:line.id,qty:2,condition:'Đạt'}]}));assert.equal(full.ticket.status,'returned');assert.equal(full.ticket.returnedDate,today());
 const done=f.ok(await act({clientKey:crypto.randomUUID(),revision:4,action:'status',status:'completed',date:today(),result:'NCC đã thay mới'}));assert.equal(done.ticket.status,'completed');assert.equal(done.history.length,5);assert.equal((await f.db.select().from(custodyEvents).where(eq(custodyEvents.ticketId,id))).length,5);
 assert.deepEqual(await f.db.execute(sql`select sku,warehouse_id,qty from stock_balances order by sku,warehouse_id`),before);assert.deepEqual(await f.db.execute(sql`select * from stock_moves order by id`),movesBefore);
});
test('custody checks staff permission and record scope on list, detail, mutations, options and party access',async()=>{
 const f=await fixture(),created=f.ok(await f.call('/product-custody',f.cookies.emp,'POST',body('sample')),201),id=created.ticket.id;
 assert.equal(created.ticket.status,'borrowed');assert.equal((await f.call('/product-custody')).status,401);assert.equal((await f.call('/product-custody',f.cookies.ncc)).status,403);
 assert.equal(f.ok(await f.call('/product-custody',f.cookies.sa)).total,0);assert.equal((await f.call('/product-custody/'+id,f.cookies.sa)).status,404);
 assert.equal((await f.call('/product-custody/'+id+'/actions',f.cookies.sa,'POST',{})).status,404);assert.equal((await f.call('/product-custody/'+id+'/photos',f.cookies.sa,'POST',{})).status,404);
 assert.equal(f.ok(await f.call('/product-custody',f.cookies.mgr)).total,1);assert.equal((await f.call('/product-custody',f.cookies.emp,'POST',{...body(),responsibleId:'sa'})).status,403);
 await f.db.delete(customerStaff).where(eq(customerStaff.customerId,'custody-customer'));assert.equal((await f.call('/product-custody',f.cookies.emp,'POST',body('sample'))).status,403);
 assert.equal(f.ok(await f.call('/product-custody/options?type=customers',f.cookies.emp)).items.length,0);
 await f.db.execute(sql`delete from staff_position_permissions where position_id='sale' and permission='page.product-custody'`);assert.equal((await f.call('/product-custody',f.cookies.emp)).status,403);assert.equal((await f.call('/product-custody/'+id,f.cookies.emp)).status,403);
});
test('custody filters are server-side, summaries scoped, header revision tracked, customer merge retains references',async()=>{
 const f=await fixture(),created=f.ok(await f.call('/product-custody',f.cookies.emp,'POST',body('sample')),201),id=created.ticket.id;
 const result=f.ok(await f.call('/product-custody?metric=sample&q=tra&sku=031106000',f.cookies.emp));assert.equal(result.total,1);assert.equal(result.summary.sample,1);
 assert.equal(f.ok(await f.call('/product-custody?partyText=khongco',f.cookies.emp)).total,0);assert.equal((await f.call('/product-custody?from=2026-02-30',f.cookies.emp)).status,400);
 const edit=f.ok(await f.call('/product-custody/'+id+'/actions',f.cookies.emp,'POST',{clientKey:crypto.randomUUID(),revision:1,action:'update',date:today(),dueDate:today(),headerNote:'Hẹn lại',note:'Khách xác nhận'}));assert.equal(edit.ticket.revision,2);assert.equal(edit.ticket.note,'Hẹn lại');
 await f.db.update(customers).set({taxCode:'999TEST'}).where(eq(customers.id,'custody-customer'));await f.db.insert(customers).values({id:'keeper',name:'Khách giữ lại',taxCode:'999TEST',contact:'',phone:'',email:'',address:'',search:'keeper',approvalStatus:'approved',sourceVersion:0,syncedAt:''});
 f.ok(await f.call('/customer-duplicates/merge',f.cookies.mgr,'POST',{keepId:'keeper',dropIds:['custody-customer']}));const [ticket]=await f.db.select().from(custodyTickets).where(eq(custodyTickets.id,id));assert.equal(ticket!.customerId,'keeper');
});

test('custody photos stay private, validate bytes and remove uploads when record persistence is rejected',async()=>{
 const f=await fixture(),created=f.ok(await f.call('/product-custody',f.cookies.emp,'POST',body()),201),id=created.ticket.id;
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
 assert.equal((await f.call('/product-custody/'+id+'/photos',f.cookies.emp,'POST',{image:png.replace('image/png','image/jpeg')})).status,400);assert.equal(f.files.files.size,0);
 const upload=f.ok(await f.call('/product-custody/'+id+'/photos',f.cookies.emp,'POST',{image:png}),201);assert.equal(upload.photos.length,1);assert.equal(f.files.files.size,1);assert.ok(upload.photos[0].url.startsWith('data:image/png'));assert.ok(!('storageKey'in upload.photos[0]));
 assert.equal((await f.call('/product-custody/'+id,f.cookies.sa)).status,404);
 const original=f.files.put.bind(f.files);f.files.put=async(...args)=>{await original(...args);await f.db.update(custodyTickets).set({createdBy:'sa',responsibleId:'sa'}).where(eq(custodyTickets.id,id));};
 assert.equal((await f.call('/product-custody/'+id+'/photos',f.cookies.emp,'POST',{image:png})).status,404);assert.equal(f.files.files.size,1,'failed upload must not leave a second object');
});

test('multi-product sample returns only finish when every line is returned; assignment and overdue summaries stay scoped',async()=>{
 const f=await fixture(),{products}=await import('../../src/modules/catalog/schema.ts');await f.db.insert(products).values({sku:'CUSTODY-2',name:'Mẫu thứ hai',unit:'Cái',updatedAt:new Date().toISOString()});
 const yesterday=new Date(Date.now()-86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}),b={...body('sample'),startDate:yesterday,dueDate:yesterday,lines:[...body('sample').lines,{sku:'CUSTODY-2',qty:1,conditionOut:'Mới'}]},created=f.ok(await f.call('/product-custody',f.cookies.emp,'POST',b),201),id=created.ticket.id;
 assert.equal(created.ticket.overdue,true);assert.equal(f.ok(await f.call('/product-custody?metric=overdue',f.cookies.emp)).total,1);assert.equal(f.ok(await f.call('/product-custody?metric=overdue',f.cookies.sa)).total,0);
 const first=created.ticket.lines.find((l:any)=>l.sku==='031106000'),second=created.ticket.lines.find((l:any)=>l.sku==='CUSTODY-2'),receive=(revision:number,items:unknown[])=>({clientKey:crypto.randomUUID(),revision,action:'receive',date:today(),lines:items});
 const partial=f.ok(await f.call('/product-custody/'+id+'/actions',f.cookies.emp,'POST',receive(1,[{id:first.id,qty:3,condition:'Đủ'}])));assert.equal(partial.ticket.status,'borrowed');assert.equal(partial.ticket.returnedDate,null);assert.equal(partial.ticket.overdue,true);
 assert.equal((await f.call('/product-custody/'+id+'/actions',f.cookies.emp,'POST',receive(2,[{id:second.id,qty:1,condition:'Đủ'},{id:second.id,qty:0,condition:''}]))).status,400);
 assert.equal((await f.call('/product-custody/'+id+'/actions',f.cookies.emp,'POST',{clientKey:crypto.randomUUID(),revision:2,action:'update',responsibleId:'sa',date:today()})).status,403);
 f.ok(await f.call('/product-custody/'+id+'/actions',f.cookies.mgr,'POST',{clientKey:crypto.randomUUID(),revision:2,action:'update',responsibleId:'sa',date:today(),note:'Phân công tiếp nhận'}));
 assert.ok(f.ok(await f.call('/product-custody/options',f.cookies.emp)).owners.some((owner:any)=>owner.id==='sa'),'creator can filter assigned-away tickets without granting reassignment');
 const done=f.ok(await f.call('/product-custody/'+id+'/actions',f.cookies.sa,'POST',receive(3,[{id:second.id,qty:1,condition:'Nguyên vẹn'}])));assert.equal(done.ticket.status,'returned');assert.equal(done.ticket.overdue,false);assert.equal(f.ok(await f.call('/product-custody?metric=overdue',f.cookies.emp)).total,0);assert.equal((await f.call('/product-custody/'+id,f.cookies.kho)).status,404);
});
test('warranty can record supplier processing then actual customer delivery with required result',async()=>{
 const f=await fixture(),created=f.ok(await f.call('/product-custody',f.cookies.emp,'POST',{...body(),customerId:'custody-customer'}),201),id=created.ticket.id;
 const act=(revision:number,status:string)=>f.call('/product-custody/'+id+'/actions',f.cookies.emp,'POST',{clientKey:crypto.randomUUID(),revision,action:'status',status,date:today()});
 f.ok(await act(1,'sent'));f.ok(await act(2,'processing'));const returned=f.ok(await f.call('/product-custody/'+id+'/actions',f.cookies.emp,'POST',{clientKey:crypto.randomUUID(),revision:3,action:'receive',date:today(),result:'Đã thay mới',lines:[{id:created.ticket.lines[0].id,qty:3,condition:'Đạt kiểm tra'}]}));assert.equal(returned.ticket.customerName,'Khách mượn mẫu');
 const delivered=f.ok(await act(4,'delivered'));assert.equal(delivered.ticket.deliveredDate,today());assert.equal(delivered.ticket.result,'Đã thay mới');assert.equal((await act(5,'sent')).status,400);
});

test('administrative rescheduling does not prevent recording an earlier physical return date',async()=>{
 const f=await fixture(),yesterday=new Date(Date.now()-86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}),created=f.ok(await f.call('/product-custody',f.cookies.emp,'POST',{...body('sample'),startDate:yesterday,dueDate:today()}),201),id=created.ticket.id;
 f.ok(await f.call('/product-custody/'+id+'/actions',f.cookies.emp,'POST',{clientKey:crypto.randomUUID(),revision:1,action:'update',date:today(),dueDate:today(),note:'Bổ sung thông tin hôm nay'}));
 const returned=f.ok(await f.call('/product-custody/'+id+'/actions',f.cookies.emp,'POST',{clientKey:crypto.randomUUID(),revision:2,action:'receive',date:yesterday,lines:[{id:created.ticket.lines[0].id,qty:3,condition:'Nhận đủ hôm qua'}]}));assert.equal(returned.ticket.returnedDate,yesterday);
});
