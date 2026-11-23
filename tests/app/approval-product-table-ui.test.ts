import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Native browser JS.
import {approvalProductTable} from '../../trial-ui/approval-product-table.js';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const format={esc,fmtNum:String,money:(v:number)=>`${v} đ`};

test('Bảng chung giữ từng dòng và tách tồn theo kho, thiếu dữ liệu không suy ra bằng 0',()=>{
 const lines=[{sku:'A',name:'<img src=x>',qty:2,unit:'Cái',unitPrice:123456.5,taxRate:8},{sku:'A',name:'Dòng trùng mã',qty:3,unit:'Cái',unitPrice:200,taxRate:0},{sku:'',name:'Hàng nhập tay',qty:1,unitPrice:10,taxRate:8}];
 const html=approvalProductTable({lines,warehouses:[{id:'w1',name:'Kho <1>',lines:[{sku:'A',stock:4,need:5}]},{id:'w2',name:'Kho 2',lines:[{sku:'A',stock:10,need:5}]}],label:'HĐKT',total:100},format);
 assert.equal((html.match(/data-approval-product=/g)||[]).length,3);
 assert.ok(html.includes('123456.5 đ'));assert.ok(html.includes('&lt;img src=x&gt;'));assert.ok(!html.includes('<img'));
 assert.ok(html.includes('Kho &lt;1&gt;'));assert.ok(html.includes('Kho 2'));
 assert.ok(html.includes('Thiếu hàng'));assert.ok(html.includes('Đủ hàng'));assert.ok(html.includes('Chưa có dữ liệu'));
 assert.ok(!html.includes('×'));assert.ok(!html.includes('tồn 14'));
});

test('Không cấu hình kho vẫn hiện sản phẩm và báo thiếu dữ liệu, không tạo số tồn giả',()=>{
 const html=approvalProductTable({lines:[{sku:'B',name:'Bình',qty:1,unitPrice:100,taxRate:8}],warehouses:[],label:'đơn',total:108},format);
 assert.ok(html.includes('Bình'));assert.ok(html.includes('Chưa cấu hình kho bán'));assert.ok(html.includes('Giá trị đơn (gồm VAT)'));
});

test('Mã lặp nhiều dòng cộng nhu cầu nhưng không nhân tồn kho',()=>{
 const html=approvalProductTable({lines:[{sku:'A',name:'A',qty:2,unitPrice:1,taxRate:8}],warehouses:[{name:'Kho',lines:[{sku:'A',stock:4,need:2},{sku:'A',stock:4,need:3}]}],label:'đơn',total:2},format);
 assert.ok(html.includes('<strong>4</strong>'));assert.ok(html.includes('Cần 5'));assert.ok(html.includes('Thiếu hàng'));assert.ok(!html.includes('<strong>8</strong>'));
});
