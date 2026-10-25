/** Admin pages keep dense desktop tables; mobile exposes the original quantities with explicit labels. */
export const mobileProfilesP3=[
 {root:'#view-dashboard',title:'doanh số',filters:'.dash-filters',keep:'.dash-seg'},
 {root:'#view-kho',title:'kho'},
 {root:'#view-inventory',title:'đối chiếu tồn',filters:'.toolbar',keep:'.search',rows:'.sup-page > .panel > .table-wrap > .data-table > tbody > tr',card:{title:0,meta:1,ledger:2,sapo:3,difference:4}},
 {root:'#view-stock-moves',title:'sổ kho',filters:'.ledger-bar',keep:'.ledger-search',rows:'.ledger-table > tbody > tr:not(.ledger-total)',card:{meta:1,title:3,status:2,owner:7,in:4,out:5,balance:6}},
 {root:'#view-transfers',title:'điều chuyển',rows:'.sup-page > .panel > .table-wrap > .data-table > tbody > tr',card:{meta:0,title:1,note:2,owner:3,status:4}},
 {root:'#view-products',title:'sản phẩm',filters:'.panel > .toolbar',keep:'.search',rows:'#product-list > tr',card:{title:1,amount:4,status:5,selection:0}},
 {root:'#view-staff',title:'nhân viên',rows:'#member-list > tr',card:{title:0,note:1,owner:2,status:3}},
 {root:'#view-payroll',title:'bảng lương'},
 {root:'#view-permissions',title:'phân quyền'},
 {root:'#view-flow',title:'sơ đồ quy trình'},
];
