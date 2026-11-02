import {webOrderFinancialSummary} from './web-order-financials.js';
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;};
const button=(text,fn,cls='btn secondary')=>{const b=el('button',cls,text);b.type='button';b.addEventListener('click',fn);return b;};
const money=(n,c='VND')=>n==null?'Chưa có dữ liệu':new Intl.NumberFormat('vi-VN',{maximumFractionDigits:2}).format(Number(n))+(c==='VND'?' đ':' '+c);
const field=(label,value,type='number')=>{const box=el('label','web-edit-field'),input=el('input');input.type=type;input.value=value??'';if(type==='number'){input.min='0';input.step='any';}box.append(el('span','',label),input);return{box,input};};
export function webDocumentMode(view,root,enabled){
 for(const child of view.children)if(child!==root){if(enabled){if(child.dataset.webWasHidden===undefined)child.dataset.webWasHidden=child.hidden?'1':'0';child.hidden=true;}else if(child.dataset.webWasHidden!==undefined){child.hidden=child.dataset.webWasHidden==='1';delete child.dataset.webWasHidden;}}
 root.hidden=!enabled;
}
/** Read the same web identity used by POS/GHN/stock. Never pretend it is a second sales order. */
export function initWebOrderDocument({root,api,toast,onPrint,go}){
 let generation=0;
 const stockLabels={none:'Chưa xuất kho – chờ GHN xác nhận lấy hàng',issued:'Đã xuất kho theo GHN',returned:'Đã hoàn kho theo GHN',blocked:'Cần đối soát kho',legacy:'Đối soát theo hồ sơ cũ'};
 function paper(d,kind='order'){
  const o=d.document,p=el('article','web-order-paper'),banner=el('img','slip-letterhead');banner.src='slip-letterhead.jpg';banner.alt='Công ty Bách Ngân';p.append(banner);
  p.append(el('h1','',kind==='delivery'?'PHIẾU GIAO HÀNG':kind==='packing'?'PHIẾU ĐÓNG GÓI':'ĐƠN ĐẶT HÀNG'),el('h2','',o.orderNo));
  for(const [k,v]of [['Số đơn website',o.sourceOrderNo],['Nguồn',o.source==='lock'?'Web LocknLock':'Web Minh Long'],['Cửa hàng',o.branchName],['Khách hàng',o.customerName],['Điện thoại',o.phone],['Địa chỉ',o.address],['Vận đơn GHN',o.ghnOrderCode||'Chưa tạo'],['Trạng thái GHN',o.ghnStatus||'Chưa có']])p.append(el('p','',`${k}: ${v||'—'}`));
  const table=el('table','data-table ddh-table ship-table'),head=el('thead'),hr=el('tr'),body=el('tbody');
  const headers=['STT','Mã hàng','Sản phẩm','ĐVT','Số lượng',...(kind==='order'?['Đơn giá trước CK / mã giảm (gồm VAT)','CK / giảm đã phân bổ','Tiền hàng sau giảm']:[])];
  for(const t of headers)hr.append(el('th','',t));head.append(hr);
  d.items.forEach((l,i)=>{
   const row=el('tr'),qty=Number(l.quantity)||0,knownTax=l.totalTax!=null,base=l.subtotal!=null&&l.subtotalTax!=null?Number(l.subtotal)+Number(l.subtotalTax):null,net=l.total!=null?Number(l.total)+(knownTax?Number(l.totalTax):0):null;
   for(const value of [i+1,l.sku||'—',l.name||'—',l.unit||'—',qty,...(kind==='order'?[base==null?'Chưa có giá gốc':money(qty?base/qty:0,o.currency),base==null||net==null?'Chưa có chi tiết':money(Math.max(0,base-net),o.currency),money(net,o.currency)+(knownTax?'':' (chưa có VAT chi tiết)')]:[])])row.append(el('td','',value));body.append(row);
  });table.append(head,body);p.append(table);
  if(kind==='order'){p.append(el('p','muted small','Chiết khấu/mã giảm từ web có thể đã phân bổ vào dòng hàng; không trừ thêm lần nữa.'),webOrderFinancialSummary(o.financials,o.currency),el('h3','',`Tổng thanh toán: ${money(o.total,o.currency)}`));}
  else p.append(el('p','small','Số lượng theo đơn hiện tại. Bản in không xác nhận đã giao hoặc đã xuất kho; đối chiếu hàng thực tế khi ký nhận.'));
  return p;
 }
 async function edit(d){
  const o=d.document,seq=generation,form=el('form','card web-order-edit'),rows=el('div','web-edit-lines'),error=el('p','error'),total=el('p','web-edit-total');error.setAttribute('role','alert');
  const controls=[],key=crypto.randomUUID();let checked=null,saving=false;
  form.append(el('h2','','Sửa sản phẩm và giá trước GHN'),el('p','muted','Đơn giá nhập đã gồm VAT. Kiểm tra lại giảm giá khi đổi sản phẩm; mã/điểm từ website không được tự kiểm tra điều kiện áp dụng lại.'),error,rows);
  function addLine(l={}){
   const card=el('fieldset','web-edit-line'),sku=field('Mã hàng',l.sku||'','text'),qty=field('Số lượng',l.qty??1),price=field('Đơn giá gồm VAT',l.unitPrice??0),tax=field('VAT %',l.taxRate??0),discount=field('CK dòng',l.discountValue??0),mode=el('select'),name=el('p','small',l.name||''),results=el('div','web-edit-search-results');
   for(const[v,t]of [['amount','VNĐ / dòng'],['percent','%']]){const op=el('option','',t);op.value=v;mode.append(op);}mode.value=l.discountType||'amount';
   const line={card,sku,qty,price,tax,discount,mode};controls.push(line);
   const find=button('Tìm mã / sản phẩm',async()=>{
    find.disabled=true;results.replaceChildren();try{
     const r=await api('/pos/catalog?'+new URLSearchParams({registerId:o.registerId,q:sku.input.value,limit:'8'}));
     for(const p of r.products||[])results.append(button(`${p.sku} · ${p.name} · ${p.stockStatus==='unopened'?'Chưa chốt tồn':'Còn '+(p.available??0)}`,()=>{sku.input.value=p.sku;name.textContent=p.name;const rate=p.taxRate??d.catalogPricing.taxRate;price.input.value=d.catalogPricing.priceIncludesVat?(p.unitPrice??p.price??0):Math.round((p.unitPrice??p.price??0)*(1+rate/100));tax.input.value=rate;checked=null;results.replaceChildren();},'btn ghost small'));
     if(!results.children.length)results.append(el('p','muted','Không tìm thấy mã phù hợp.'));
    }catch(e){error.textContent=e.message;}finally{find.disabled=false;}
   },'btn secondary small');
   card.append(sku.box,find,name,results,qty.box,price.box,tax.box,discount.box,mode,button('Bỏ dòng',()=>{const i=controls.indexOf(line);if(i>=0)controls.splice(i,1);card.remove();checked=null;},'btn ghost small'));
   if(l.pricingIncomplete)card.append(el('p','danger-text small','Đơn cũ thiếu giá gốc/thuế chi tiết: xác minh và nhập lại giá đúng trước khi lưu.'));
   rows.append(card);
  }
  for(const l of d.editor.lines)addLine(l);
  const orderDiscount=field('Giảm thêm cả đơn (đ)',d.editor.orderDiscount),shipping=field('Phí vận chuyển thu khách (đ)',d.editor.shippingFee),fee=field('Phí khác thu khách (đ)',d.editor.feeAmount),reason=field('Lý do sửa', '', 'text');reason.input.required=true;
  const shippingTax=field('VAT phí vận chuyển %',d.editor.shippingTaxRate??0),feeTax=field('VAT phí khác %',d.editor.feeTaxRate??0);
  const reviewed=field('Đã kiểm tra giá, CK, VAT, phí và tổng tiền','', 'checkbox');reviewed.input.checked=false;
  const payment=field('Đã đối chiếu thanh toán với khách / chứng từ','', 'checkbox');payment.input.checked=false;
  const payload=()=>({lines:controls.map(l=>({sku:l.sku.input.value.trim(),qty:Number(l.qty.input.value),unitPrice:Number(l.price.input.value),taxRate:Number(l.tax.input.value),discountType:l.mode.value,discountValue:Number(l.discount.input.value)})),orderDiscount:Number(orderDiscount.input.value),shippingFee:Number(shipping.input.value),feeAmount:Number(fee.input.value),shippingTaxRate:Number(shippingTax.input.value),feeTaxRate:Number(feeTax.input.value),reason:reason.input.value.trim()});
  const fingerprint=()=>JSON.stringify(payload());
  const preview=button('Kiểm tra tổng tiền',async()=>{preview.disabled=true;error.textContent='';try{const p=payload(),r=await api('/orders/'+encodeURIComponent(o.id)+'/web/preview','POST',p);checked={fingerprint:fingerprint(),total:r.total};total.textContent='Tổng bản sửa: '+money(r.total,o.currency);}catch(e){checked=null;error.textContent=e.message;}finally{preview.disabled=false;}});
  const save=el('button','btn primary','Lưu bản sửa');save.type='submit';
  form.append(button('＋ Thêm sản phẩm',()=>addLine()),orderDiscount.box,shipping.box,shippingTax.box,fee.box,feeTax.box,reason.box,reviewed.box,payment.box,total,preview,save,button('Huỷ sửa',()=>render(d)));
  form.addEventListener('input',e=>{if(e.target.type==='checkbox')return;checked=null;total.textContent='Đã đổi dữ liệu – cần kiểm tra lại tổng tiền.';});
  form.addEventListener('submit',async e=>{e.preventDefault();if(saving)return;
   if(!checked||checked.fingerprint!==fingerprint()){error.textContent='Bấm Kiểm tra tổng tiền cho nội dung hiện tại trước khi lưu.';return;}
   saving=true;save.disabled=true;error.textContent='';
   try{const r=await api('/orders/'+encodeURIComponent(o.id)+'/web-edit','PUT',{...payload(),clientKey:key,revision:d.revision,sourceHash:d.sourceHash,expectedTotal:checked.total,pricingReviewed:reviewed.input.checked,paymentReviewed:payment.input.checked});if(seq!==generation)return;toast('Đã lưu bản sửa CRM.');render(r);root.scrollIntoView({block:'start'});}
   catch(e){error.textContent=e.message||'Chưa rõ kết quả lưu; kiểm tra lại đơn trước khi sửa tiếp.';}
   finally{saving=false;save.disabled=false;}
  });
  root.replaceChildren(form);
 }
 function render(d){
  generation++;const o=d.document,head=el('div','editor-head'),left=el('div','editor-title'),back=el('a','btn ghost small','‹ Đơn đặt hàng');back.href='#/orders';left.append(back,el('h1','',o.orderNo));
  const actions=el('div','row-gap');
  for(const[kind,label]of [['order','In / lưu đơn hàng'],['packing','In phiếu đóng gói'],['delivery','In phiếu giao hàng']]){const b=button(label,()=>onPrint(paper(d,kind).outerHTML,o.orderNo,kind));b.disabled=!d.items.length;actions.append(b);}
  actions.append(button('Tải lại',async()=>{try{const next=await api('/orders/'+encodeURIComponent(o.id));if(root.hidden)return;render(next);}catch(e){toast(e.message,'err');}}));
  if(d.canEdit)actions.append(button('Sửa sản phẩm / giá',()=>edit(d),'btn primary'));
  if(d.canManage){const a=el('a','btn secondary','Xử lý tại Bán hàng nhanh');a.href='#/pos?webOrderId='+encodeURIComponent(o.webOrderId);actions.append(a);}
  head.append(left,actions);root.replaceChildren(head);
  if(!d.items.length)root.append(el('p','error','Chưa nhận được chi tiết sản phẩm từ website. Cần đồng bộ đủ hoặc bổ sung sản phẩm trước khi in/tạo GHN.'));
  if(o.edited)root.append(el('p','approval-box','Đã chỉnh trên CRM; đơn website gốc được giữ để đối chiếu.'));
  if(o.sourceConflict)root.append(el('p','error','Website có thay đổi khác bản CRM. Nội dung CRM được giữ; cần đối soát giá và thanh toán.'));
  if(o.ghnCartReviewRequired)root.append(el('p','error','Vận đơn và bản sửa cần đối soát sản phẩm. Chưa tự xuất kho.'));
  if(d.editBlocked)root.append(el('p','muted',d.editBlocked));
  const status=el('div','card');status.append(el('p','',stockLabels[o.stockStatus]||'Chưa có thông tin kho'));
  if(o.stockNote)status.append(el('p','danger-text',o.stockNote));
  status.append(el('p','','Thanh toán: '+(o.paid==null?'Chưa có đủ dữ liệu đối chiếu':o.paid>=o.total?'Đã ghi nhận thanh toán':'Còn phải thu '+money(o.total-o.paid,o.currency))));
  if(o.ghnOrderCode){const a=el('a','btn secondary','Mở GHN · '+o.ghnOrderCode);a.href='https://khachhang.ghn.vn/order/detail?order_code='+encodeURIComponent(o.ghnOrderCode);a.target='_blank';a.rel='noopener noreferrer';status.append(a);}
  root.append(status,paper(d));
  if(d.originalFinancials){const old=el('details','card');old.append(el('summary','','Chi tiết tiền website trước khi sửa'),webOrderFinancialSummary(d.originalFinancials,o.currency));root.append(old);}
 }
 return {render,print:(d,kind='order')=>onPrint(paper(d,kind).outerHTML,d.document.orderNo,kind)};
}
