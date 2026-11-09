import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestDb} from '../helpers/postgres.ts';
const migration=readFileSync(new URL('../../migrations/postgres/20261109123446_sepay_lock_web_match.sql',import.meta.url),'utf8').replaceAll('--> statement-breakpoint','');
const check=readFileSync(new URL('../../scripts/sql/assert-sepay-web.sql',import.meta.url),'utf8');
test('web bank target migration is repeatable, asserts RLS/index and prevents dual targets or two matched providers',async()=>{
 const {client}=await createTestDb();
 await client.exec(migration);await client.exec(migration);await client.exec(check);
 const insert=(id:string,status:string,order='NULL')=>`insert into sepay_transactions(id,provider_id,transfer_type,amount,account_number,transaction_at,content,status,reason,web_order_id,order_id,payload,received_at) values('${id}','${id}','in',100000,'123456','2026-11-08T03:00:00Z','DH21661','${status}','','web-test',${order},'{}','2026-11-08T03:00:00Z')`;
 await client.exec(insert('first','matched'));
 await client.exec(insert('review','review'));
 await assert.rejects(client.exec(insert('second','matched')),/uq_sepay_web_matched|duplicate key/);
 await assert.rejects(client.exec(insert('dual','review',"'crm-test'")),/chk_sepay_one_target|check constraint/);
 await client.exec(check);
});
