import assert from 'node:assert/strict';
import test from 'node:test';
import { setupSepay } from '../helpers/sepay-fixture.ts';
import { sepayTransactions } from '../../src/modules/integrations/schema.ts';
import { customerPayments } from '../../src/modules/sales/schema.ts';

test('SePay waybill route is Manager-only and reads provider without creating receipts',async()=>{
 const f=await setupSepay(), event=await f.incoming('fixture lookup, no automatic match');
 let calls=0;
 f.env.ghnMlToken='fixture-only';
 f.env.ghnMlShopId='321';
 f.env.ghnFetch=async()=>{
  calls++;
  return Response.json({code:200,data:{order_code:'DEMO123',shop_id:321,status:'delivered',cod_amount:12345}});
 };
 const path='/sepay/transactions/'+event.id;
 const query='/ghn-waybill?shop=minh-long&code=DEMO123';
 assert.equal((await f.call(path+query,f.emp)).status,403);
 assert.equal((await f.call(path+query,f.accountant)).status,403);
 assert.equal((await f.call('/sepay/transactions/'+crypto.randomUUID()+query,f.mgr)).status,404);
 assert.equal(calls,0);
 assert.equal((await f.call(path+'/allocations',f.mgr)).data.canLookupGhn,true);
 const before={payments:await f.db.select().from(customerPayments),bank:await f.db.select().from(sepayTransactions)};
 const result=await f.call(path+query,f.mgr);
 assert.equal(result.status,200,JSON.stringify(result.data));
 assert.equal(result.data.code,'DEMO123');
 assert.equal(calls,1);
 assert.deepEqual(await f.db.select().from(customerPayments),before.payments);
 assert.deepEqual(await f.db.select().from(sepayTransactions),before.bank);
});
