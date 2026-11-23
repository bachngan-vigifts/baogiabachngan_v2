import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestDb} from '../helpers/postgres.ts';
const read=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
test('AI migration repeats safely; deploy gate is read-only and rejects schema/security regressions without repair',async()=>{
 const {client}=await createTestDb();
 const migration=read('migrations/postgres/20261118040000_ai_chat_public_questions.sql'),gate=read('scripts/sql/assert-ai-chat-public.sql');
 {
  await client.exec("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END $$;");
  await client.exec(migration);await client.exec(migration);
  for(let i=0;i<2;i++){await client.exec('BEGIN TRANSACTION READ ONLY');try{await client.exec(gate);}finally{await client.exec('ROLLBACK');}}
  for(const mutation of [
   'ALTER TABLE ai_chat_questions DROP COLUMN answer',
   'ALTER TABLE ai_chat_helpful_votes DISABLE ROW LEVEL SECURITY',
   'GRANT SELECT ON ai_chat_questions TO authenticated',
   'GRANT SELECT ON ai_chat_questions TO PUBLIC',
   'DROP INDEX idx_ai_chat_questions_status',
   'ALTER TABLE ai_chat_questions DROP CONSTRAINT chk_ai_chat_questions_status',
   'ALTER TABLE ai_chat_helpful_votes DROP CONSTRAINT ai_chat_helpful_votes_pkey',
  ]){
   await client.exec('BEGIN');try{await client.exec(mutation);await client.exec('SAVEPOINT gate_check');await assert.rejects(client.exec(gate),/20261118040000_ai_chat_public_questions.sql/);await client.exec('ROLLBACK TO SAVEPOINT gate_check');}finally{await client.exec('ROLLBACK');}
  }
  await client.exec('BEGIN TRANSACTION READ ONLY');try{await client.exec(gate);}finally{await client.exec('ROLLBACK');}
 }
});
