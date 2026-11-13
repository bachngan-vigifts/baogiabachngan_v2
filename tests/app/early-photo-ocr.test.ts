import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser module, pure extraction only.
import {extractEarlyPhotoRows} from '../../trial-ui/early-photo-ocr.js';
const word=(text:string,x:number,y:number,confidence=94)=>({text,confidence,bbox:{x0:x,x1:x+text.length*8,y0:y,y1:y+15}});
const line=(words:any[])=>({words,bbox:{y0:words[0].bbox.y0,y1:words[0].bbox.y1}});
const data=(rows:any[])=>({blocks:[{paragraphs:[{lines:rows.map(line)}]}]});
test('photo extractor reads explicit columns and preserves zeroes without guessing prices or O/I',()=>{
 const header=[word('Mã',20,10),word('hàng',45,10),word('Tên',180,10),word('Số',500,10),word('lượng',525,10),word('Đơn',700,10),word('giá',730,10)];
 const rows=extractEarlyPhotoRows(data([header,[word('031059000B2',20,40),word('Chén',180,40),word('12',510,40),word('25000',710,40)],[word('O31059000B2',20,70),word('Chén',180,70),word('1.000',510,70),word('25000',710,70)]]));
 assert.deepEqual(rows.rows.map((r:any)=>[r.sku,r.quantity]),[['031059000B2','12'],['O31059000B2','']]);
 assert.equal(extractEarlyPhotoRows(data([[word('031059000B2',20,10),word('12',510,10),word('25000',710,10)]])).rows.length,0);
 const ambiguous=[...header,word('SL',900,10)];assert.equal(extractEarlyPhotoRows(data([ambiguous,[word('031059000B2',20,40),word('12',510,40)]])).rows.length,0);
});
// @ts-ignore Browser module, pure payload mapping.
import {photoRequestRows} from '../../trial-ui/purchase-early-photo.js';
test('document refs are labelled, preserve zeros, refuse conflicts and require generic order classification',()=>{
 const d=extractEarlyPhotoRows(data([[word('Số PXK: 000123',20,0)],[word('Số đơn hàng: NCC-0007',20,20)],[word('Mã',20,50),word('hàng',45,50),word('Số',500,50),word('lượng',525,50)],[word('031106000',20,80),word('5',510,80)]]));
 assert.equal(d.document.pxkNo,'000123');assert.equal(d.document.orderReference,'NCC-0007');
 assert.throws(()=>photoRequestRows(d.rows,d.document),/chọn loại/);
 assert.deepEqual(photoRequestRows(d.rows,{...d.document,referenceType:'supplier'}).map((r:any)=>[r.sku,r.pxkNo,r.orderNo,r.supplierOrderNo]),[['031106000','000123','','NCC-0007']]);
 const conflict=extractEarlyPhotoRows(data([[word('Số PXK: 0001',20,10)],[word('Số PXK: 0002',20,30)]]));assert.equal(conflict.document.pxkNo,'');assert.deepEqual(conflict.conflicts,['pxkNo']);
 assert.throws(()=>photoRequestRows([{sku:'001',quantity:'1',orderNo:'DMH-1',orderReference:'DMH-2',referenceType:'crm'}]),/khác số/);
});
test('row reference columns keep separate purchase orders and PXKs instead of applying one to every line',()=>{
 const d=extractEarlyPhotoRows(data([[word('SKU',20,10),word('SL',200,10),word('Đơn',400,10),word('NCC',435,10),word('Số',700,10),word('PXK',725,10)],[word('031106000',20,40),word('5',210,40),word('A-001',410,40),word('0001',710,40)],[word('01654020803',20,70),word('2',210,70),word('A-002',410,70),word('0002',710,70)]]));
 assert.deepEqual(d.rows.map((r:any)=>[r.supplierOrderNo,r.pxkNo]),[['A-001','0001'],['A-002','0002']]);
 const mapped=photoRequestRows(d.rows,{pxkNo:'DEFAULT'});assert.deepEqual(mapped.map((r:any)=>r.pxkNo),['0001','0002']);
});
test('Minh Long delivery slip headings "Mã Số" and "SL Giao" are recognised as code and quantity columns',()=>{
 const header=[word('STT',5,10),word('Mã',60,10),word('Số',85,10),word('Tên',220,10),word('hàng',250,10),word('ĐVT',520,10),word('SL',600,10),word('Giao',625,10),word('Ghi',760,10),word('chú',790,10)];
 const d=extractEarlyPhotoRows(data([[word('Mã',20,-40),word('số',45,-40),word('thuế:',70,-40),word('0301234567',130,-40)],header,[word('1',5,40),word('011006000',60,40),word('Chén',220,40),word('Cái',520,40),word('1000',605,40)],[word('2',5,70),word('031106000',60,70),word('Dĩa',220,70),word('Cái',520,70),word('160',605,70)]]));
 assert.deepEqual(d.rows.map((r:any)=>[r.sku,r.quantity]),[['011006000','1000'],['031106000','160']]);
});
