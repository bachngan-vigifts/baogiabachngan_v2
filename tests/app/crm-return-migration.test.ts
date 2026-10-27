import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setupCrmReturns} from '../helpers/crm-return-fixture.ts';
import {salesContracts} from '../../src/modules/sales/schema.ts';
import {posReturns} from '../../src/modules/sales/return-schema.ts';
const migration=readFileSync(new URL('../../migrations/postgres/20261027040000_crm_returns.sql',import.meta.url),'utf8');

test('deploy applies CRM return migration before the Edge Function is replaced',()=>{
 const workflow=readFileSync(new URL('../../.github/workflows/deploy-api.yml',import.meta.url),'utf8');
 const at=workflow.indexOf('$(<migrations/postgres/20261027040000_crm_returns.sql)');
 assert.ok(at>0);assert.ok(at<workflow.indexOf('run: supabase functions deploy'));
});

test('legacy production schema reproduces orders/contracts 500; migration restores lists/details, retains POS history, and replays safely',async()=>{
 const f=await setupCrmReturns();await f.seed('regular');await f.seed('contract');const at=new Date().toISOString();
 await f.db.insert(salesContracts).values({id:'contract',orderId:'contract',contractNo:'TEST-MIGRATION',legalEntity:'BN',status:'signed',signedDate:'2026-10-27',value:4372250,createdBy:'mgr',createdAt:at,updatedAt:at});
 const shift=await f.open(f.mgr);const order=f.ok(await f.call('/pos/checkout',f.mgr,'POST',f.cart(shift.id)),201);
 await f.db.insert(posReturns).values({id:'legacy',returnNo:'LEGACY-RETURN',orderId:order.id,registerId:f.registerId,warehouseId:'pos-wh',createdShiftId:shift.id,kind:'return',status:'pending',reason:'Legacy fixture',sourceSnapshot:'{}',requestKey:'legacy',createdBy:'mgr',createdAt:at,updatedAt:at});
 const before=(await f.client.query('select to_jsonb(r)-\'source\' as data from pos_returns r')).rows;
 const stockBefore=(await f.client.query('select * from stock_moves order by id')).rows;
 await f.client.exec('ALTER TABLE pos_returns DROP CONSTRAINT chk_return_source; ALTER TABLE pos_refunds DROP CONSTRAINT chk_refund_cash_shift; ALTER TABLE pos_returns ALTER COLUMN register_id SET NOT NULL; ALTER TABLE pos_returns ALTER COLUMN created_shift_id SET NOT NULL; ALTER TABLE pos_refunds ALTER COLUMN shift_id SET NOT NULL; ALTER TABLE pos_returns DROP COLUMN source;');
 for(const path of ['/orders?flow=order','/contracts','/orders/regular','/orders/contract'])assert.equal((await f.call(path,f.mgr)).status,500,path);
 await f.client.exec(migration);await f.client.exec(migration);
 for(const path of ['/orders?flow=order','/contracts','/orders/regular','/orders/contract']){const r=await f.call(path,f.mgr);assert.equal(r.status,200,path+JSON.stringify(r.data));}
 assert.deepEqual((await f.client.query('select to_jsonb(r)-\'source\' as data from pos_returns r')).rows,before);
 assert.deepEqual((await f.client.query('select * from stock_moves order by id')).rows,stockBefore);
 assert.equal((await f.client.query<{source:string}>('select source from pos_returns')).rows[0]!.source,'pos');
 await assert.rejects(f.client.exec("update pos_returns set register_id=null where id='legacy'"),/chk_return_source/);
 await assert.rejects(f.client.exec("update pos_returns set source='unknown' where id='legacy'"),/chk_return_source/);
 const rls=await f.client.query<{relrowsecurity:boolean}>("select relrowsecurity from pg_class where oid='pos_returns'::regclass");assert.equal(rls.rows[0]!.relrowsecurity,true);
});
