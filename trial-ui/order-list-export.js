/** One summary row per order; numeric product prices live in a separate detail sheet.
 * Totals/charged shipping are not repeated on product rows, so SUM cannot count an order twice.
 */
export function orderListExportSheets(orders, labels = {}) {
  const missing = 'Chưa có dữ liệu';
  const value = v => v == null || !Number.isFinite(Number(v)) ? missing : Number(v);
  const linePrices = (items, key) => items.length === 1 ? value(items[0][key])
    : items.map((l,i)=>`${i+1}. ${l[key]==null?missing:new Intl.NumberFormat('vi-VN',{maximumFractionDigits:4}).format(l[key])}`).join('\n');
  const summary=[],details=[];
  for(const o of orders){
    if(!o.exportDetails)throw Error('API chưa có dữ liệu xuất chi tiết sản phẩm. Vui lòng thử lại sau khi triển khai API.');
    const d=o.exportDetails,items=d.items||[],date=String(o.createdAt||o.orderDate||'').slice(0,10);
    summary.push([o.orderNo,date,o.customerName,o.phone,labels.source?.(o)||o.orderSource,o.branchName,o.ownerName,
      o.statusLabel||labels.status?.(o)||o.status,labels.delivery?.(o)||o.deliveryStatus||'',
      items.map((l,i)=>`${i+1}. ${l.sku?l.sku+' · ':''}${l.name}`).join('\n')||missing,
      items.length===1?value(items[0].qty):items.map((l,i)=>`${i+1}. ${value(l.qty)}`).join('\n'),
      linePrices(items,'unitPriceAfterDiscount'),linePrices(items,'unitPriceAfterDiscountVat'),
      value(d.shippingFee),value(o.total),d.currency||'VND',d.note||'']);
    for(const l of items.length?items:[{note:missing}])details.push([o.orderNo,date,o.customerName,l.sku||'',l.name||missing,l.unit||'',
      value(l.qty),value(l.unitPriceAfterDiscount),value(l.unitPriceAfterDiscountVat),value(l.subtotal),value(l.tax),value(l.total),d.currency||'VND',l.note||'']);
  }
  return [{name:'Đơn hàng',autoFilter:true,
    header:['Số đơn','Ngày tạo','Khách hàng','Điện thoại','Nguồn','Chi nhánh','Nhân viên','Trạng thái','Giao hàng',
      'Chi tiết sản phẩm','Số lượng','Đơn giá sau giảm (chưa VAT)','Đơn giá sau giảm (gồm VAT)',
      'Phí vận chuyển thu khách','Tổng giá trị đơn hàng','Tiền tệ','Ghi chú dữ liệu'],
    widths:[24,14,28,18,22,26,22,18,18,60,18,28,28,26,24,12,55],rows:summary},
    {name:'Chi tiết sản phẩm',autoFilter:true,
    header:['Số đơn','Ngày tạo','Khách hàng','SKU','Sản phẩm','ĐVT','Số lượng','Đơn giá sau giảm (chưa VAT)','Đơn giá sau giảm (gồm VAT)',
      'Tiền hàng sau giảm (chưa VAT)','VAT dòng','Thành tiền dòng (gồm VAT)','Tiền tệ','Ghi chú dữ liệu'],
    widths:[24,14,28,20,50,12,14,28,28,30,18,28,12,50],rows:details}];
}
