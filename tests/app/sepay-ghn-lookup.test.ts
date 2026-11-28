import assert from 'node:assert/strict';
import test from 'node:test';
import type {StaffEnv} from '../../src/modules/staff/api/auth-routes.ts';
import {assertSepayGhnLookup,readSepayGhnWaybill} from '../../src/modules/sales/api/sepay-ghn-lookup.ts';
import {LOCK_GHN_SHOP_ID} from '../../src/modules/sales/api/pos-ghn-account.ts';

test('GHN SePay lookup is Manager-only and invalid input never calls provider', async()=>{
  assert.doesNotThrow(()=>assertSepayGhnLookup('manager'));
  assert.throws(()=>assertSepayGhnLookup('employee'),{status:403});
  const env={ghnFetch:()=>{throw Error('unexpected fetch');}} as unknown as StaffEnv;
  await assert.rejects(readSepayGhnWaybill(env,'unknown','TEST123'),{status:400});
  await assert.rejects(readSepayGhnWaybill(env,'lock','https://invalid.example'),{status:400});
  await assert.rejects(readSepayGhnWaybill(env,'minh-long','TEST123'),{status:503});
});

test('lookup calls only GHN GET, with chosen account; returns allowlisted COD fields',async()=>{
  for(const [shop,key,shopId] of [['minh-long','fake-ml','654321'],['lock','fake-lock',LOCK_GHN_SHOP_ID]] as const){
    let calls=0;
    const env={ghnMlToken:'fake-ml',ghnMlShopId:'654321',ghnToken:'fake-lock',ghnFetch:async(input:unknown,init:RequestInit)=>{
      calls++;
      const url=new URL(String(input));
      assert.equal(url.origin,'https://online-gateway.ghn.vn');
      assert.equal(url.pathname,'/shiip/public-api/v2/shipping-order/detail');
      assert.equal(url.searchParams.get('order_code'),'TEST123');
      assert.equal(init.method,'GET'); assert.equal(init.redirect,'error'); assert.equal(init.body,undefined);
      const headers=new Headers(init.headers);
      assert.equal(headers.get('token'),key); assert.equal(headers.get('shopid'),shopId);
      return Response.json({code:200,data:{order_code:'TEST123',shop_id:Number(shopId),status:'delivered',
        client_order_code:'WEB-FAKE1',cod_amount:125000,is_cod_collected:true,is_cod_transferred:true,
        cod_transfer_date:'2026-11-17T10:35:00+07:00',to_phone:'hidden',total_fee:9000}});
    }} as unknown as StaffEnv; // No database or mutation hooks for this reader.
    assert.deepEqual(await readSepayGhnWaybill(env,shop,' test123 '),{
      code:'TEST123',shop,status:'delivered',clientOrderCode:'WEB-FAKE1',codAmount:125000,codCollected:true,
      codTransferred:true,codTransferDate:'2026-11-17T03:35:00.000Z'});
    assert.equal(calls,1);
  }
});
test('lookup rejects mismatched response or inaccessible waybill without returning provider details',async()=>{
  const make=(payload:unknown,status=200)=>({ghnToken:'fake',ghnFetch:async()=>Response.json(payload,{status})} as unknown as StaffEnv);
  await assert.rejects(readSepayGhnWaybill(make({code:200,data:{order_code:'TEST123',shop_id:555}}),'lock','TEST123'),{status:502});
  await assert.rejects(readSepayGhnWaybill(make({code:200,data:{order_code:'NOTIT'}}),'lock','TEST123'),{status:502});
  await assert.rejects(readSepayGhnWaybill(make({code:400,message:'sensitive provider details'},400),'lock','TEST123'),e=>e instanceof Error && !e.message.includes('sensitive') && 'status' in e && e.status===404);
});
