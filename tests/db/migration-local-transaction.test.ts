import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const dir=new URL('../../migrations/postgres/',import.meta.url);
// Strip quoted bodies/strings before reading top-level statements: a DO $$ BEGIN ... END $$ is not a transaction.
function unwrappedLocal(sql:string){
 const literals=/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\//g;
 const plain=sql.replace(/\$(\w*)\$[\s\S]*?\$\1\$|'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\//g,(token,tag:string|undefined)=>{
  if(tag===undefined)return ' ';
  // A DO block must not masquerade as BEGIN, but its SET LOCAL still requires an outer transaction.
  const body=token.slice(tag.length+2,-tag.length-2).replace(literals,' ');
  return /\bSET\s+LOCAL\b/i.test(body)?' SET LOCAL ':' ';
 });
 let transaction=false,local=false;
 for(const raw of plain.split(';')){const s=raw.trim();if(/^(BEGIN|START\s+TRANSACTION)\b/i.test(s))transaction=true;
  else if(/^COMMIT\b/i.test(s))transaction=false;
  else if(/^(ROLLBACK|END)\b/i.test(s)){if(local)return true;transaction=false;}
  else if(/\bSET\s+LOCAL\b/i.test(s)){if(!transaction)return true;local=true;}}
 return local&&transaction; // A transaction containing SET LOCAL must also be closed.
}
// Reviewed legacy exceptions at f0a48ea6: autovacuum, trigram, search-fold columns and Sale Admin handoff.
// Already-applied SQL is immutable; hashes prevent this allowlist from exempting later edits. New files are never exempt.
const legacyHashes:Record<string,string>={"20261103094412_crm_catalog_autovacuum.sql": "5d481822abf01844f8f0454b361de915c9fa8e0435a9d72fe4e5cd78696350a5", "20261103095218_product_search_trigram.sql": "256c39086c9d4c89e9421ff109f629817d71dc559dc6c08b8d127923c38fca76", "20261119090000_search_fold_columns.sql": "e84fc6c5accb87a2cae7b4581d5b509bf26c331df1b5478c50b7e087247aa9be", "20261121102152_sale_admin_handoff.sql": "19db36366dee64ef9537ddf26fa440a3658d12dc517b4654e537030aa94ae960"};
const legacy=new Set(Object.keys(legacyHashes));
test('mọi migration mới dùng SET LOCAL phải có transaction BEGIN/COMMIT thực sự',()=>{
 const violations=readdirSync(dir).filter(f=>f.endsWith('.sql')&&unwrappedLocal(readFileSync(new URL(f,dir),'utf8')));
 assert.deepEqual(violations.filter(f=>!legacy.has(f)),[]);
 for(const f of legacy){assert.ok(violations.includes(f),'xem lại ngoại lệ không còn cần: '+f);assert.equal(createHash('sha256').update(readFileSync(new URL(f,dir))).digest('hex'),legacyHashes[f],'Không sửa migration cũ: '+f);}
});
test('guard phân biệt DO block, comment với transaction và bắt SET LOCAL đặt sai thứ tự',()=>{
 for(const sql of ["SET LOCAL lock_timeout='5s';", "-- BEGIN;\nSET LOCAL lock_timeout='5s'; COMMIT;", "DO $$ BEGIN END $$; SET LOCAL lock_timeout='5s';", "BEGIN; COMMIT; SET LOCAL lock_timeout='5s';", "BEGIN; SET LOCAL lock_timeout='5s';", "BEGIN; SET LOCAL lock_timeout='5s'; ROLLBACK;", "DO $$ BEGIN SET LOCAL lock_timeout='5s'; END $$;"])assert.equal(unwrappedLocal(sql),true,sql);
 for(const sql of ["BEGIN; SET LOCAL lock_timeout='5s'; COMMIT;", "-- SET LOCAL\nselect 1;", "DO $$ BEGIN RAISE NOTICE 'SET LOCAL'; END $$;", "BEGIN; DO $body$ BEGIN SET LOCAL lock_timeout='5s'; END $body$; COMMIT;"])assert.equal(unwrappedLocal(sql),false,sql);
});
