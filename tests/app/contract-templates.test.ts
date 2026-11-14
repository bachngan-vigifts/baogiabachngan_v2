import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {setupLiquidation} from '../helpers/liquidation-fixture.ts';
import {salesContracts} from '../../src/modules/sales/schema.ts';
import {contractTemplateVersions} from '../../src/modules/sales/contract-template-schema.ts';
import manifest from '../../src/modules/sales/domain/contract-template-manifest.json' with {type:'json'};
const base=manifest.BN;
const editable=base.paragraphs.find(p=>!p.locked)!;
const edit={index:editable.index,hash:'a'.repeat(64),text:'Điều khoản mẫu chung mới',runs:[{text:'Điều khoản mẫu chung mới',bold:true}]};
const payload=(revision=0)=>({revision,sourceHash:base.sourceHash,edits:[edit]});

test('server template allow-list stays bound to the exact shipped BN and VG files',()=>{
 for(const [brand,name] of [['BN','bach-ngan'],['VG','vigifts']] as const){
  const bytes=readFileSync(new URL('../../trial-ui/mau-hop-dong-'+name+'-hdkt.docx',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest[brand].sourceHash,'Review template changes and regenerate the manifest');
 }
});

test('only Manager reads/writes original template; validates source, fields, format; concurrent/stale saves cannot overwrite',async()=>{
 const f=await setupLiquidation(),url='/contract-templates/BN';
 for(const who of [f.emp,f.other,f.ncc])for(const method of ['GET','PUT'])assert.equal((await f.call(url,who,method,method==='PUT'?payload():undefined)).status,403);
 assert.equal((await f.call(url)).status,401);
 assert.equal((await f.call('/contract-templates/XX',f.mgr)).status,400);
 const initial=await f.call(url,f.mgr);assert.equal(initial.status,200);assert.equal(initial.data.revision,0);assert.deepEqual(initial.data.edits,[]);assert.ok(initial.data.locked.length);
 assert.equal((await f.call(url,f.mgr,'PUT',{...payload(),sourceHash:'a'.repeat(64)})).status,409);
 for(const edits of [[{...edit,index:base.paragraphs.find(p=>p.locked)!.index}],[{...edit,index:19999}],[{...edit,text:'<<[Giả]>>',runs:undefined}],[{...edit,runs:[{text:'Khác'}]}],[{...edit,text:'Ký tự \u0000',runs:undefined}],[{...edit,text:'Ký tự \uD800',runs:undefined}]])assert.equal((await f.call(url,f.mgr,'PUT',{...payload(),edits})).status,400);
 const saves=await Promise.all([f.call(url,f.mgr,'PUT',payload()),f.call(url,f.mgr,'PUT',payload())]);
 assert.deepEqual(saves.map(r=>r.status).sort(),[200,409]);
 const first=(await f.call(url,f.mgr)).data;assert.equal(first.revision,1);assert.equal(first.edits[0].text,edit.text);assert.equal(first.edits[0].hash,'0'.repeat(64));
 assert.equal((await f.call(url,f.mgr,'PUT',payload())).status,409);
 assert.equal((await f.call(url,f.mgr,'PUT',{...payload(1),edits:[]})).status,200);
 assert.equal((await f.db.select().from(contractTemplateVersions)).length,2,'immutable history retained');
 assert.equal((await f.call('/contract-templates/VG',f.mgr)).data.revision,0,'brands remain separate');
 // Gate is read-only and repeatable. RLS and revision constraints fail closed.
 const gate=readFileSync(new URL('../../scripts/sql/assert-contract-templates.sql',import.meta.url),'utf8');
 await f.client.exec('BEGIN TRANSACTION READ ONLY');await f.client.exec(gate);await f.client.exec(gate);await f.client.exec('ROLLBACK');
 await assert.rejects(f.client.query("INSERT INTO sales_contract_template_versions VALUES ('XX',1,$1,'[]','mgr','now')",[base.sourceHash]));
 const migration=readFileSync(new URL('../../migrations/postgres/20261114110000_contract_templates.sql',import.meta.url),'utf8');await f.client.exec(migration);await f.client.exec(migration);assert.equal((await f.db.select().from(contractTemplateVersions)).length,2);
 await f.client.exec('BEGIN');await f.client.exec('ALTER TABLE sales_contract_template_versions DROP COLUMN created_at');await assert.rejects(f.client.exec(gate),/columns/);await f.client.exec('ROLLBACK');
 await f.client.exec('ALTER TABLE sales_contract_template_versions DISABLE ROW LEVEL SECURITY');await assert.rejects(f.client.exec(gate),/RLS/);
});

test('new contracts snapshot shared template; old contracts and snapshots survive edits, forgery, resets and later template saves',async()=>{
 const f=await setupLiquidation(),url='/contract-templates/BN';
 const make=async(n:number)=>{
  const q=await f.call('/quotes',f.emp,'POST',{type:'HRC',quoteNo:'HRC_TEMPLATE_'+n,customer:'Khách',customerTaxCode:'0312345678',vat:8,rows:[{name:'Ly',sku:'LY1',unit:'cái',qty:1,price:1000}]});assert.equal(q.status,201,JSON.stringify(q.data));
  const approved=await f.call('/quotes/'+q.data.id+'/approve',f.mgr,'POST',{revision:1});assert.equal(approved.status,200,JSON.stringify(approved.data));
  const k=await f.call('/contracts',f.emp,'POST',{quoteId:q.data.id,legalEntity:'BN',pushSapo:false,details:{templateSnapshot:{revision:999,edits:[edit]}}});assert.equal(k.status,201,JSON.stringify(k.data));
  const [record]=await f.db.select().from(salesContracts).where(eq(salesContracts.id,k.data.id));return record!;
 };
 const old=await make(1);assert.equal(JSON.parse(old.data).templateSnapshot.revision,0);
 assert.equal((await f.call(url,f.mgr,'PUT',payload())).status,200);
 const newer=await make(2);assert.equal(JSON.parse(newer.data).templateSnapshot.revision,1);assert.equal(JSON.parse(newer.data).templateSnapshot.edits[0].text,edit.text);
 assert.equal((await f.call(url,f.mgr,'PUT',{...payload(1),edits:[]})).status,200);
 const newest=await make(3);assert.equal(JSON.parse(newest.data).templateSnapshot.revision,2);assert.deepEqual(JSON.parse(newest.data).templateSnapshot.edits,[]);
 const changed=await f.call('/contracts/'+newer.id,f.mgr,'PUT',{revision:newer.revision,details:{templateSnapshot:{revision:999,edits:[]},details:{representativeTitle:'Giám đốc'}}});assert.equal(changed.status,200,JSON.stringify(changed.data));
 const [after]=await f.db.select().from(salesContracts).where(eq(salesContracts.id,newer.id));assert.deepEqual(JSON.parse(after!.data).templateSnapshot,JSON.parse(newer.data).templateSnapshot);
 const legacy=(await f.db.select().from(salesContracts).where(eq(salesContracts.id,'liq-contract')))[0]!;
 assert.equal((await f.call('/contracts/liq-contract',f.mgr,'PUT',{revision:legacy.revision,details:{templateSnapshot:JSON.parse(newer.data).templateSnapshot}})).status,200);
 const [legacyAfter]=await f.db.select().from(salesContracts).where(eq(salesContracts.id,'liq-contract'));assert.equal(JSON.parse(legacyAfter!.data).templateSnapshot,undefined);
 const [oldAfter]=await f.db.select().from(salesContracts).where(eq(salesContracts.id,old.id));assert.equal(oldAfter!.data,old.data);
 assert.equal((await f.call('/orders/'+newer.orderId,f.mgr)).data.contract.canManageTemplates,true);
 assert.equal((await f.call('/orders/'+newer.orderId,f.emp)).data.contract.canManageTemplates,false);
});
