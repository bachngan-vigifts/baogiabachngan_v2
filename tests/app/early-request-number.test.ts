import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {eq} from 'drizzle-orm';
import {setupEarly} from '../helpers/purchase-early-fixture.ts';
import {purchaseEarlyRequests as requests} from '../../src/modules/suppliers/early-request-schema.ts';
import {nextDocumentNumber} from '../../src/core/document-number.ts';
import {vietnamDate} from '../../src/modules/sales/domain/sales.ts';
const migration=readFileSync(new URL('../../migrations/postgres/20261027113713_early_request_numbers.sql',import.meta.url),'utf8');
const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
const body=(clientKey=crypto.randomUUID())=>({clientKey,pickupDate:'2026-10-28',scope:{supplierId:'a'},lines:[{sku:'031106000',quantity:5}]});

test('PXH numbers match the shared document rule, survive edits/submit and retry, reset by Vietnam date and are searchable',async()=>{
 const f=await setupEarly(),date=vietnamDate().iso,payload=body();
 const a=ok(await f.call('/purchase-early-requests',f.cookies.mgr,'POST',{...payload,ticketNumber:'PXH_999_01012000'}),201);
 assert.equal(a.request.ticketNumber,nextDocumentNumber('PXH',date,[]));
 const replay=ok(await f.call('/purchase-early-requests',f.cookies.mgr,'POST',payload));assert.equal(replay.request.ticketNumber,a.request.ticketNumber);assert.equal(replay.id,a.id);
 const edited=ok(await f.call('/purchase-early-requests/'+a.id,f.cookies.mgr,'PUT',{revision:a.request.revision,pickupDate:'2026-11-01',lines:[{sku:'031106000',quantity:7}]}));assert.equal(edited.request.ticketNumber,a.request.ticketNumber);
 const sent=ok(await f.call('/purchase-early-requests/'+a.id+'/submit',f.cookies.mgr,'POST',{revision:edited.request.revision}));assert.equal(sent.request.ticketNumber,a.request.ticketNumber);
 const found=ok(await f.call('/purchase-early-requests?q='+encodeURIComponent(a.request.ticketNumber),f.cookies.mgr));assert.deepEqual(found.requests.map((r:any)=>r.id),[a.id]);
 const portal=ok(await f.call('/supplier-portal/early-requests?id='+a.id,f.cookies.ncc));assert.equal(portal.requests[0].ticketNumber,a.request.ticketNumber);
 const calendar=ok(await f.call('/purchase-receiving-calendar?type=early&q='+a.request.ticketNumber,f.cookies.mgr));assert.ok(calendar.rows.some((r:any)=>r.requestId===a.id&&r.ticketNumber===a.request.ticketNumber));
 const incoming=ok(await f.call('/purchase-incoming?type=early',f.cookies.mgr));assert.ok(incoming.rows.some((r:any)=>r.earlyRequests.some((e:any)=>e.id===a.id&&e.ticketNumber===a.request.ticketNumber)));
 const rows=await Promise.all([f.call('/purchase-early-requests',f.cookies.mgr,'POST',body()),f.call('/purchase-early-requests',f.cookies.sa,'POST',body())]);const numbers=rows.map(r=>ok(r,201).request.ticketNumber);assert.equal(new Set(numbers).size,2);assert.ok(numbers.every(n=>n!==a.request.ticketNumber));
 // Numbers already consumed by a cancelled request remain reserved.
 const deleted=rows[0]!.data;ok(await f.call('/purchase-early-requests/'+deleted.id,f.cookies.mgr,'DELETE'));const next=ok(await f.call('/purchase-early-requests',f.cookies.mgr,'POST',body()),201);assert.equal(next.request.ticketNumber,nextDocumentNumber('PXH',date,[a.request.ticketNumber,...numbers]));
 await f.db.insert(requests).values({id:'another-day',clientKey:'another-day',payloadHash:'x',createdBy:'mgr',createdAt:'2026-01-01T17:01:00Z'});assert.equal((await f.db.select().from(requests).where(eq(requests.id,'another-day')))[0]!.ticketNumber,'PXH_001_02012026');
});

