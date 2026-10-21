import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setup} from '../helpers/pos-fixture.ts';
import {webStoreOrders} from '../../src/modules/sales/pos-schema.ts';
test('Migration bổ sung mặc định {} cho đơn cũ, không đổi tổng, phí GHN và RLS',async()=>{
 const f=await setup();
 // Isolated PGlite only: model the schema immediately before the new column.
 await f.client.exec('ALTER TABLE web_store_orders DROP COLUMN financial_snapshot');
 await f.client.query("INSERT INTO web_store_orders(id,source,external_id,order_no,register_id,status,total,ghn_fee,ordered_at,updated_at) VALUES('old-web','lock','old-web','OLD-WEB',$1,'processing',38390020,32000,'2026-10-20','2026-10-20')",[f.registerId]);
 await f.client.exec(readFileSync(new URL('../../migrations/postgres/20261021035601_web_order_financial_snapshot.sql',import.meta.url),'utf8'));
 const [o]=await f.db.select().from(webStoreOrders);assert.equal(o!.financialSnapshot,'{}');assert.equal(o!.total,38390020);assert.equal(o!.ghnFee,32000);
 const r=await f.client.query<{relrowsecurity:boolean}>("SELECT relrowsecurity FROM pg_class WHERE oid='web_store_orders'::regclass");assert.equal(r.rows[0]!.relrowsecurity,true);
});
