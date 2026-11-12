export const scoped=(rows,id)=>rows.filter(r=>r.supplierId===id);
export const normalized=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase().trim();
export const STATUS={active:['Đang cung cấp','green'],inactive:['Ngừng cung cấp','neutral'],awaiting_confirmation:['Chờ NCC xác nhận','amber'],confirmed:['Đã xác nhận','blue'],preparing:['Đang chuẩn bị','blue'],shipping:['Đang giao','blue'],completed:['Hoàn tất','green'],cancelled:['Đã hủy','neutral'],waiting_reply:['Chờ phản hồi','amber'],accepted:['Đã đồng ý','green'],partially_fulfilled:['Giao một phần','blue'],fulfilled:['Đã giao đủ','green'],rejected:['Đã từ chối','red'],waiting_pickup:['Chờ lấy hàng','amber'],in_transit:['Đang vận chuyển','blue'],received:['Đã nhận hàng','green'],waiting_confirmation:['Chờ xác nhận','amber'],pending:['Chờ duyệt','amber'],approved:['Đã duyệt','blue'],paid:['Đã nhận tiền','green'],partial:['Nhận một phần','blue'],verified:['Đã đối chiếu','green'],needs_review:['Cần kiểm tra','amber'],missing:['Chưa có số','neutral'],owing:['Còn phải thu','blue'],overdue:['Quá hạn','red'],settled:['Đã thanh toán đủ','green'],overpaid:['Nhận thừa theo đơn','blue'],available:['Có thể giao','green'],low:['Tồn thấp','amber'],out:['Hết hàng','neutral'],unknown:['Chưa có số liệu','neutral']};
export function ledger(data,supplierId,asOf){
 const payments=scoped(data.payments,supplierId).filter(p=>p.status==='posted'&&!p.voidedAt&&p.date<=asOf),credits=scoped(data.credits,supplierId).filter(c=>c.effectiveDate&&c.effectiveDate<=asOf);
 const dedup=rows=>[...new Map(rows.map(r=>[r.id,r])).values()];const unique=dedup(payments),uniqueCredits=dedup(credits);
 return scoped(data.orders,supplierId).filter(o=>o.approvalStatus==='approved'&&o.status!=='cancelled'&&o.date<=asOf).map(o=>{
  const paid=unique.filter(p=>p.orderId===o.id).reduce((s,p)=>s+p.amount,0),credit=uniqueCredits.filter(c=>c.orderId===o.id).reduce((s,c)=>s+c.amount,0),remaining=o.total-paid-credit;
  return{...o,id:o.id,paid,credit,remaining,status:remaining<0?'overpaid':remaining===0?'settled':o.dueDate&&o.dueDate<asOf?'overdue':'owing',orderStatus:o.status};
 });
}
export function pageRows(page,data,asOf='2026-11-12'){
 const id=data.supplier.id;if(page==='balances')return ledger(data,id,asOf);
 if(page==='stock')return scoped(data.stock,id).map(r=>{const available=typeof r.onHand==='number'&&typeof r.reserved==='number'?Math.max(0,r.onHand-r.reserved):null;return{...r,available,status:available===null?'unknown':available===0?'out':available<50?'low':'available'};});
 const rows=scoped(data[page]||[],id);const balances=new Map(ledger(data,id,asOf).map(o=>[o.id,o]));
 return rows.map(r=>page==='orders'?{...r,paid:balances.get(r.id)?.paid??0,remaining:balances.get(r.id)?.remaining??null}:r);
}
export function validateFilters(filters){
 for(const key of ['from','to','asOf'])if(filters[key]){const date=new Date(filters[key]+'T00:00:00Z');if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==filters[key])return 'Ngày lọc không hợp lệ.';}
 if(filters.from&&filters.to&&filters.from>filters.to)return 'Từ ngày phải nhỏ hơn hoặc bằng Đến ngày.';
 if(filters.min!==''&&filters.min!=null&&(!Number.isFinite(Number(filters.min))||Number(filters.min)<0))return 'Giá trị tối thiểu không hợp lệ.';
 if(filters.max!==''&&filters.max!=null&&(!Number.isFinite(Number(filters.max))||Number(filters.max)<0))return 'Giá trị tối đa không hợp lệ.';
 if(filters.min!==''&&filters.min!=null&&filters.max!==''&&filters.max!=null&&Number(filters.min)>Number(filters.max))return 'Giá trị từ phải nhỏ hơn hoặc bằng Giá trị đến.';return '';
}
export function filterRows(rows,f){
 if(validateFilters(f))return[];const words=normalized(f.q).split(/\s+/).filter(Boolean);
 return rows.filter(r=>{
  if(f.status&&r.status!==f.status)return false;if(f.warehouse&&r.warehouse!==f.warehouse)return false;if(f.brand&&r.brand!==f.brand)return false;if(f.category&&r.category!==f.category)return false;if(f.direction&&r.direction!==f.direction)return false;
  const date=r[f.dateField||'date']||'';if((f.from||f.to)&&!date)return false;if(f.from&&date<f.from||f.to&&date>f.to)return false;
  const value=r[f.valueField||'total'];if(f.min!==''&&f.min!=null&&(value==null||value<Number(f.min)))return false;if(f.max!==''&&f.max!=null&&(value==null||value>Number(f.max)))return false;
  const hay=normalized([r.no,r.supplierNo,r.crmNo,r.orderNo,r.sku,r.name,r.brand,r.category,r.contact,r.series,r.invoiceNo,r.warehouse,r.destination,...(r.lines||[]).flatMap(l=>[l.sku,l.name])].filter(Boolean).join(' ')),compact=hay.replace(/[^a-z0-9]/g,'');
  return words.every(w=>hay.includes(w)||(/[0-9]/.test(w)&&compact.includes(w.replace(/[^a-z0-9]/g,''))));
 });
}
export function metrics(page,rows){
 const sum=k=>rows.reduce((s,r)=>s+(typeof r[k]==='number'?r[k]:0),0),count=s=>rows.filter(r=>r.status===s).length;
 if(page==='products')return[{label:'Sản phẩm theo bộ lọc',value:rows.length},{label:'Đang cung cấp',value:count('active')},{label:'Thương hiệu',value:new Set(rows.map(r=>r.brand)).size},{label:'Nhóm sản phẩm',value:new Set(rows.map(r=>r.category)).size}];
 if(page==='stock')return[{label:'Mã hàng theo bộ lọc',value:rows.length},{label:'Có thể giao',value:count('available')},{label:'Cần bổ sung',value:count('low'),tone:'amber'},{label:'Chưa có số liệu',value:count('unknown'),tone:'neutral'}];
 if(page==='balances')return[{label:'Còn phải thu',value:rows.reduce((s,r)=>s+Math.max(0,r.remaining),0),money:true},{label:'Quá hạn thanh toán',value:rows.filter(r=>r.status==='overdue').reduce((s,r)=>s+r.remaining,0),money:true,tone:'red'},{label:'Đã nhận thanh toán',value:sum('paid'),money:true},{label:'Đơn còn phải thu',value:rows.filter(r=>r.remaining>0).length}];
 if(page==='orders')return[{label:'Đơn đặt theo bộ lọc',value:rows.length},{label:'Giá trị đơn còn hiệu lực',value:rows.filter(r=>r.status!=='cancelled').reduce((s,r)=>s+r.total,0),money:true},{label:'Cần xác nhận',value:count('awaiting_confirmation'),tone:'amber'},{label:'Đang chuẩn bị / giao',value:count('preparing')+count('shipping'),tone:'blue'}];
 if(page==='advances')return[{label:'Đề nghị theo bộ lọc',value:rows.length},{label:'Giá trị đề nghị',value:sum('amount'),money:true},{label:'Chờ duyệt',value:count('pending'),tone:'amber'},{label:'Đã duyệt / nhận tiền',value:count('approved')+count('paid')}];
 if(page==='invoices')return[{label:'Hóa đơn theo bộ lọc',value:rows.length},{label:'Giá trị hóa đơn',value:sum('total'),money:true},{label:'Cần kiểm tra',value:count('needs_review'),tone:'amber'},{label:'Chưa có số hóa đơn',value:count('missing'),tone:'neutral'}];
 return[{label:page==='requests'?'Phiếu xin hàng':page==='transfers'?'Phiếu điều chuyển':'Phiếu giao hàng',value:rows.length},{label:'Tổng số lượng theo phiếu',value:sum('quantity')},{label:'Đang xử lý',value:rows.filter(r=>!['received','fulfilled','rejected'].includes(r.status)).length,tone:'blue'},{label:'Đã hoàn tất',value:count('received')+count('fulfilled'),tone:'green'}];
}
export function csv(columns,rows){
 const value=v=>{const s=String(v??'');return '"'+(typeof v==='string'&&/^[=+\-@]/.test(s)?"'"+s:s).replaceAll('"','""')+'"';};
 return '\ufeff'+[columns.map(c=>value(c.label)).join(','),...rows.map(r=>columns.map(c=>value(r[c.key])).join(','))].join('\r\n');
}
