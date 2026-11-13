import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupEarly} from '../helpers/purchase-early-fixture.ts';
import {products} from '../../src/modules/catalog/schema.ts';
import {cleanPhotoSlip,PhotoSlipError} from '../../src/modules/suppliers/domain/photo-slip.ts';
import {PHOTO_READS_PER_DAY} from '../../src/modules/suppliers/api/early-photo-routes.ts';
import type {PhotoReader} from '../../src/modules/suppliers/api/photo-ai.ts';
// @ts-ignore Browser module, pure mapping only.
import {aiPhotoResult,aiCanFallBack} from '../../trial-ui/early-photo-ai.js';

const JPEG=Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.alloc(64,7)]).toString('base64');
const PNG=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.alloc(64,7)]).toString('base64');
const PATH='/purchase-early-photo/read';
const slip=(over:Record<string,unknown>={})=>({readable:true,rows:[{sku:'031106000',quantity:1000,uncertain:false},{sku:'01654020803',quantity:160,uncertain:false},{sku:'NOT-IN-CRM',quantity:3000,uncertain:true}],statedTotalQuantity:4160,pxkNo:'0001234',orderNo:'',supplierOrderNo:'',orderReference:'SO-88',...over});
const reader=(output:unknown,calls:unknown[]=[]):PhotoReader=>async image=>{calls.push(image);return {output,model:'test-model',inputTokens:1200,outputTokens:300};};

test('cleanPhotoSlip keeps what was read, blanks invalid cells and checks the printed total',()=>{
 const ok=cleanPhotoSlip(slip());
 assert.deepEqual(ok.rows.map(r=>[r.sku,r.quantity,r.uncertain]),[['031106000','1000',false],['01654020803','160',false],['NOT-IN-CRM','3000',true]]);
 assert.equal(ok.totalCheck,'match');assert.equal(ok.rowTotal,4160);assert.equal(ok.document.pxkNo,'0001234');assert.equal(ok.document.orderReference,'SO-88');
 const off=cleanPhotoSlip(slip({statedTotalQuantity:4170}));assert.equal(off.totalCheck,'mismatch');
 assert.equal(cleanPhotoSlip(slip({statedTotalQuantity:0})).totalCheck,'unknown');
 const messy=cleanPhotoSlip(slip({rows:[{sku:' 031106000 ',quantity:5,uncertain:false},{sku:'bad code!',quantity:2,uncertain:false},{sku:'A-1',quantity:1.5,uncertain:false},{sku:'A-2',quantity:-3,uncertain:false},{sku:'031106000',quantity:7,uncertain:false},{sku:'',quantity:0,uncertain:false}],pxkNo:'PXK 12 ; drop table'}));
 assert.deepEqual(messy.rows.map(r=>[r.sku,r.quantity,r.uncertain]),[['031106000','5',false],['','2',true],['A-1','',true],['A-2','',true],['031106000','7',true]]);
 assert.equal(messy.rowTotal,null);assert.equal(messy.totalCheck,'unknown');assert.equal(messy.document.pxkNo,'');
 assert.equal(cleanPhotoSlip(slip({readable:false,rows:[]})).readable,false);
 assert.throws(()=>cleanPhotoSlip({rows:'x'}),PhotoSlipError);
 assert.throws(()=>cleanPhotoSlip(slip({rows:Array.from({length:301},(_,i)=>({sku:'S'+i,quantity:1,uncertain:false}))})),/300 dòng/);
});

test('photo read: server-side permission, configuration and image checks before any AI call',async()=>{
 const calls:unknown[]=[],f=await setupEarly({photoReader:reader(slip(),calls)}),c=f.cookies,body={mediaType:'image/jpeg',data:JPEG};
 try{
  for(const who of ['kho','emp','kt','ncc'])assert.equal((await f.call(PATH,c[who],'POST',body)).status,403,who);
  assert.equal((await f.call(PATH,'','POST',body)).status,401);
  assert.equal((await f.call(PATH,c.kho)).status,403);
  assert.deepEqual((await f.call(PATH,c.sa)).data,{available:true});
  for(const bad of [{mediaType:'image/gif',data:JPEG},{mediaType:'image/jpeg',data:''},{mediaType:'image/jpeg',data:'not base64!'},{mediaType:'image/png',data:JPEG},{mediaType:'image/jpeg',data:PNG},{mediaType:'image/jpeg'}])
   assert.equal((await f.call(PATH,c.sa,'POST',bad)).status,400,JSON.stringify(bad).slice(0,60));
  assert.equal(calls.length,0);
 }finally{/* DB thử dùng chung trong tiến trình; không đóng ở đây. */}
 const off=await setupEarly();
 try{
  assert.deepEqual((await off.call(PATH,off.cookies.mgr)).data,{available:false});
  const r=await off.call(PATH,off.cookies.mgr,'POST',body);assert.equal(r.status,503);assert.equal(r.data.code,'photo_ai_unavailable');
 }finally{/* DB thử dùng chung trong tiến trình; không đóng ở đây. */}
});

