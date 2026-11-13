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
