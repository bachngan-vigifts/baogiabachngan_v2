import test from 'node:test';
import assert from 'node:assert/strict';
import {customerPurchaseSuppliersFixture} from '../helpers/customer-purchase-suppliers-fixture.ts';
import {purchaseHistory} from '../../src/modules/customer-hub/domain/overview.ts';

test('purchase history retains all unique supplier names without changing amounts or grouping',()=>{
 const line={sku:'A',name:'Ly',unit:'Cái',qty:2,unitPrice:10,amount:20,orderId:'o1',orderDate:'2026-11-01'};
 const [row]=purchaseHistory([{...line,supplierNames:['NCC A',' NCC B ','']},{...line,sku:'a',orderId:'o2',supplierNames:['NCC A']}]);
 assert.deepEqual(row!.supplierNames,['NCC A','NCC B']);assert.equal(row!.qty,4);assert.equal(row!.orders,2);assert.equal(row!.amount,40);
 assert.deepEqual(purchaseHistory([line])[0]!.supplierNames,[]);
});

test('overview suppliers follow explicit order/quote + SKU links and purchasing visibility',async()=>{
 const f=await customerPurchaseSuppliersFixture();
  const get=async(cookie:string)=>{const r=await f.call(`/customers/${f.id}/overview`,cookie);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
  const own=await get(f.emp),row=own.purchases.find((p:any)=>p.sku==='TUIGIAY');
  assert.ok(own.contracts.some((k:any)=>k.orderId==='h-two'&&k.status==='signed'),'history includes signed contract order');
  assert.deepEqual(row.supplierNames,['NCC B <Kiểm thử>','NCC Bao bì A'].sort((a,b)=>a.localeCompare(b,'vi')));
  assert.equal(row.orders,2);assert.equal(row.qty,1600);assert.equal(row.amount,16000000);
  assert.deepEqual(own.purchases.find((p:any)=>p.sku==='KHAC').supplierNames,[]);
  const manager=await get(f.mgr),all=manager.purchases.find((p:any)=>p.sku==='TUIGIAY').supplierNames;
  for(const name of ['NCC Bao bì A','NCC B <Kiểm thử>','NCC Nháp riêng Manager'])assert.ok(all.includes(name),name);
  for(const name of ['NCC Đơn mua đã hủy','NCC Sai mã','NCC Đơn bán nháp','NCC Đơn bán hủy','NCC Đơn bán ngoài quyền','NCC Sai nguồn'])assert.ok(!all.includes(name),name);
  assert.deepEqual((await get(f.other)).purchases,[],'employee without visible sales orders receives no suppliers');
  assert.equal((await f.call(`/customers/${f.id}/overview`,f.ncc)).status,403);
  assert.equal((await f.call(`/customers/${f.id}/overview`)).status,401);
  assert.deepEqual(Object.keys(row).sort(),['sku','name','unit','qty','amount','orders','lastDate','lastPrice','supplierNames'].sort(),'no supplier prices or payment details');
});
