// CHẶN GHI ĐÈ HỒ SƠ KHÁCH HÀNG (kiểm toán CRM 21/11 – ưu tiên 2).
// Hai máy cùng mở một khách: A đổi địa chỉ rồi lưu; B sửa điện thoại từ bản cũ → trước đây ghi đè địa chỉ của A.
// Sau: hồ sơ có profileRevision (trigger CSDL tự tăng khi bất kỳ ô hồ sơ nào đổi, từ mọi đường ghi);
// PUT /customers/:id kèm profileRevision cũ → 409 CUSTOMER_PROFILE_CONFLICT, không ghi gì.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq,sql} from 'drizzle-orm';
import {customerPurchaseSuppliersFixture} from '../helpers/customer-purchase-suppliers-fixture.ts';
import {customers} from '../../src/modules/customers/schema.ts';

type F=Awaited<ReturnType<typeof customerPurchaseSuppliersFixture>>;
const open=async(f:F,cookie:string)=>{const r=await f.call('/customers/'+f.id+'?refresh=1',cookie);assert.equal(r.status,200,JSON.stringify(r.data));return r.data.customer;};
const form=(c:any,change:Record<string,unknown>={})=>({name:c.name,contact:c.contact,phone:c.phone,email:c.email,address:c.address,taxCode:c.taxCode,customerCode:c.customerCode,
 customerType:c.customerType??'',depositRate:c.depositRate??'',paymentTerm:c.paymentTerm??'',paymentDays:c.paymentDays??'',creditLimit:c.creditLimit??'',establishedDate:c.establishedDate??'',profileRevision:c.profileRevision,...change});
const row=async(f:F)=>(await f.db.select().from(customers).where(eq(customers.id,f.id)))[0]!;

test('hai máy cùng sửa: bản cũ bị từ chối 409, địa chỉ máy A không bị mất; mở lại bản mới thì lưu được cả hai thay đổi',async()=>{
 const f=await customerPurchaseSuppliersFixture();
 const a=await open(f,f.mgr),b=await open(f,f.emp);assert.equal(typeof a.profileRevision,'number');assert.equal(a.profileRevision,b.profileRevision);
 const savedA=await f.call('/customers/'+f.id,f.mgr,'PUT',form(a,{address:'12 Lý Tự Trọng, Cần Thơ'}));assert.equal(savedA.status,200,JSON.stringify(savedA.data));
 assert.equal(savedA.data.profileRevision,a.profileRevision+1);
 const savedB=await f.call('/customers/'+f.id,f.emp,'PUT',form(b,{phone:'0909111222'}));
 assert.equal(savedB.status,409,JSON.stringify(savedB.data));assert.equal(savedB.data.code,'CUSTOMER_PROFILE_CONFLICT');
 let now=await row(f);assert.equal(now.address,'12 Lý Tự Trọng, Cần Thơ','giữ địa chỉ của A');assert.notEqual(now.phone,'0909111222','B chưa ghi');
 const fresh=await open(f,f.emp);assert.equal(fresh.address,'12 Lý Tự Trọng, Cần Thơ');
 const retry=await f.call('/customers/'+f.id,f.emp,'PUT',form(fresh,{phone:'0909111222'}));assert.equal(retry.status,200,JSON.stringify(retry.data));
 now=await row(f);assert.deepEqual([now.address,now.phone],['12 Lý Tự Trọng, Cần Thơ','0909111222']);
});

test('phiên bản tăng theo mọi đường ghi ô hồ sơ (đồng bộ Sapo, lưu từ báo giá…), không tăng khi chỉ duyệt / đổi người đại diện',async()=>{
 const f=await customerPurchaseSuppliersFixture(),start=(await row(f)).profileRevision;
 // Đường ghi khác (vd. đồng bộ Sapo cập nhật tên/MST) đi thẳng vào bảng → trigger vẫn tăng phiên bản.
 await f.db.update(customers).set({name:'Tên mới từ Sapo',taxCode:'0312345678'}).where(eq(customers.id,f.id));
 assert.equal((await row(f)).profileRevision,start+1);
 await f.db.update(customers).set({approvalStatus:'approved',syncedAt:'2026-11-21T00:00:00Z',sourceVersion:99}).where(eq(customers.id,f.id));
 assert.equal((await row(f)).profileRevision,start+1,'không đổi ô hồ sơ → không tăng');
 // Không ghi tay được số phiên bản tuỳ ý.
 await f.db.execute(sql`update sapo_customers set profile_revision=0 where id=${f.id}`);assert.equal((await row(f)).profileRevision,start+1);
});

test('form mở trước khi Sapo đổi tên → lưu bị 409 (không ghi đè tên mới bằng tên cũ)',async()=>{
 const f=await customerPurchaseSuppliersFixture(),stale=await open(f,f.mgr);
 await f.db.update(customers).set({name:'Tên mới từ Sapo'}).where(eq(customers.id,f.id));
 const r=await f.call('/customers/'+f.id,f.mgr,'PUT',form(stale,{email:'moi@example.test'}));assert.equal(r.status,409);
 assert.equal((await row(f)).name,'Tên mới từ Sapo');
});

test('kiểm tra quyền vẫn ở máy chủ; phiên bản sai định dạng → 400; không gửi phiên bản (giao diện cũ) vẫn lưu như trước',async()=>{
 const f=await customerPurchaseSuppliersFixture(),c=await open(f,f.mgr);
 for(const bad of [-1,1.5,'abc',null])assert.equal((await f.call('/customers/'+f.id,f.mgr,'PUT',form(c,{profileRevision:bad}))).status,400,String(bad));
 const {profileRevision:_,...legacy}=form(c,{address:'Địa chỉ từ giao diện cũ'});
 const r=await f.call('/customers/'+f.id,f.mgr,'PUT',legacy);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal((await row(f)).address,'Địa chỉ từ giao diện cũ');
 const other=await f.call('/customers/history-other-customer',f.emp,'PUT',{name:'X',contact:'',phone:'',email:'',address:'',taxCode:'',customerCode:'',profileRevision:0});
 assert.ok([403,404].includes(other.status),'không phụ trách khách khác → không sửa được ('+other.status+')');
});

test('hai lần lưu cùng phiên bản gửi đồng thời → một lần thành công, lần kia 409 (PGlite tuần tự; PostgreSQL nhiều kết nối dùng TEST_PG_URL)',async()=>{
 const f=await customerPurchaseSuppliersFixture(),c=await open(f,f.mgr);
 const rs=await Promise.all([f.call('/customers/'+f.id,f.mgr,'PUT',form(c,{address:'A'})),f.call('/customers/'+f.id,f.emp,'PUT',form(c,{phone:'0909000111'}))]);
 assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);
});
