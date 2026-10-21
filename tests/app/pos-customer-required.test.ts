import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../helpers/pos-fixture.ts';
import { eq } from 'drizzle-orm';
import { customers } from '../../src/modules/customers/schema.ts';
import { salesOrders, customerPayments } from '../../src/modules/sales/schema.ts';
import { posPaymentRequests } from '../../src/modules/sales/pos-schema.ts';

test('POS requires a real named customer for counter/COD/deposit/prepaid/QR, but permits anonymous cart previews', async()=>{
 const f=await setup(),s=await f.open();
 const body=f.cart(s.id,{customerId:''});
 assert.equal((await f.call('/pos/preview',f.emp,'POST',body)).status,200);
 for(const extra of [{},{fulfillmentMode:'cod'},{saleFlow:'deposit',initialAmount:10000},{saleFlow:'prepaid',initialAmount:194400}]){
   const r=await f.call('/pos/checkout',f.emp,'POST',{...body,...extra});
   assert.equal(r.status,400,JSON.stringify(r.data));assert.equal(r.data.code,'POS_CUSTOMER_REQUIRED');
 }
 const qr=await f.call('/pos/qr',f.emp,'POST',body);assert.equal(qr.status,400);assert.equal(qr.data.code,'POS_CUSTOMER_REQUIRED');
 assert.equal((await f.db.select().from(salesOrders)).length,0);assert.equal((await f.db.select().from(customerPayments)).length,0);assert.equal((await f.db.select().from(posPaymentRequests)).length,0);
 await f.db.update(customers).set({name:' KHÁCH LẺ '}).where(eq(customers.id,f.customerId));
 const generic=await f.call('/pos/checkout',f.emp,'POST',f.cart(s.id));assert.equal(generic.status,400);assert.equal(generic.data.code,'POS_CUSTOMER_REQUIRED');
 for(const name of ['Khách lẻ','Khách vãng lai'])assert.equal((await f.call('/pos/customers',f.emp,'POST',{name,phone:'0900000000'})).status,400);
 await f.db.update(customers).set({name:'Nguyễn Văn Nhận'}).where(eq(customers.id,f.customerId));
 const saved=await f.call('/pos/checkout',f.emp,'POST',f.cart(s.id));assert.equal(saved.status,201,JSON.stringify(saved.data));
 assert.equal((await f.db.select().from(salesOrders))[0]!.customerId,f.customerId);
});
