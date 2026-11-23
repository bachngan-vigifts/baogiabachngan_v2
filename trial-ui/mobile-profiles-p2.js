import {labelledCard} from './mobile-profile-layout.js';
/** Modern purchasing/receiving pages retain their own responsive filters, drawers and forms. */
export const mobileProfilesP2=[
 {root:'#view-deliveries',title:'giao hàng',filters:'.delivery-range',keep:'.delivery-status',extraFilters:'#deliveries-filter-grid',rows:'#deliveries-list > tr',details:true,card:labelledCard({meta:['Ngày giao'],title:['Khách hàng · Đơn / HĐKT · Sản phẩm'],status:['Trạng thái'],owner:['Chuyến'],note:['Người nhận · Địa chỉ']})},
 {root:'#view-receivables',title:'công nợ',filters:'#receivables-filter-grid',rows:'#receivables-list > tr',details:true,card:labelledCard({title:['Khách hàng · Đơn / HĐKT'],status:['Tình trạng'],owner:['Hạn thu'],amount:['Còn lại'],substatus:['Quá hạn']})},
 {root:'#view-cashbook',title:'sổ thu chi',filters:'.cashbook-range',rows:'#cashbook-list > tr',details:true,card:labelledCard({meta:['Mã phiếu'],title:['Đối tượng / nội dung'],status:['Loại'],owner:['Người tạo'],substatus:['Trạng thái'],in:['Thu'],out:['Chi']})},
 {root:'#view-purchases',title:'đơn mua NCC'},
 {root:'.purchase-incoming',title:'hàng đang về',rows:'.incoming-table > tbody > tr:not(.incoming-details)',details:true,card:labelledCard({meta:['Mã hàng'],title:['Tên sản phẩm'],amount:['Đang về'],note:['Đơn mua / Phiếu lấy trước'],owner:['Hẹn sớm nhất'],status:['Trạng thái'],quantity:['SL cần lấy trước'],selection:['']})},
 {root:'#view-suppliers',title:'nhà cung cấp',filters:'.sup-page > .panel > .toolbar',keep:'.search',rows:'.sup-page > .panel > .table-wrap > .data-table > tbody > tr',details:true,card:labelledCard({title:['Nhà cung cấp'],meta:['MST'],note:['Liên hệ'],status:['Trạng thái']})},
 {root:'#view-receiving',title:'nhận hàng'},
 {root:'#view-cash',title:'sổ quỹ',rows:'.cash-content > .data-table > tbody > tr',details:true,card:labelledCard({meta:['Mã phiếu / thời gian'],title:['Nội dung'],status:['Loại phiếu'],owner:['Người tạo'],substatus:['Trạng thái'],in:['Thu'],out:['Chi']})},
 {root:'#view-stock-lookup',title:'tra tồn'},
 {root:'#view-stock-requests',title:'khách hỏi tồn'},
 {root:'#view-packing',title:'đóng gói'},
];
