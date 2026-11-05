import { contractTest as test, assert } from '../TEST_TEMPLATE.ts';
import { prepareAppsheetBatches } from '../../src/modules/customers/domain/appsheet-export.ts';
import { customerInput } from '../../src/modules/customers/domain/customer-input.ts';
const mapping = () => ({appId:'demo',customersTable:'Khách',contactsTable:'Liên hệ',localOffset:'+07:00',dateOrder:'DMY',
  customer:{keyConfirmed:true,rowId:'ID',updatedAt:'Sửa lúc',createdAt:'Tạo lúc',fields:{name:'Tên',phone:'SĐT',approvalStatus:'Duyệt',establishedDate:'Thành lập',customerType:'Loại'}},
  contact:{keyConfirmed:true,rowId:'ID',customerRowId:'Khách ID',updatedAt:'Sửa lúc',fields:{name:'Tên',phone:'SĐT',isPrimary:'Chính'}}});
const customer = () => ({ID:'K1',Tên:'Khách mẫu','SĐT':'0901234567',Duyệt:'Đã duyệt','Sửa lúc':'05/11/2026 09:30','Tạo lúc':'01/02/2020','Thành lập':'03/04/2010',Loại:'Doanh nghiệp'});
const contact = () => ({ID:'L1','Khách ID':'K1',Tên:'Liên hệ mẫu','SĐT':'0912345678','Sửa lúc':'2026-11-05T10:00:00+07:00',Chính:'TRUE'});
test('AppSheet export mapping uses confirmed keys, explicit DMY/offset, preserves leading zeroes and references',()=>{
  const batches=prepareAppsheetBatches(mapping(),[customer()],[contact()]);assert.equal(batches.length,2);
  const c=batches[0]!.customers[0]!,l=batches[1]!.contacts[0]!;
  assert.equal(c.updatedAt,'2026-11-05T02:30:00.000Z');assert.equal(c.createdAt,'2020-01-31T17:00:00.000Z');
  assert.equal(c.fields.establishedDate,'2010-04-03');assert.equal(c.fields.phone,'0901234567');assert.equal(l.customerRowId,'K1');assert.equal(l.fields.isPrimary,true);
});
test('AppSheet export rejects unconfirmed keys, numeric phones, impossible/ambiguous dates and duplicate keys across batches',()=>{
  for(const mutate of [
    (m:any,c:any[])=>m.customer.keyConfirmed=false,(m:any,c:any[])=>c[0]['SĐT']=901234567,
    (m:any,c:any[])=>c[0]['Thành lập']='30/02/2020',(m:any,c:any[])=>m.dateOrder='ISO',
    (m:any,c:any[])=>c[0]['Sửa lúc']='2026-02-30T09:00:00+07:00',
    (m:any,c:any[])=>c[0]['Sửa lúc']='2026-11-05T25:00:00+07:00',
  ]){const m=mapping(),rows=[customer()];mutate(m,rows);assert.throws(()=>prepareAppsheetBatches(m,rows,[]));}
  const many=Array.from({length:201},(_,i)=>({...customer(),ID:'K'+i}));many[200]!.ID='K0';assert.throws(()=>prepareAppsheetBatches(mapping(),many,[]));
});
test('AppSheet export batches all rows in order and distinguishes omitted fields from explicit clears',()=>{
  const rows=Array.from({length:201},(_,i)=>({...customer(),ID:'K'+i}));
  const batches=prepareAppsheetBatches(mapping(),rows,[]);assert.deepEqual(batches.map(b=>b.customers.length),[200,1]);
  const c:any=customer();delete c['SĐT'];c.Loại=null;c['Thành lập']='';
  const value=prepareAppsheetBatches(mapping(),[c],[])[0]!.customers[0]!.fields;
  assert.ok(!Object.hasOwn(value,'phone'));assert.equal(value.customerType,null);assert.equal(value.establishedDate,null);
});
test('Customer classification may be edited without changing the retail segment; missing field is not cleared',()=>{
  assert.equal(customerInput({name:'Khách',customerType:' Nhà máy '}).terms.customerType,'Nhà máy');
  assert.ok(!Object.hasOwn(customerInput({name:'Khách'}).terms,'customerType'));
  assert.equal(customerInput({name:'Khách',customerType:''}).terms.customerType,null);
});
