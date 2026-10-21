const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
/** Source totals are displayed, never recalculated into a new amount due. */
export function webOrderFinancialSummary(data,currency='VND') {
 const box=el('section','web-order-financials');box.setAttribute('aria-label','Chi tiết tiền đơn website');
 box.append(el('h3','','Chi tiết tiền đơn web'));
 if(!data||data.version!==1){box.append(el('p','muted','Đơn cũ chưa đồng bộ chi tiết mã giảm giá, đổi điểm và vận chuyển.'));return box;}
 const format=n=>new Intl.NumberFormat('vi-VN',{maximumFractionDigits:2}).format(n)+(currency==='VND'?' đ':' '+currency);
 const value=(n,tax=0)=>n===null||n===undefined?'Chưa có dữ liệu':format(n+(tax??0))+(tax===null?' (chưa có thuế chi tiết)':'');
 const add=(label,text)=>{const row=el('div','web-financial-row');row.append(el('span','',label),el('strong','',text));box.append(row);};
 if(data.itemsSubtotal!==null)add('Tiền hàng trước mã giảm giá',value(data.itemsSubtotal,data.itemsSubtotalTax));
 for(const c of data.coupons||[])add((c.points?'Đổi điểm / mã: ':'Mã giảm giá: ')+c.code,c.discount===null?'Chưa có dữ liệu':'−'+value(c.discount,c.tax));
 if(!data.coupons?.length&&data.discountTotal!==null)add('Giảm giá', '−'+value(data.discountTotal,data.discountTax));
 for(const f of data.fees||[])add(f.name||'Phí khác',value(f.total,f.tax));
 const methods=(data.shipping||[]).map(s=>s.title).filter(Boolean).join(', ');
 if(data.shippingTotal!==null)add('Phí vận chuyển thu khách'+(methods?' · '+methods:''),value(data.shippingTotal,data.shippingTax));
 else for(const s of data.shipping||[])add('Vận chuyển · '+s.title,value(s.total,s.tax));
 if(data.totalTax!==null)add('Thuế trong tổng nguồn',value(data.totalTax));
 if(data.total!==null)add('Tổng thanh toán từ website',value(data.total));
 if(data.points)box.append(el('p','muted small','Điểm đã đổi: '+(data.points.redeemed??'Chưa được nguồn gửi')+(data.points.amount!==null?' · Giá trị quy đổi tham chiếu: '+value(data.points.amount):'')+'. Đã phản ánh trong tổng nguồn, không trừ thêm.'));
 box.append(el('p','muted small','Phí vận chuyển trên đây là tiền thu khách; phí GHN được theo dõi riêng.'));
 return box;
}
