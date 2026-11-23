import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser profiles are also DOM-independent with a column adapter
import {mobileProfilesP2} from '../../trial-ui/mobile-profiles-p2.js';
// @ts-ignore browser profiles
import {mobileProfilesP3} from '../../trial-ui/mobile-profiles-p3.js';
function layout(root:string,headers:string[],labels:string[]=[]){
 const profile=[...mobileProfilesP2,...mobileProfilesP3].find(p=>p.root===root)!;
 const table={tHead:{rows:[{cells:headers.map(textContent=>({textContent}))}]}};
 return profile.card(headers.map((_,i)=>({dataset:{label:labels[i]},closest:()=>table})));
}
test('ledger keeps pending stock separate from historical balance and branch after column insertion/reordering',()=>{
 assert.deepEqual(layout('#view-stock-moves',['#','Ngày ghi nhận','Giao dịch','Phiên bản sản phẩm','Nhập kho','Xuất kho','Tồn kho sau giao dịch','Hàng đang treo (hiện tại)','Chi nhánh']),{meta:1,title:3,status:2,owner:8,in:4,out:5,balance:6,pending:7});
 const reordered=layout('#view-stock-moves',['Chi nhánh','Hàng đang treo (hiện tại)','Phiên bản sản phẩm','Tồn kho sau giao dịch']);
 assert.deepEqual(reordered,{title:2,owner:0,balance:3,pending:1});
});
test('unrecognized/detail tables are left intact instead of hiding their values',()=>{
 assert.equal(layout('#view-stock-moves',['Ghi chú','Số lượng']),null);
 assert.equal(layout('#view-inventory',['Ngày','Chứng từ','Nhập','Tồn']),null);
});
test('product price restrictions and staff department changes never borrow another column',()=>{
 assert.deepEqual(layout('#view-products',['Chọn','Sản phẩm','Đang tạm giữ','Hàng đang về','Tồn kho']),{title:1,status:4,selection:0,held:2,incoming:3});
 assert.deepEqual(layout('#view-staff',['Nhân viên','Điện thoại','Làm việc tại','Phòng ban','Chức vụ','Trạng thái','Thao tác']),{title:0,note:1,owner:3,status:5,substatus:4});
});
test('incoming selection and editable quantity retain separate cells and stable SKU column',()=>{
 assert.deepEqual(layout('.purchase-incoming',['','Mã hàng','Tên sản phẩm','Đang về','Đơn mua / Phiếu lấy trước','Hẹn sớm nhất','Trạng thái','SL cần lấy trước']),{meta:1,title:2,amount:3,note:4,owner:5,status:6,quantity:7,selection:0});
});
test('cash inflows and outflows are kept as two labelled values, never inferred from a dash',()=>{
 assert.deepEqual(layout('#view-cashbook',['Ngày','Mã phiếu','Loại','Đối tượng / nội dung','Phương thức','Thu','Chi','Trạng thái','Người tạo']),{meta:1,title:3,status:2,owner:8,substatus:7,in:5,out:6});
});
