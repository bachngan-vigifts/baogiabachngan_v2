import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const dir=new URL('../../migrations/postgres/',import.meta.url);
// Inspect top-level commands and anonymous DO bodies. Declared function/procedure bodies are not executed here.
function unwrappedLocal(sql:string){
 const tokens=/\$(\w*)\$[\s\S]*?\$\1\$|[eE]'(?:\\.|''|[^'\\])*'|'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\//g;
 let plain='',cursor=0;
 for(const match of sql.matchAll(tokens)){
  const at=match.index!,token=match[0],tag=match[1];
  plain+=sql.slice(cursor,at);
  const statement=plain.slice(plain.lastIndexOf(';')+1).trim();
  if(tag!==undefined&&/^DO\b/i.test(statement)){
   // DO's BEGIN/END is a procedural block, not the migration's outer transaction.
   const body=token.slice(tag.length+2,-tag.length-2).replace(tokens,' ');
   plain+=/\bSET\s+LOCAL\b/i.test(body)?' SET LOCAL ':' ';
  }else plain+=' ';
  cursor=at+token.length;
 }
 plain+=sql.slice(cursor);
 let transaction=false,local=false;
 for(const raw of plain.split(';')){
  const statement=raw.trim();
  if(/^(BEGIN|START\s+TRANSACTION)\b/i.test(statement))transaction=true;
  else if(/^(COMMIT|END)\b/i.test(statement)){transaction=false;local=false;}
  else if(/^ROLLBACK\b/i.test(statement)){if(local)return true;transaction=false;local=false;}
  else if(/\bSET\s+LOCAL\b/i.test(statement)){if(!transaction)return true;local=true;}
 }
 return local&&transaction;
}
// Reviewed legacy exceptions at f0a48ea6: autovacuum, trigram, search-fold columns and Sale Admin handoff.
// Already-applied SQL is immutable; hashes prevent this allowlist from exempting later edits. New files are never exempt.
const legacyHashes:Record<string,string>={"20261103094412_crm_catalog_autovacuum.sql": "5d481822abf01844f8f0454b361de915c9fa8e0435a9d72fe4e5cd78696350a5", "20261103095218_product_search_trigram.sql": "256c39086c9d4c89e9421ff109f629817d71dc559dc6c08b8d127923c38fca76", "20261119090000_search_fold_columns.sql": "e84fc6c5accb87a2cae7b4581d5b509bf26c331df1b5478c50b7e087247aa9be", "20261121102152_sale_admin_handoff.sql": "19db36366dee64ef9537ddf26fa440a3658d12dc517b4654e537030aa94ae960"};
const legacy=new Set(Object.keys(legacyHashes));
function migrationHash(sql:string){return createHash('sha256').update(sql.replace(/\r\n/g,'\n')).digest('hex');}
test('mọi migration mới dùng SET LOCAL phải có transaction BEGIN/COMMIT thực sự',()=>{
 const violations=readdirSync(dir).filter(f=>f.endsWith('.sql')&&unwrappedLocal(readFileSync(new URL(f,dir),'utf8')));
 assert.deepEqual(violations.filter(f=>!legacy.has(f)),[]);
 for(const f of legacy){assert.ok(violations.includes(f),'xem lại ngoại lệ không còn cần: '+f);assert.equal(migrationHash(readFileSync(new URL(f,dir),'utf8')),legacyHashes[f],'Không sửa migration cũ: '+f);}
});
test('guard phân biệt DO block, comment với transaction và bắt SET LOCAL đặt sai thứ tự',()=>{
 for(const sql of ["SET LOCAL lock_timeout='5s';", "-- BEGIN;\nSET LOCAL lock_timeout='5s'; COMMIT;", "DO $$ BEGIN END $$; SET LOCAL lock_timeout='5s';", "BEGIN; COMMIT; SET LOCAL lock_timeout='5s';", "BEGIN; SET LOCAL lock_timeout='5s';", "BEGIN; SET LOCAL lock_timeout='5s'; ROLLBACK;", "DO $$ BEGIN SET LOCAL lock_timeout='5s'; END $$;"])assert.equal(unwrappedLocal(sql),true,sql);
 for(const sql of ["BEGIN; SET LOCAL lock_timeout='5s'; COMMIT;", "-- SET LOCAL\nselect 1;", "DO $$ BEGIN RAISE NOTICE 'SET LOCAL'; END $$;", "BEGIN; DO $body$ BEGIN SET LOCAL lock_timeout='5s'; END; $body$; COMMIT;"])assert.equal(unwrappedLocal(sql),false,sql);
});

test('END là COMMIT hợp lệ; SET LOCAL sau END ngoài giao dịch vẫn bị bắt',()=>{
 assert.equal(unwrappedLocal("BEGIN; SET LOCAL lock_timeout='5s'; END;"),false);
 assert.equal(unwrappedLocal("BEGIN; SET LOCAL lock_timeout='5s'; END; SET LOCAL lock_timeout='5s';"),true);
});
for(const kind of ['FUNCTION','PROCEDURE'])test('khai báo CREATE '+kind+' chưa thực thi thân có SET LOCAL',()=>{
 const declaration=kind==='FUNCTION'?'FUNCTION sample() RETURNS void':'PROCEDURE sample()';
 assert.equal(unwrappedLocal(`CREATE ${declaration} LANGUAGE plpgsql AS $body$ BEGIN SET LOCAL lock_timeout='5s'; END; $body$;`),false);
 assert.equal(unwrappedLocal("DO LANGUAGE plpgsql $body$ BEGIN SET LOCAL lock_timeout='5s'; END; $body$;"),true);
 assert.equal(unwrappedLocal("BEGIN; DO LANGUAGE plpgsql $body$ BEGIN SET LOCAL lock_timeout='5s'; END; $body$; END;"),false);
});
test('COMMIT/END reset cờ local trước giao dịch tiếp theo',()=>{
 for(const end of ['COMMIT','END']){
  assert.equal(unwrappedLocal(`BEGIN; SET LOCAL lock_timeout='5s'; ${end}; BEGIN; SELECT 1; ROLLBACK;`),false);
  assert.equal(unwrappedLocal(`BEGIN; SET LOCAL lock_timeout='5s'; ${end}; SET LOCAL lock_timeout='5s';`),true);
 }
});
test('chuỗi E có escaped quote không biến nội dung thành lệnh SET LOCAL',()=>{
 const text=String.raw`SELECT E'quoted \' ; SET LOCAL lock_timeout=\'5s\'; still text';`;
 assert.equal(unwrappedLocal(text),false);
 assert.equal(unwrappedLocal(String.raw`DO $$ BEGIN RAISE NOTICE E'quoted \' ; SET LOCAL lock_timeout=\'5s\'; still text'; END $$;`),false);
 assert.equal(unwrappedLocal("SELECT E'only text'; SET LOCAL lock_timeout='5s';"),true);
});
test('hash ngoại lệ bất biến qua LF/CRLF nhưng vẫn bắt thay đổi nội dung SQL',()=>{
 for(const file of legacy){const lf=readFileSync(new URL(file,dir),'utf8').replace(/\r\n/g,'\n');
  assert.equal(migrationHash(lf.replace(/\n/g,'\r\n')),legacyHashes[file]);
  assert.notEqual(migrationHash(lf+'\n-- changed SQL'),legacyHashes[file]);
 }
});
