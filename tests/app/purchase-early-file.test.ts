import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
// @ts-ignore browser module, pure parser/template exports are DOM independent
import {parseEarlyRequestSheet, readEarlyRequestWorkbook, earlyRequestTemplate, earlyFileRequestLines, EARLY_FILE_HEADER} from '../../trial-ui/purchase-early-file.js';
const context:any={};runInNewContext(readFileSync('trial-ui/xlsx.full.min.js','utf8'),context);const X=context.XLSX;
const wb=(rows:unknown[][])=>{const b=X.utils.book_new();X.utils.book_append_sheet(b,X.utils.aoa_to_sheet(rows),'Xin hàng trước');return b;};
test('xin trước bằng file: giữ mã 0 đầu, không chấp nhận sai/trùng/thiếu số lượng hoặc file sai mẫu',()=>{
 const data=parseEarlyRequestSheet([EARLY_FILE_HEADER,['031106000','Ly',5,'PO-a1',''],['01654020803','Ấm','7','PO-excel','']]);
 assert.equal(data.errors.length,0);assert.deepEqual(data.lines.map((l:any)=>[l.sku,l.quantity]),[['031106000',5],['01654020803',7]]);
 for(const quantity of [0,-1,1.5,'1.000','1,000','abc','',Number.MAX_SAFE_INTEGER+1])assert.ok(parseEarlyRequestSheet([EARLY_FILE_HEADER,['031106000','Ly',quantity,'PO-a1','']]).errors.length);
 assert.match(parseEarlyRequestSheet([EARLY_FILE_HEADER,['031106000','Ly',5,'PO-a1',''],['031106000','Ly',7,'PO-a1','']]).errors.join(' '),/trùng dòng 2/);
 assert.ok(parseEarlyRequestSheet([['Mã hàng','Đơn giá'],['001',5]]).errors.length);
 assert.ok(parseEarlyRequestSheet([EARLY_FILE_HEADER]).errors.length);
 assert.ok(parseEarlyRequestSheet([EARLY_FILE_HEADER,...Array.from({length:301},(_,i)=>['SKU'+i,'',1,'PO-a1',''])]).errors.length);
});
test('file Excel thật: mẫu tải về, mã Text, định dạng số, CSV, công thức và giới hạn',()=>{
 const template=earlyRequestTemplate(X),sheet=template.Sheets[template.SheetNames[0]];
 assert.equal(sheet.A2.z,'@');assert.equal(sheet.A2.t,'s');assert.equal(template.SheetNames.length,2);
 sheet.A2={t:'s',v:'031106000',z:'@'};sheet.B2={t:'s',v:'Ly'};sheet.C2={t:'n',v:1000,z:'#,##0'};sheet.D2={t:'s',v:'PO-a1',z:'@'};
 const file=X.write(template,{type:'buffer',bookType:'xlsx'}),again=X.read(file,{type:'buffer'});
 const imported=readEarlyRequestWorkbook(X,again);assert.equal(imported.errors.length,0);assert.equal(imported.lines[0].sku,'031106000');assert.equal(imported.lines[0].quantity,1000);
 const csv=X.read('Mã hàng,Tên hàng,Số lượng xin trước,Lấy ở số đơn hàng nào,Số đơn NCC\n031106000,Ly,5,PO-a1,',{type:'string',raw:true});
 assert.equal(readEarlyRequestWorkbook(X,csv).lines[0].sku,'031106000');
 const bad=wb([EARLY_FILE_HEADER,['001','Ly',5,'PO-a1','']]);bad.Sheets['Xin hàng trước'].C2.f='1+4';
 assert.throws(()=>readEarlyRequestWorkbook(X,bad),/công thức/);
 const long=wb([EARLY_FILE_HEADER,[1234567890123456,'Ly',5]]);assert.throws(()=>readEarlyRequestWorkbook(X,long),/quá dài/);
 const large=wb([EARLY_FILE_HEADER]);large.Sheets['Xin hàng trước']['!ref']='A1:C304';assert.throws(()=>readEarlyRequestWorkbook(X,large),/quá lớn/);
});

test('file → existing draft API: correct permissions, supplier scope, no early submission or stock writes',async()=>{
 const {setupEarly}=await import('../helpers/purchase-early-fixture.ts');
 const {call,cookies:c,client}=await setupEarly();
 for(const role of ['mgr','sa','emp','kho','kt']){
  const options=await call('/purchase-options',c[role]);assert.equal(options.status,200);
  assert.equal(options.data.canRequestEarly,['mgr','sa'].includes(role),role);
 }
 const parsed=parseEarlyRequestSheet([EARLY_FILE_HEADER,['031106000','Wrong reference name',5,'PO-b1',''],['01654020803','',2,'PO-excel','']]);
 assert.equal(parsed.errors.length,0);
 const body={clientKey:'file-draft-integration',pickupDate:'2026-10-25',scope:{supplierId:'b',status:'all'},lines:earlyFileRequestLines(parsed.lines)};
 const first=await call('/purchase-early-requests',c.sa,'POST',body);assert.equal(first.status,201,JSON.stringify(first.data));
 assert.equal(first.data.request.status,'draft');assert.equal(first.data.request.lines[0].allocations.every((a:any)=>a.supplierId==='b'),true);
 const replay=await call('/purchase-early-requests',c.sa,'POST',body);assert.equal(replay.data.id,first.data.id);
 assert.equal((await call('/supplier-portal/early-requests',c.ncc2)).data.requests.length,0);
 const counts=(await client.query<{receipts:number;moves:number}>('select (select count(*)::int from supplier_receipts) as receipts,(select count(*)::int from stock_moves) as moves')).rows[0];
 assert.ok(counts);assert.equal(counts.receipts,0);assert.equal(counts.moves,0);
 assert.equal((await call('/purchase-early-requests',c.emp,'POST',body)).status,403);
});

test('file: same SKU can use two explicit orders; order number required, supplier reference optional',()=>{
 const parsed=parseEarlyRequestSheet([EARLY_FILE_HEADER,['031106000','Ly',2,'PO-a1','NCC-001'],['031106000','Ly',3,'PO-a2','']]);
 assert.deepEqual(parsed.errors,[]);assert.deepEqual(earlyFileRequestLines(parsed.lines),[{sku:'031106000',quantity:5,sourceOrders:[{orderNo:'PO-a1',supplierOrderNo:'NCC-001',quantity:2},{orderNo:'PO-a2',supplierOrderNo:'',quantity:3}]}]);
 assert.ok(parseEarlyRequestSheet([EARLY_FILE_HEADER,['031106000','Ly',2,'','']]).errors.length);
 assert.ok(parseEarlyRequestSheet([['Mã hàng','Số lượng xin trước'],['031106000',2]]).errors.length);
});
