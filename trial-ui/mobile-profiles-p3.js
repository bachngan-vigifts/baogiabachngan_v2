import {labelledCard} from './mobile-profile-layout.js';
/** Label matching keeps the new pending-stock column distinct from warehouse/branch. */
export const mobileProfilesP3=[
 {root:'#view-dashboard',title:'doanh số'},
 {root:'#view-kho',title:'kho'},
 {root:'#view-inventory',title:'đối chiếu tồn',rows:'.inv-compare-panel .data-table > tbody > tr',details:true,card:labelledCard({title:['Mã hàng · Tên','Mã hàng','Sản phẩm','Mã / Tên hàng','Mã / tên'],meta:['Kho'],ledger:['Sổ kho'],sapo:['Sapo'],difference:['Lệch']})},
 {root:'#view-stock-moves',title:'sổ kho',filters:'.ledger-bar',keep:'.ledger-search',rows:'.ledger-table > tbody > tr:not(.ledger-total)',details:true,card:labelledCard({meta:['Ngày ghi nhận'],title:['Phiên bản sản phẩm'],status:['Giao dịch'],owner:['Chi nhánh'],in:['Nhập kho'],out:['Xuất kho'],balance:['Tồn kho sau giao dịch'],pending:['Hàng đang treo (hiện tại)']})},
 {root:'#view-transfers',title:'điều chuyển',rows:'.sup-page > .panel > .table-wrap > .data-table > tbody > tr',details:true,card:labelledCard({meta:['Số phiếu'],title:['Kho đi → kho đến'],note:['Mã / SL'],owner:['Người xin'],status:['Trạng thái']})},
 {root:'#view-products',title:'sản phẩm',rows:'#product-list > tr',details:false,card:labelledCard({title:['Sản phẩm'],amount:['Giá','Giá bán lẻ','Giá lẻ + VAT'],status:['Tồn','Tồn kho'],selection:['Chọn'],held:['Đang tạm giữ'],incoming:['Hàng đang về']})},
 {root:'#view-staff',title:'nhân viên',rows:'#member-list > tr',details:true,card:labelledCard({title:['Nhân viên'],note:['Điện thoại'],owner:['Phòng ban'],status:['Trạng thái'],substatus:['Chức vụ']})},
 {root:'#view-payroll',title:'bảng lương'},
 {root:'#view-permissions',title:'phân quyền'},
 {root:'#view-flow',title:'sơ đồ quy trình'},
];
