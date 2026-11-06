import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
import {sql,eq} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {customers,customerStaff} from '../../src/modules/customers/schema.ts';
import {employees} from '../../src/modules/staff/schema.ts';
import {customerProvince,PROVINCES,provinceOptions} from '../../src/modules/customers/domain/province.ts';
import {provinceCodeSql} from '../../src/modules/customers/api/province.ts';

const addresses=['12 Đường ABC, Rạch Giá, Kiên Giang','Ấp XYZ, Sóc Trăng','10 ABC, Bến Tre, Việt Nam','12 Đường An Giang, phường ABC, Cần Thơ','12 Đường An Giang','Phường An Giang','123 ABC, tỉnh An Giang, TP Cần Thơ','123 ABC, TP.HCM','123 ABC, Bà Rịa - Vũng Tàu','123 ABC, Ha Noi, Vietnam','123 ABC','', '12 ABC, Thừa Thiên-Huế','123 ABC, tỉnh Khánh Hòa 650000, Việt Nam', '12 ABC\nKiên Giang'];
test('34 merged provinces map all old names; street names, missing and conflicting provinces stay unknown',()=>{
 assert.equal(PROVINCES.length,34);assert.equal(new Set(provinceOptions.map(p=>p.code)).size,34);
 for(const [code,name,aliases] of PROVINCES)for(const alias of [name,...aliases])assert.equal(customerProvince('12 ABC, Tỉnh '+alias)?.code,code,alias);
 const names=['An Giang','Cần Thơ','Vĩnh Long','Cần Thơ',null,null,null,'Hồ Chí Minh','Hồ Chí Minh','Hà Nội',null,null,'Huế','Khánh Hòa','An Giang'];
 addresses.forEach((a,i)=>assert.equal(customerProvince(a)?.name??null,names[i],a));
 assert.equal(customerProvince('10 ABC, Tỉnh KIÊN GIANG'.normalize('NFD'))?.code,'91');
});
async function seed(){
 const f=await setup(),stamp=new Date().toISOString();
 await f.db.delete(customerStaff);
 const rows=addresses.map((address,i)=>({id:'prov-'+String(i).padStart(3,'0'),name:'Khách tỉnh '+i,contact:'Liên hệ giả',phone:'',email:'',address,search:'khach tinh '+i,sourceVersion:1,syncedAt:stamp}));
 await f.db.insert(customers).values(rows);
 return {...f,rows};
}
test('database province filtering matches the detail parser, includes old addresses before pagination and rejects invalid filters',async()=>{
 const f=await seed();
 const rows=await f.db.select({address:customers.address,code:provinceCodeSql(customers.address)}).from(customers);
 for(const r of rows)assert.equal(r.code,customerProvince(r.address)?.code??null,r.address);
 const first=await f.call('/customers?province=92&limit=1&filters=1',f.mgr);assert.equal(first.status,200);assert.equal(first.data.total,2);assert.equal(first.data.customers.length,1);assert.equal(first.data.customers[0].province.name,'Cần Thơ');assert.equal(first.data.filterOptions.provinces.length,34);assert.equal(first.data.nextOffset,1);
 const next=await f.call('/customers?province=92&limit=1&offset=1',f.mgr);assert.equal(next.data.total,2);assert.notEqual(next.data.customers[0].id,first.data.customers[0].id);
 const unknown=await f.call('/customers?province=unknown&limit=500',f.mgr);assert.ok(unknown.data.customers.every((c:any)=>!c.province));
 assert.equal((await f.call('/customers?province=92%27%20OR%20true',f.mgr)).status,400);
 const detail=await f.call('/customers/prov-000',f.mgr);assert.equal(detail.data.customer.province.name,'An Giang');
 await f.db.update(customers).set({address:'12 ABC, Tiền Giang'}).where(eq(customers.id,'prov-000'));
 assert.equal((await f.call('/customers/prov-000',f.mgr)).data.customer.province.name,'Đồng Tháp');
});
test('bulk share previews all approved customers in one province and adds rights without replacing owners/existing shares; retries are idempotent',async()=>{
 const f=await seed(),stamp=new Date().toISOString();
 await f.db.update(customers).set({isRetail:true}).where(eq(customers.id,'prov-003'));
 await f.db.insert(customers).values({id:'pending-province',name:'Khách chờ',contact:'',phone:'',email:'',address:'Sóc Trăng',search:'',sourceVersion:1,syncedAt:stamp,approvalStatus:'pending'});
 await f.db.insert(customerStaff).values([{customerId:'prov-001',memberId:'emp',role:'owner',createdAt:stamp},{customerId:'prov-001',memberId:'old',role:'shared',createdAt:stamp}]);
 const body={province:'92',memberIds:['emp','new']};
 const preview=await f.call('/customers/province-sharing/preview',f.mgr,'POST',body);assert.equal(preview.status,200,JSON.stringify(preview.data));assert.equal(preview.data.total,2);assert.equal(preview.data.addedShares,3);
 assert.equal((await f.db.select().from(customerStaff)).length,2,'preview never grants access');
 const apply=await f.call('/customers/province-sharing/apply',f.mgr,'POST',{...body,version:preview.data.version});assert.equal(apply.status,200,JSON.stringify(apply.data));assert.equal(apply.data.addedShares,3);
 const attached=await f.db.select().from(customerStaff);assert.equal(attached.length,5);assert.equal(attached.find(r=>r.customerId==='prov-001'&&r.memberId==='emp')?.role,'owner');assert.ok(attached.some(r=>r.memberId==='old'));assert.ok(attached.every(r=>['prov-001','prov-003'].includes(r.customerId)));
 assert.equal((await f.call('/customers/prov-003',f.emp)).data.access.canEditProfile,true);
 const again=await f.call('/customers/province-sharing/apply',f.mgr,'POST',{...body,version:preview.data.version});assert.equal(again.status,200);assert.equal(again.data.addedShares,0);assert.equal((await f.db.select().from(customerStaff)).length,5);
});
test('bulk share rejects employees, inactive/supplier targets, unknown provinces and stale previews without partial writes',async()=>{
 const f=await seed(),path='/customers/province-sharing/',body={province:'92',memberIds:['new']};
 assert.equal((await f.call(path+'preview',f.emp,'POST',body)).status,403);assert.equal((await f.call(path+'apply',f.emp,'POST',body)).status,403);
 for(const memberIds of [[],['off'],['ncc'],['missing']])assert.equal((await f.call(path+'preview',f.mgr,'POST',{...body,memberIds})).status,400);
 assert.equal((await f.call(path+'preview',f.mgr,'POST',{...body,province:'unknown'})).status,400);
 assert.equal((await f.call(path+'apply',f.mgr,'POST',body)).status,409);
 const preview=await f.call(path+'preview',f.mgr,'POST',body);
 await f.db.update(customers).set({address:'10 ABC, Vĩnh Long'}).where(eq(customers.id,'prov-001'));
 assert.equal((await f.call(path+'apply',f.mgr,'POST',{...body,version:preview.data.version})).status,409);
 assert.equal((await f.db.select().from(customerStaff)).length,0);
});

test('one customer at the sharing limit blocks the entire batch without granting any other customer',async()=>{
 const f=await seed(),stamp=new Date().toISOString();
 const people=Array.from({length:30},(_,i)=>({id:'extra-'+i,name:'Nhân viên giả '+i,email:'extra'+i+'@example.test',role:'employee' as const,positionId:'sale',createdAt:stamp}));
 await f.db.insert(employees).values(people);
 await f.db.insert(customerStaff).values(people.map(p=>({customerId:'prov-001',memberId:p.id,role:'shared' as const,createdAt:stamp})));
 const b={province:'92',memberIds:['new']};
 assert.equal((await f.call('/customers/province-sharing/preview',f.mgr,'POST',b)).status,409);
 assert.equal((await f.db.select().from(customerStaff).where(eq(customerStaff.memberId,'new'))).length,0);
});
