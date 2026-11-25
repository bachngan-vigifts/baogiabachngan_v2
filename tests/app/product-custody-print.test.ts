import {test} from 'node:test';
import assert from 'node:assert/strict';
const {custodyPrintHtml}=await import(new URL('../../trial-ui/custody-print.js',import.meta.url).href);
test('internal custody print preserves SKU, partial return, signatures and escapes user text',()=>{
 const ticket={ticketNumber:'BH001',kind:'warranty',status:'sent',partyName:'<script>alert(1)</script>',responsibleName:'Phụ trách',startDate:'2026-11-25',dueDate:'2026-11-30',issue:'Lỗi & kiểm tra',note:'Ghi chú',lines:[{id:'l1',sku:'00123',name:'Chén',unit:'cái',qty:3,returnedQty:1,conditionOut:'Nguyên vẹn'}]};
 const html=custodyPrintHtml({ticket,history:[{date:'2026-11-25',actorName:'Nhân viên',action:'receive',data:{lines:[{id:'l1',qty:1,condition:'Đủ phụ kiện'}]}}]});
 assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));
 for(const text of ['00123','25/11/2026','Bản lưu nội bộ','Người giao','Người nhận','nhận 1','Đủ phụ kiện','>2</td>'])assert.ok(html.includes(text),text);
 assert.ok(custodyPrintHtml({ticket:{...ticket,kind:'sample'}}).includes('PHIẾU MƯỢN MẪU'));
});