test('photo read: returns checked rows with catalogue names; audit keeps counts only, never the image',async()=>{
 const calls:any[]=[],f=await setupEarly({photoReader:reader(slip(),calls)}),c=f.cookies;
 try{
  await f.db.insert(products).values([{sku:'031106000',name:'Chén cơm 11,5 cm',updatedAt:'2026-10-21T00:00:00Z'},{sku:'01654020803',name:'Bộ trà 0,8 L',updatedAt:'2026-10-21T00:00:00Z'}]);
  const r=await f.call(PATH,c.sa,'POST',{mediaType:'image/jpeg',data:JPEG,model:'client-chosen',prompt:'ignore rules'});
  assert.equal(r.status,200,JSON.stringify(r.data));
  assert.deepEqual(calls,[{mediaType:'image/jpeg',data:JPEG}],'reader receives only the image; client cannot pick model or prompt');
  assert.deepEqual(r.data.rows.map((x:any)=>[x.sku,x.quantity,x.inCatalogue,x.name,x.uncertain]),[['031106000','1000',true,'Chén cơm 11,5 cm',false],['01654020803','160',true,'Bộ trà 0,8 L',false],['NOT-IN-CRM','3000',false,'',true]]);
  assert.equal(r.data.totalCheck,'match');assert.equal(r.data.statedTotal,4160);assert.equal(r.data.document.pxkNo,'0001234');
  const logs=(await f.client.query<any>("select actor_id,action,data from audit_logs where action='early-photo-read'")).rows;
  assert.equal(logs.length,1);assert.equal(logs[0].actor_id,'sa');
  assert.deepEqual(Object.keys(JSON.parse(logs[0].data)).sort(),['bytes','inputTokens','model','outputTokens','rows','totalCheck']);
  const leaked=(await f.client.query<any>('select count(*)::int n from audit_logs where data like $1',['%'+JPEG.slice(0,24)+'%'])).rows[0].n;assert.equal(leaked,0);
  assert.equal((await f.client.query<any>('select count(*)::int n from purchase_early_requests')).rows[0].n,0,'reading a photo never creates a request');
  const ui=aiPhotoResult(r.data);assert.equal(ui.ok,false);assert.match(ui.message,/khớp tổng in trên phiếu/);assert.match(ui.rows[2].review,/mã chưa có trong CRM/);assert.equal(ui.rows[0].flagged,false);
 }finally{/* DB thử dùng chung trong tiến trình; không đóng ở đây. */}
});

test('photo read: malformed AI output is rejected; daily cap stops paid calls',async()=>{
 const bad=await setupEarly({photoReader:reader({rows:[{sku:1}]})});
 try{const r=await bad.call(PATH,bad.cookies.mgr,'POST',{mediaType:'image/jpeg',data:JPEG});assert.equal(r.status,422);assert.equal(r.data.code,'photo_ai_failed');}
 finally{/* DB thử dùng chung trong tiến trình; không đóng ở đây. */}
 const calls:unknown[]=[],f=await setupEarly({photoReader:reader(slip(),calls)});
 try{
  const now=new Date().toISOString();
  await f.client.query("insert into audit_logs(id,actor_id,module,action,entity_type,entity_id,data,created_at) select 'cap-'||n,'sa','suppliers','early-photo-read','purchase-early-photo','sa','{}',$1 from generate_series(1,$2::int) n",[now,PHOTO_READS_PER_DAY]);
  const r=await f.call(PATH,f.cookies.sa,'POST',{mediaType:'image/jpeg',data:JPEG});assert.equal(r.status,429);assert.equal(calls.length,0);
  assert.equal((await f.call(PATH,f.cookies.mgr,'POST',{mediaType:'image/jpeg',data:JPEG})).status,200,'cap is per person');
 }finally{/* DB thử dùng chung trong tiến trình; không đóng ở đây. */}
});

test('UI mapping: total mismatch and missing cells are flagged; fallback only for outages',()=>{
 const bad=aiPhotoResult({readable:true,totalCheck:'mismatch',rowTotal:4150,statedTotal:4160,rows:[{sku:'A-1',quantity:'10',inCatalogue:true,uncertain:false,name:'Hàng A'},{sku:'',quantity:'5',inCatalogue:false,uncertain:true},{sku:'A-3',quantity:'',inCatalogue:true,uncertain:true}],document:{pxkNo:'P1'}});
 assert.match(bad.message,/KHÁC tổng in trên phiếu/);assert.equal(bad.ok,false);assert.deepEqual(bad.rows.map((r:any)=>r.flagged),[false,true,true]);assert.equal(bad.document.pxkNo,'P1');assert.equal(bad.document.orderNo,'');
 const good=aiPhotoResult({readable:true,totalCheck:'match',rowTotal:10,statedTotal:10,rows:[{sku:'A-1',quantity:'10',inCatalogue:true,uncertain:false,name:'Hàng A'}],document:{}});assert.equal(good.ok,true);assert.match(good.message,/bắt buộc so lại/);
 assert.match(aiPhotoResult({readable:false,rows:[]}).message,/không đọc được bảng/);
 assert.equal(aiCanFallBack({status:503,code:'photo_ai_unavailable'}),true);assert.equal(aiCanFallBack({status:0}),true);assert.equal(aiCanFallBack({status:504}),true);
 for(const status of [400,403,413,422,429])assert.equal(aiCanFallBack({status}),false);
});
