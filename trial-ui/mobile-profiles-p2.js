/** List layouts only. Price-restricted purchase rows intentionally have fewer columns. */
export const mobileProfilesP2=[
 {root:'#view-deliveries',title:'giao hàng',filters:'.delivery-range',keep:'.delivery-status',extraFilters:'#deliveries-filter-grid',rows:'#deliveries-list > tr',card:{meta:0,title:2,status:4,owner:1,note:3}},
 {root:'#view-receivables',title:'công nợ',filters:'#receivables-filter-grid',rows:'#receivables-list > tr',card:{title:0,status:1,owner:2,amount:7,substatus:8}},
 {root:'#view-cashbook',title:'sổ thu chi',filters:'.cashbook-range',rows:'#cashbook-list > tr',card:cells=>({meta:1,title:3,status:2,owner:8,substatus:7,amount:cells[5].textContent.trim()==='—'?6:5})},
 {root:'#view-purchases',title:'đơn mua NCC',filters:'.pur-filter-grid',rows:'.sup-page > .panel > .table-wrap > .data-table > tbody > tr',card:cells=>({meta:0,title:1,owner:3,note:4,status:cells.length-1,...(cells.length===8?{amount:5,substatus:6}:{})})},
 {root:'.purchase-incoming',title:'hàng đang về',filters:'.incoming-filters',keep:':has(input[type=search]),.incoming-chips',rows:'.incoming-table > tbody > tr:not(.incoming-details)',card:{meta:1,title:2,amount:3,note:4,owner:5,status:6,selection:0,quantity:7}},
 {root:'#view-suppliers',title:'nhà cung cấp',filters:'.toolbar',keep:'.search',rows:'.sup-page > .panel > .table-wrap > .data-table > tbody > tr',card:{title:0,meta:1,note:2,status:6}},
 {root:'#view-receiving',title:'nhận hàng',filters:'.toolbar',keep:':has(input[type=search]):last-child',rows:'.table-wrap > .data-table > tbody > tr',card:{meta:0,title:2,status:1,note:3}},
 {root:'#view-cash',title:'sổ quỹ',filters:'.cash-ledger-tools',keep:'.cash-kind-tabs',rows:'.cash-content > .data-table > tbody > tr',card:cells=>({meta:0,title:2,status:1,owner:3,substatus:7,amount:cells[5].textContent.trim()==='—'?6:5})},
 {root:'#view-stock-lookup',title:'tra tồn'},
 {root:'#view-stock-requests',title:'khách hỏi tồn'},
 {root:'#view-packing',title:'đóng gói'},
];
