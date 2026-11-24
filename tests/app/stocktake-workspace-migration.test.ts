import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
test('stocktake migration is additive, repeatable, private; gate detects missing schema and role grants',async()=>{
 const db=new PGlite();try{await db.waitReady;await db.exec('CREATE TABLE staff_members(id text primary key); CREATE TABLE inventory_adjustments(id text primary key); CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO service_role;');
 const workflow=readFileSync(new URL('../../.github/workflows/deploy-api.yml',import.meta.url),'utf8');assert.ok(workflow.indexOf('scripts/sql/assert-stocktake-workspace.sql')>0);assert.ok(workflow.indexOf('scripts/sql/assert-stocktake-workspace.sql')<workflow.indexOf('supabase secrets set'),'gate runs before secrets/deploy');
 const gate=readFileSync(new URL('../../scripts/sql/assert-stocktake-workspace.sql',import.meta.url),'utf8'),migration=readFileSync(new URL('../../migrations/postgres/20261124043000_stocktake_workspace.sql',import.meta.url),'utf8');
 await assert.rejects(db.exec(gate),/missing inventory_stocktake_states/);await db.exec(migration);await db.exec(gate);await db.exec(migration);await db.exec(gate);
 assert.equal((await db.query<{allowed:boolean}>("select has_table_privilege('anon','inventory_stocktake_commands','SELECT') as allowed")).rows[0]!.allowed,false);
 assert.equal((await db.query<{allowed:boolean}>("select has_table_privilege('service_role','inventory_stocktake_commands','DELETE') as allowed")).rows[0]!.allowed,false);
 }finally{await db.close();}
});