test('split children receive distinct persisted numbers while parent IDs, numbers and allocation/receipt links stay intact',async()=>{
 const f=await setupEarly(),payload={...body(),lines:[{sku:'031106000',quantity:9000}]};
 const a=ok(await f.call('/purchase-early-requests',f.cookies.mgr,'POST',payload),201);
 const split=ok(await f.call('/purchase-early-requests/'+a.id+'/split',f.cookies.mgr,'POST',{}));assert.equal(split.requests.length,2);
 const childNos=split.requests.map((r:any)=>r.ticketNumber);assert.equal(new Set(childNos).size,2);assert.ok(childNos.every((n:string)=>/^PXH_\d{3,}_\d{8}$/.test(n)&&n!==a.request.ticketNumber));
 assert.equal((await f.db.select().from(requests).where(eq(requests.id,a.id)))[0]!.ticketNumber,a.request.ticketNumber);
 const replay=ok(await f.call('/purchase-early-requests/'+a.id+'/split',f.cookies.mgr,'POST',{}));assert.deepEqual(replay.requests.map((r:any)=>r.ticketNumber),childNos);
});

test('migration upgrades old headers deterministically, keeps deleted numbers, is repeatable and does not change stock/provenance',async()=>{
 const f=await setupEarly();
 await f.client.exec('DROP TRIGGER assign_early_request_number ON purchase_early_requests; ALTER TABLE purchase_early_requests DROP COLUMN ticket_number;');
 for(const [id,created,deleted]of [['old-a','2026-10-26T16:59:00Z',null],['old-b','2026-10-26T17:00:00Z',null],['old-c','2026-10-26T18:00:00Z','2026-10-27T00:00:00Z']])await f.client.query('INSERT INTO purchase_early_requests(id,client_key,payload_hash,created_by,created_at,deleted_at) VALUES($1,$1,\'x\',\'mgr\',$2,$3)',[id,created,deleted]);
 const before=(await f.client.query<{v:unknown}>("SELECT json_agg(to_jsonb(r) ORDER BY id) v FROM purchase_early_requests r")).rows[0]!.v;
 const stock=(await f.client.query<{n:number}>('SELECT count(*)::int n FROM stock_moves')).rows[0]!.n;
 await f.client.exec(migration);const once=await f.client.query('SELECT id,ticket_number FROM purchase_early_requests ORDER BY id');assert.deepEqual(once.rows,[{id:'old-a',ticket_number:'PXH_001_26102026'},{id:'old-b',ticket_number:'PXH_001_27102026'},{id:'old-c',ticket_number:'PXH_002_27102026'}]);
 assert.deepEqual((await f.client.query<{v:unknown}>("SELECT json_agg(to_jsonb(r)-'ticket_number' ORDER BY id) v FROM purchase_early_requests r")).rows[0]!.v,before);assert.equal((await f.client.query<{n:number}>('SELECT count(*)::int n FROM stock_moves')).rows[0]!.n,stock);
 await f.client.exec(migration);assert.deepEqual((await f.client.query('SELECT id,ticket_number FROM purchase_early_requests ORDER BY id')).rows,once.rows);
 await f.db.insert(requests).values({id:'after-upgrade',clientKey:'after-upgrade',payloadHash:'x',createdBy:'mgr',createdAt:'2026-10-27T12:00:00Z'});assert.equal((await f.db.select().from(requests).where(eq(requests.id,'after-upgrade')))[0]!.ticketNumber,'PXH_003_27102026');
 // Re-deploy does not renumber any request and large sequence numbers are not truncated.
 await f.db.insert(requests).values({id:'large',ticketNumber:'PXH_999_27102026',clientKey:'large',payloadHash:'x',createdBy:'mgr',createdAt:'2026-10-27T12:00:00Z'});
 await f.db.insert(requests).values({id:'large-next',clientKey:'large-next',payloadHash:'x',createdBy:'mgr',createdAt:'2026-10-27T12:00:00Z'});assert.equal((await f.db.select().from(requests).where(eq(requests.id,'large-next')))[0]!.ticketNumber,'PXH_1000_27102026');
 await f.client.exec(migration);assert.equal((await f.db.select().from(requests).where(eq(requests.id,'large-next')))[0]!.ticketNumber,'PXH_1000_27102026');
 await assert.rejects(f.db.insert(requests).values({id:'duplicate-number',ticketNumber:'PXH_1000_27102026',clientKey:'duplicate-number',payloadHash:'x',createdBy:'mgr',createdAt:'2026-10-27T12:00:00Z'}));
 const security=(await f.client.query<{prosecdef:boolean}>("SELECT prosecdef FROM pg_proc WHERE oid='public.assign_early_request_number()'::regprocedure")).rows[0]!;assert.equal(security.prosecdef,false);
 assert.ok(readFileSync(new URL('../../.github/workflows/deploy-api.yml',import.meta.url),'utf8').includes('20261027113713_early_request_numbers.sql'));
});
