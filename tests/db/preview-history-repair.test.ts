import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestDb} from '../helpers/postgres.ts';
const read=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const repair=read('scripts/sql/repair-preview-missing-history.sql'),check=read('scripts/sql/assert-preview-history-baseline.sql');
const files=['20261019035500_web_store_orders.sql','20261019043000_web_store_order_ghn.sql','20261022204500_web_order_ghn_address.sql','20261026042035_inventory_adjustment_approval.sql'];
async function metadata(client:Awaited<ReturnType<typeof createTestDb>>['client']){
 await client.exec('CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[])');
}
test('manual Preview repair records exact existing DDL, is idempotent and leaves application schema/rows unchanged',async()=>{
 const {client}=await createTestDb();await metadata(client);
 // A sentinel in an unrelated application table must survive this metadata-only operation.
 await client.exec("INSERT INTO warehouses(id,name,kind,active,sort_order) VALUES('preview-sentinel','Untouched','stock',true,1)");
 const columns=async()=>JSON.stringify((await client.query("SELECT table_name,column_name,data_type,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows);
 const before=await columns();await client.exec(repair);await client.exec(repair);await client.exec(check);
 assert.equal(await columns(),before);
 assert.equal((await client.query("SELECT name FROM warehouses WHERE id='preview-sentinel'")).rows.length,1);
 const rows=(await client.query<{version:string;name:string;statements:string[]}>('SELECT * FROM supabase_migrations.schema_migrations ORDER BY version')).rows;
 assert.equal(rows.length,4);
 for(const file of files){const version=file.split('_')[0]!;assert.deepEqual(rows.find(r=>r.version===version)!.statements,[read('migrations/postgres/'+file)]);}
});
test('repair refuses missing baseline or conflicting history, and web-order migration replay now runs in dependency order',async()=>{
 const {client}=await createTestDb();await metadata(client);
 await client.exec("INSERT INTO supabase_migrations.schema_migrations VALUES('20261019035500','conflict',ARRAY['different SQL'])");
 await assert.rejects(client.exec(repair),/already contains different SQL/);await client.exec('ROLLBACK');
 assert.equal((await client.query('SELECT * FROM supabase_migrations.schema_migrations')).rows.length,1);
 await client.exec('DELETE FROM supabase_migrations.schema_migrations');
 await client.exec('DROP TABLE public.web_store_orders');
 await assert.rejects(client.exec(repair),/repairs history only/);await client.exec('ROLLBACK');
 assert.equal((await client.query('SELECT * FROM supabase_migrations.schema_migrations')).rows.length,0);
 const financial=read('migrations/postgres/20261021035601_web_order_financial_snapshot.sql');
 await assert.rejects(client.exec(financial),/does not exist/);
 const create=read('migrations/postgres/'+files[0]!).replaceAll('--> statement-breakpoint','');
 await client.exec(create);await client.exec(read('migrations/postgres/'+files[1]!));await client.exec(financial);
 await client.exec(read('migrations/postgres/'+files[2]!));
 await client.exec(read('migrations/postgres/20261029090000_web_order_stock.sql'));
 await client.exec(read('migrations/postgres/20261102123212_web_order_crm_edit.sql'));
 assert.equal((await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='web_store_orders' AND column_name='financial_snapshot'")).rows.length,1);
});
