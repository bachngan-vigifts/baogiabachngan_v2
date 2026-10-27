import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser policy is DOM independent when supplied a node adapter
import {actionKind} from '../../trial-ui/mobile-action-policy.js';
function control(text:string,{dialog=false,field=false,primary=false,desktop=false}={}){
 return {textContent:text,title:'',getAttribute:()=>null,classList:{contains:(key:string)=>desktop&&key==='mobile-desktop-only'},
  matches:(selector:string)=>selector==='label'?false:primary&&selector.includes('.btn.primary'),querySelector:()=>field?{}:null,closest:()=>dialog?{}:null};
}
test('mobile saves, submits, confirmations and field-bearing controls never enter a secondary menu',()=>{
 for(const text of ['Lưu báo giá','Gửi duyệt','Xác nhận nhận hàng','Thanh toán','Nhận theo phiếu','Đã giao','Thu tiền','Đóng phiếu','Gọi','Báo giá','Xuất Excel','Xem / Tải hồ sơ'])assert.equal(actionKind(control(text)),'inline',text);
 assert.equal(actionKind(control('Chọn nguồn',{field:true})),'inline');
});
test('destructive controls require desktop or their existing full confirmation dialog',()=>{
 for(const text of ['Huỷ phiếu','Xóa đơn','Chốt tồn','Chốt kỳ','Điều chỉnh','Hoàn tiền','Đồng bộ Sapo']){
  assert.equal(actionKind(control(text)),'desktop',text);
  assert.equal(actionKind(control(text,{dialog:true})),'inline',text);
 }
 assert.equal(actionKind(control('Hủy',{dialog:true})),'inline');
 assert.equal(actionKind(control('Thêm sản phẩm',{desktop:true,primary:true})),'desktop');
 assert.equal(actionKind(control('Nhân bản')),'secondary');
});
