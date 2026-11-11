import {orderProductState,fulfilmentBadge,fulfilmentLegend,compactFulfilmentTable} from './fulfilment-display.js';
import {setProductThumbnail} from './product-images.js';
import { createPager } from './pager.js';
import {ghnStatusLabel} from './ghn-order-summary.js';
const STATES = [['work','Cần xử lý'],['partial','Giao một phần'],['overdue','Quá hạn'],['unscheduled','Chưa xếp đủ lịch'],['delivered','Đã giao đủ'],['all','Tất cả']];
const TRIP = {planned:'Chưa giao',in_transit:'Đang giao',delivered:'Đã giao',failed:'Giao lỗi',cancelled:'Đã huỷ'};
const el = (tag, text, cls) => { const n=document.createElement(tag); if(text!=null)n.textContent=String(text); if(cls)n.className=cls; return n; };
const button = (label, fn, cls='btn secondary small') => { const b=el('button',label,cls);b.type='button';b.setAttribute('data-mobile-navigation','');b.addEventListener('click',fn);return b; };
const qty = n => Number(n).toLocaleString('vi-VN');
const date = d => d ? d.slice(8)+'/'+d.slice(5,7)+'/'+d.slice(0,4) : 'Chưa hẹn';
export const orderProductDueLabel = row => row.orderStatus==='cancelled' ? 'Đã huỷ' : row.remainingQty<=1e-9 ? 'Đã giao đủ' : date(row.nextDeliveryDate);
export function orderProductHref(row, schedule=false) {
  return (row.contractNo?'#/contracts/':'#/orders/')+encodeURIComponent(row.orderId)+(schedule?'?scheduleLine='+encodeURIComponent(row.id):'');
}
export const orderProductImage = url => { try { return new URL(url).protocol==='https:' ? url : ''; } catch { return ''; } };

export const orderProductGhnShipments = row => (row.trips || []).filter(t=>String(t.carrier||'').trim().toLowerCase()==='ghn' && String(t.trackingCode||'').trim());
export const orderProductGhnLabel = trip => `${trip.trackingCode} · ${ghnStatusLabel(trip.trackingStatus)}`;

