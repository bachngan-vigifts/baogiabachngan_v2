import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser policy is DOM independent when supplied a node adapter
import {actionKind} from '../../trial-ui/mobile-action-policy.js';
// @ts-ignore browser module; only the grouping threshold is read here
import {GROUP_MIN} from '../../trial-ui/mobile-actions.js';
function control(text:string,{dialog=false,field=false,primary=false,desktop=false,navigation=false,confirmationPage=false}={}){
 return {textContent:text,title:'',getAttribute:()=>null,classList:{contains:(key:string)=>desktop&&key==='mobile-desktop-only'},
  matches:(selector:string)=>selector==='[data-mobile-navigation]'?navigation:selector==='label'?false:primary&&selector.includes('.btn.primary'),querySelector:()=>field?{}:null,closest:(selector:string)=>dialog||confirmationPage&&selector.includes('[data-mobile-confirmation-page]')?{}:null};
}
test('mobile saves, submits, confirmations and field-bearing controls never enter a secondary menu',()=>{
 for(const text of ['Lưu báo giá','Gửi duyệt','Xác nhận nhận hàng','Thanh toán','Nhận theo phiếu','Đã giao','Thu tiền','Đóng phiếu','Gọi','Báo giá','Xuất Excel','Xem / Tải hồ sơ'])assert.equal(actionKind(control(text)),'inline',text);
 assert.equal(actionKind(control('Chọn nguồn',{field:true})),'inline');
});
test('điện thoại có đủ nút như PC: thao tác rủi ro vào menu ⋮ (không ẩn), trong hộp xác nhận thì hiện tại chỗ',()=>{
 for(const text of ['Huỷ phiếu','Xóa đơn','Chốt tồn','Chốt kỳ','Điều chỉnh','Hoàn tiền','Đồng bộ Sapo']){
  assert.equal(actionKind(control(text)),'secondary',text);
  assert.equal(actionKind(control(text,{dialog:true})),'inline',text);
 }
 assert.equal(actionKind(control('Hủy',{dialog:true})),'inline');
 assert.equal(actionKind(control('Thêm sản phẩm',{desktop:true,primary:true})),'desktop');
 assert.equal(actionKind(control('Nhân bản')),'secondary');
});
test('pagination and adding a product stay inline; only four or more secondary actions are grouped (2–3 only when they overflow)',()=>{
 for(const text of ['‹ Trang trước','Trang tiếp ›','‹ Trước','Sau ›','‹','›','＋ Thêm sản phẩm'])assert.equal(actionKind(control(text)),'inline',text);
 assert.equal(actionKind(control('Dán từ Excel')),'secondary');
 assert.equal(GROUP_MIN,4);
});

test('read-only navigation containing workflow status stays visible; destructive controls go to the ⋮ menu; clearing filters stays inline',()=>{
 assert.equal(actionKind(control('Khách hàng · Khách mới chờ duyệt: 3',{navigation:true})),'inline');
 assert.equal(actionKind(control('Xem đơn đã huỷ: 4',{navigation:true})),'inline');
 assert.equal(actionKind(control('Xóa lọc',{navigation:true})),'inline');
 assert.equal(actionKind(control('Huỷ phiếu')),'secondary');
 for(const text of ['Xoá bộ lọc','Xóa bộ lọc','Xóa lọc','Bỏ lọc'])assert.equal(actionKind(control(text)),'inline',text);
});

test('product removal opens an explicit confirmation context; outside it the action stays reachable in the ⋮ menu',()=>{
 assert.equal(actionKind(control('Xoá khỏi danh mục TEST-SKU',{confirmationPage:true})),'inline');assert.equal(actionKind(control('Xoá khỏi danh mục TEST-SKU')),'secondary');
});
