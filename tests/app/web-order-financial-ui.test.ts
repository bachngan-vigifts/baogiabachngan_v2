import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Native browser JS.
import {webOrderFinancialSummary} from '../../trial-ui/web-order-financials.js';
class Element {textContent='';className='';children:Element[]=[];append(...c:Element[]){this.children.push(...c);}setAttribute(){} }
const flatten=(e:Element):string=>[e.textContent,...e.children.map(flatten)].join(' ');
function render(d:any){const before=globalThis.document;Object.assign(globalThis,{document:{createElement:()=>new Element()}});try{return flatten(webOrderFinancialSummary(d,'VND'));}finally{Object.assign(globalThis,{document:before});}}
const sample={version:1,itemsSubtotal:38545020,itemsSubtotalTax:0,total:38390020,totalTax:0,discountTotal:150000,shippingTotal:0,shippingTax:0,coupons:[{code:'lnl150k <img onerror=alert(1)>',discount:150000,tax:0}],fees:[{name:'Đổi điểm',total:-5000,tax:0}],shipping:[{title:'Miễn phí vận chuyển'}]};
test('Chi tiết web hiển thị mã, đổi điểm, miễn ship và tổng nguồn đúng; tên dùng textContent',()=>{
 const text=render(sample);assert.match(text,/150\.000 đ/);assert.match(text,/-5\.000 đ/);assert.match(text,/38\.390\.020 đ/);assert.match(text,/Miễn phí vận chuyển/);assert.match(text,/<img onerror=alert\(1\)>/);assert.match(text,/phí GHN được theo dõi riêng/);
});
test('Đơn cũ hiện thiếu đồng bộ thay vì tự coi giảm giá/ship bằng 0',()=>{
 const text=render(null);assert.match(text,/chưa đồng bộ/);assert.doesNotMatch(text,/0 đ/);
});
test('Điểm quy đổi là thông tin tham chiếu và không tạo thêm một dòng trừ tiền',()=>{
 const text=render({...sample,points:{redeemed:5000,amount:5000}});assert.match(text,/Điểm đã đổi: 5000/);assert.match(text,/không trừ thêm/);assert.equal(text.split('-5.000 đ').length-1,1);
});