export function initOrderProducts({root,api,go,money,canCalendar=()=>true,canOrder=()=>true}) {
  let data=null,status='work',request=0,dialog=null;
  const close=()=>{dialog?.close();dialog?.remove();dialog=null;};
  const head=el('div',null,'page-head'),titles=el('div');titles.append(el('span','Bán hàng','eyebrow'),el('h1','Sản phẩm theo đơn'),el('p','Theo dõi dòng hàng thật của đơn CRM / POS: số đã giao, còn giao và các đợt giao.','muted'));
  head.append(titles);if(canCalendar()){const a=el('a','Xem lịch giao hàng','btn secondary');a.href='#/deliveries';head.append(a);}
  const note=el('p','Đơn website chưa chuyển vào CRM xem tại Đơn đặt hàng. Số lượng theo từng dòng và đơn vị tính; không cộng gộp Cái và Bộ.','muted small');
  const panel=el('div',null,'panel op-panel'),searchLabel=el('label','Tìm sản phẩm, SKU, khách, số đơn / HĐKT'),search=el('input');search.type='search';search.maxLength=200;search.placeholder='Nhập từ khóa, có thể tìm không dấu…';searchLabel.append(search);
  const advanced=el('details',null,'op-filters'),summary=el('summary','Bộ lọc chi tiết');advanced.append(summary);const fields=el('div',null,'op-filter-grid');advanced.append(fields);
  const inputs={};
  const select=(key,label,options)=>{const field=el('label',label),s=el('select');s.setAttribute('aria-label',label);for(const [value,text] of options){const o=el('option',text);o.value=value;s.append(o);}field.append(s);fields.append(field);inputs[key]=s;return s;};
  select('owner','Nhân viên phụ trách',[['','Tất cả nhân viên']]);
  select('kind','Loại chứng từ',[['','Đơn hàng + HĐKT'],['order','Đơn hàng'],['contract','HĐKT']]);
  select('channel','Nguồn đơn',[['','CRM + POS'],['crm','CRM'],['pos','POS']]);
  select('orderStatus','Trạng thái đơn',[['','Trừ đơn đã huỷ'],['draft','Chờ duyệt'],['confirmed','Đã xác nhận'],['delivering','Đang giao'],['delivered','Đã giao'],['cancelled','Đã huỷ']]);
  for(const [key,label] of [['from','Hạn giao từ'],['to','Hạn giao đến']]){const field=el('label',label),input=el('input');input.type='date';field.append(input);fields.append(field);inputs[key]=input;}
  select('sort','Sắp xếp',[['due','Hạn giao gần nhất'],['updated','Đơn cập nhật mới'],['customer','Tên khách hàng'],['owner','Nhân viên phụ trách']]);
  fields.append(button('Xóa bộ lọc',()=>{search.value='';for(const [key,input]of Object.entries(inputs))input.value=key==='sort'?'due':'';status='work';pager.reset();load();}));
  panel.append(searchLabel,advanced);
  const cards=el('div',null,'op-stats'),feedback=el('p',null,'muted small op-feedback');feedback.setAttribute('role','status');
  const body=el('div',null,'table-wrap op-table-wrap'),pagerHost=el('div',null,'pager'),retry=button('Thử lại',()=>load());retry.hidden=true;
  body.tabIndex=0;body.setAttribute('aria-label','Bảng sản phẩm theo đơn, cuộn ngang để xem thêm cột');
  root.replaceChildren(head,note,panel,cards,feedback,retry,fulfilmentLegend(['unscheduled','planned','in_transit','partial','overdue','delivered','cancelled']),body,pagerHost);
  const pager=createPager(pagerHost,'order-products',()=>load(),50);
  for(const input of Object.values(inputs))input.addEventListener('change',()=>{pager.reset();load();});
  let timer;search.addEventListener('input',e=>{if(e.isComposing)return;clearTimeout(timer);timer=setTimeout(()=>{pager.reset();load();},350);});
  search.addEventListener('compositionend',()=>{clearTimeout(timer);timer=setTimeout(()=>{pager.reset();load();},350);});
  function details(row) {
    close();dialog=el('dialog',null,'modal op-dialog');dialog.setAttribute('aria-labelledby','op-dialog-title');
    const head=el('div',null,'modal-head'),title=el('h2',row.name);title.id='op-dialog-title';const x=button('×',close,'icon-btn');x.setAttribute('aria-label','Đóng chi tiết dòng hàng');head.append(title,x);
    const content=el('div',null,'modal-body');content.append(el('p',`${row.sku || 'Không có SKU'} · ${row.contractNo || row.orderNo} · ${row.customerName}`),el('p',`Đặt ${qty(row.qty)} ${row.unit} · Đã giao ${qty(row.deliveredQty)} · Còn ${qty(row.remainingQty)} · Đang xếp lịch ${qty(row.scheduledQty)} · Chưa xếp ${qty(row.availableQty)}`));
    content.append(el('p',`Phụ trách: ${row.ownerName||'Chưa phân công'}`));
    const ghn=orderProductGhnShipments(row);content.append(el('h3','Vận đơn GHN'));
    if(ghn.length){const list=el('ul',null,'plain-list');for(const trip of ghn)list.append(el('li',orderProductGhnLabel(trip)));content.append(list);}else content.append(el('p','Chưa có vận đơn GHN'));
    content.append(el('p',`Tiến độ cấp đơn: ${row.progress?.label||'Chưa có tiến độ'}`));
    if(row.unitPrice!=null)content.append(el('p',`Đơn giá sau chiết khấu, chưa VAT: ${money(row.unitPrice)} · VAT ${qty(row.taxRate)}% · Giá trị toàn dòng chưa VAT: ${money(row.amount)}`));
    content.append(el('h3','Các đợt giao của dòng hàng'));const trips=el('ul',null,'plain-list');
    for(const t of row.trips){const li=el('li'),label=`${t.deliveryNo} · ${date(t.plannedDate)} ${t.timeSlot} · ${qty(t.qty)} ${row.unit} · ${TRIP[t.status]||t.status}`;if(canCalendar()){const a=el('a',label);a.href='#/deliveries?deliveryId='+encodeURIComponent(t.id);a.addEventListener('click',close);li.append(a);}else li.append(el('span',label));trips.append(li);}
    if(!row.trips.length)trips.append(el('li','Dòng này chưa có chuyến giao.'));content.append(trips,el('p','Chuyến giao lỗi / huỷ không giữ số lượng chờ giao. Tiến độ in, sản xuất và xuất kho là tiến độ cấp đơn.','muted small'));
    const foot=el('div',null,'modal-foot');if(canOrder(row))foot.append(button('Mở đơn / HĐKT',()=>{close();go(orderProductHref(row));}));if(row.canSchedule)foot.append(button('Xếp lịch giao',()=>{close();go(orderProductHref(row,true));},'btn primary'));
    dialog.append(head,content,foot);dialog.addEventListener('cancel',close);document.body.append(dialog);dialog.showModal();
  }
  function render() {
    cards.replaceChildren();for(const [key,label]of STATES){const b=button('',()=>{status=key;pager.reset();load();},'stat op-stat'+(key===status?' active':''));b.setAttribute('aria-pressed',String(key===status));b.append(el('small',label),el('strong',qty(data.counts[key])),el('small','dòng hàng'));cards.append(b);}
    const table=el('table',null,'data-table op-table'),thead=el('thead'),tr=el('tr'),headers=['Sản phẩm','Đơn · Khách hàng','Số đơn GHN / Trạng thái GHN','Đã giao / Đặt · Còn','Hạn giao','Trạng thái','Tiến độ cấp đơn','Thao tác'];for(const h of headers)tr.append(el('th',h));thead.append(tr);table.append(thead);const tb=el('tbody');
    for(const row of data.lines){const state=orderProductState(row),tr=el('tr',null,'ff-row ff-'+state);tr.dataset.orderLine=row.id;const name=el('td',null,'ff-product'),image=orderProductImage(row.imageUrl);if(image){const img=el('img');img.alt='';setProductThumbnail(img,image,'list',()=>img.remove());name.append(img);}name.append(button(row.name,()=>details(row),'btn ghost op-product-name'));
      const order=el('td'),a=el('a',row.contractNo||row.orderNo);a.href=orderProductHref(row);order.append(canOrder(row)?a:el('span',row.contractNo||row.orderNo),el('small',row.customerName));
      const shipping=el('td',null,'op-ghn'),shipments=orderProductGhnShipments(row);
      if(!shipments.length)shipping.append(el('span','Chưa có vận đơn GHN','muted'));
      for(const [index,trip] of shipments.entries()){if(index)shipping.append(document.createTextNode(' | '));const label=orderProductGhnLabel(trip);if(canCalendar()){const link=el('a',label);link.href='#/deliveries?deliveryId='+encodeURIComponent(trip.id);shipping.append(link);}else shipping.append(el('span',label));}
      const numbers=el('td');numbers.append(el('strong',`${qty(row.deliveredQty)} / ${qty(row.qty)} ${row.unit}`));const progress=el('progress');progress.max=row.qty;progress.value=row.deliveredQty;progress.setAttribute('aria-label',`Đã giao ${qty(row.deliveredQty)} trên ${qty(row.qty)} ${row.unit}`);numbers.append(progress,el('small',`Còn ${qty(row.remainingQty)} · Chưa xếp lịch ${qty(row.availableQty)}`));
      const due=el('td');due.append(el('strong',orderProductDueLabel(row)));if(row.remainingQty>1e-9&&row.orderStatus!=='cancelled')due.append(el('small',row.overdue?'Quá hạn':row.availableQty>0?'Còn phần chưa xếp lịch':'Theo chuyến chờ / đang giao',row.overdue?'danger-text':'muted'));
      const actions=el('td',null,'op-actions');actions.append(button('Chi tiết',()=>details(row)));if(row.canSchedule)actions.append(button('Xếp lịch',()=>go(orderProductHref(row,true)),'btn primary small'));
      tr.append(name,order,shipping,numbers,due,el('td'),el('td',row.progress?.label||'Chưa có tiến độ'),actions);tr.children[5].append(fulfilmentBadge(state,state==='delivered'?'Đã giao đủ':undefined));[...tr.children].forEach((td,i)=>td.dataset.label=headers[i]);tb.append(tr);
    }
    if(!data.lines.length){const tr=el('tr'),td=el('td','Không có dòng sản phẩm phù hợp bộ lọc.','empty');td.colSpan=8;tr.append(td);tb.append(tr);}table.append(tb);compactFulfilmentTable(table);body.replaceChildren(table);
    feedback.textContent=`${qty(data.total)} dòng phù hợp · Tính ngày ${date(data.calculatedDate)} · Mỗi dòng giữ nguyên đơn vị tính.`;
  }
  async function load() {
    const id=++request;close();retry.hidden=true;body.replaceChildren();cards.replaceChildren();pagerHost.hidden=true;feedback.textContent='Đang tải sản phẩm theo đơn…';body.setAttribute('aria-busy','true');
    const params=new URLSearchParams({status,q:search.value,limit:String(pager.limit),offset:String(pager.offset)});for(const [key,input]of Object.entries(inputs))if(input.value)params.set(key,input.value);
    try{const result=await api('/order-products?'+params);if(id!==request)return;data=result;
      const selected=inputs.owner.value;inputs.owner.replaceChildren();for(const owner of [{id:'',name:'Tất cả nhân viên'},...data.filterOptions.owners]){const o=el('option',owner.name);o.value=owner.id;inputs.owner.append(o);}inputs.owner.value=selected;
      const oldPage=pager.page;pager.render(data.total);if(oldPage!==pager.page)return load();render();
    }catch(e){if(id!==request)return;data=null;body.replaceChildren();cards.replaceChildren();pagerHost.hidden=true;feedback.textContent=e.message||'Chưa tải được sản phẩm theo đơn.';retry.hidden=false;}
    finally{if(id===request)body.removeAttribute('aria-busy');}
  }
  return {load,close};
}
