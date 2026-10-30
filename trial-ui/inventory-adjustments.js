import { downloadExcel } from './sheet-export.js';
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;};
const number=n=>Number(n||0).toLocaleString('vi-VN',{maximumFractionDigits:3});
const when=s=>s?new Date(s).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'—';
const states={pending:'Chờ Manager duyệt',approved:'Đã duyệt · đã ghi kho',rejected:'Đã từ chối'};
const btn=(text,fn,cls='btn secondary small')=>{const b=el('button',cls,text);b.type='button';b.onclick=fn;return b;};
const PILL={pending:'warn',approved:'ok',rejected:'danger'};
const field=(label,control)=>{const l=el('label');l.append(document.createTextNode(label),control);return l;};
const select=(options,label)=>{const s=el('select');s.setAttribute('aria-label',label);for(const [value,text] of options)s.append(Object.assign(el('option','',text),{value}));return s;};
const fill=(control,options,placeholder)=>{const value=control.value;control.replaceChildren(...[['',placeholder],...options].map(([value,text])=>Object.assign(el('option','',text),{value})));control.value=options.some(([v])=>v===value)?value:'';};
/** Tóm tắt dòng phiếu: số mã, mã lệch, tổng tăng / giảm (kiểm kê: thực đếm − tồn đối chiếu). */
export function adjustmentSummary(lines){
 const changed=lines.filter(l=>Math.abs(Number(l.qty)||0)>0.000001);
 const up=changed.filter(l=>l.qty>0).reduce((n,l)=>n+l.qty,0),down=changed.filter(l=>l.qty<0).reduce((n,l)=>n+l.qty,0);
 return {count:lines.length,changed:changed.length,up:Math.round(up*1000)/1000,down:Math.round(down*1000)/1000};
}
export function initAdjustmentQueue({api,host,toast,onChanged,kind,userId}){
 let config=null,sequence=0,offset=0,next=null,deepOpened='',opening=null,canApprove=false;
 const stocktake=kind==='stocktake',noun=stocktake?'phiếu kiểm kê':'phiếu cân bằng';
 // BỘ LỌC như trang Điều chuyển kho: chip trạng thái + khung lọc (tìm số phiếu / mã hàng, kho, người lập, trạng thái, khoảng ngày).
 const head=el('div','card-title-row'),bar=el('div','toolbar chips'),list=el('div','table-wrap'),feedback=el('p','muted transfer-filter-note'),error=el('p','error');
 feedback.setAttribute('role','status');
 head.append(el('h2','card-title',stocktake?'Phiếu kiểm kê đã gửi':'Phiếu cân bằng kho'),btn('Làm mới phiếu',()=>load(config)));
 const STATES=[['pending','Chờ duyệt'],['approved','Đã duyệt'],['rejected','Từ chối'],['','Tất cả']];
 const filter=select(STATES.map(([v,t])=>[v,v?t:'Tất cả trạng thái']),'Trạng thái phiếu điều chỉnh');filter.value='pending';
 const chips=STATES.map(([value,text])=>{const c=btn(text,()=>{filter.value=value;sync();offset=0;load(config);},'chip');c.dataset.status=value;bar.append(c);return c;});
 const sync=()=>chips.forEach(c=>c.classList.toggle('active',c.dataset.status===filter.value));sync();
 const form=el('form','transfer-filter-grid'),search=el('input');search.type='search';search.maxLength=80;search.placeholder=stocktake?'Số phiếu, mã sản phẩm hoặc lý do…':'Số phiếu, mã hàng hoặc lý do…';search.setAttribute('aria-label','Tìm '+noun);
 const warehouse=select([['','Tất cả kho']],'Lọc kho'),creator=select([['','Tất cả người lập']],'Lọc người lập');
 const from=el('input'),to=el('input');from.type=to.type='date';from.setAttribute('aria-label','Từ ngày lập');to.setAttribute('aria-label','Đến ngày lập');
 const apply=el('button','btn primary small','Lọc');apply.type='submit';
 const reset=btn('Xoá bộ lọc',()=>{search.value='';warehouse.value='';creator.value='';from.value='';to.value='';filter.value='pending';sync();offset=0;load(config);});
 form.append(field('Tìm '+noun,search),field('Kho',warehouse),field('Người lập',creator),field('Trạng thái',filter),field('Từ ngày lập',from),field('Đến ngày lập',to),apply,reset);
 form.addEventListener('submit',e=>{e.preventDefault();if(from.value&&to.value&&from.value>to.value){toast('Từ ngày phải trước hoặc bằng đến ngày.','err');return;}sync();offset=0;load(config);});
 filter.addEventListener('change',()=>{sync();offset=0;load(config);});
 const table=el('table','data-table inv-adjust-table'),thead=el('thead'),hr=el('tr'),tbody=el('tbody');
 for(const text of ['Số phiếu','Kho',stocktake?'Mã · lệch':'Số mã','Chênh lệch','Người lập','Trạng thái',''])hr.append(el('th','',text));thead.append(hr);table.append(thead,tbody);list.append(table);
 const pager=el('div','row-gap'),prev=btn('‹ Trang trước',()=>{offset=Math.max(0,offset-20);load(config);}),more=btn('Trang tiếp ›',()=>{if(next!==null){offset=next;load(config);}});pager.append(prev,more);
 host.append(head,bar,form,feedback,error,list,pager);
 function row(r){
  const sum=adjustmentSummary(r.lines),tr=el('tr','clickable');tr.tabIndex=0;
  const no=el('td','first');no.append(el('b','',r.refNo),el('small','',when(r.createdAt)));
  const delta=el('td','num');delta.dataset.label='Chênh lệch';
  delta.textContent=sum.changed?[sum.up?'+'+number(sum.up):'',sum.down?'−'+number(-sum.down):''].filter(Boolean).join(' / '):'Khớp tồn';
  if(sum.down)delta.classList.add('danger-text');
  const status=el('td');status.dataset.label='Trạng thái';status.append(el('span','pill '+(PILL[r.status]||''),states[r.status]));
  const actions=el('td','actions-cell'),wrap=el('div','row-actions');
  wrap.append(btn(r.status==='pending'&&canApprove?'Xem & duyệt':'Xem phiếu',e=>{e?.stopPropagation?.();open(r.id);},r.status==='pending'&&canApprove?'btn primary small':'btn secondary small'));actions.append(wrap);
  const cells=[el('td','',r.warehouseName),el('td','',stocktake?`${sum.count} mã · ${sum.changed} lệch`:`${sum.count} mã`),delta,el('td','',r.createdByName),status];
  cells[0].dataset.label='Kho';cells[1].dataset.label=stocktake?'Mã · lệch':'Số mã';cells[3].dataset.label='Người lập';
  tr.title=r.reason;tr.append(no,...cells,actions);
  tr.addEventListener('click',()=>open(r.id));tr.addEventListener('keydown',e=>{if(e.key==='Enter')open(r.id);});
  return tr;
 }
 async function load(value){
  if(!value)return;config=value;const mine=++sequence,owner=userId?.();error.textContent='';prev.disabled=more.disabled=true;feedback.textContent='Đang tải '+noun+'…';
  fill(warehouse,(config.warehouses||[]).map(w=>[w.id,w.name]),'Tất cả kho');
  try{
   const p=new URLSearchParams({status:filter.value,offset:String(offset)});if(kind)p.set('kind',kind);
   for(const [key,control] of [['q',search],['warehouseId',warehouse],['createdBy',creator],['from',from],['to',to]])if(control.value.trim())p.set(key,control.value.trim());
   const data=await api('/inventory/adjustments?'+p);if(mine!==sequence||owner!==userId?.())return;
   next=data.nextOffset;canApprove=!!data.canApprove;fill(creator,(data.filterOptions?.creators||[]).map(m=>[m.id,m.name]),'Tất cả người lập');
   tbody.replaceChildren(...(data.adjustments.length?data.adjustments.map(row):[(()=>{const tr=el('tr'),td=el('td','muted','Không có '+noun+' phù hợp bộ lọc.');td.colSpan=7;tr.append(td);return tr;})()]));
   const waiting=data.adjustments.filter(r=>r.status==='pending').length;
   feedback.textContent=data.adjustments.length?`${noun[0].toUpperCase()+noun.slice(1)} ${offset+1}–${offset+data.adjustments.length}`+(canApprove&&waiting?` · ${waiting} phiếu chờ Manager duyệt`:''):'Không có '+noun+' phù hợp bộ lọc.';
   prev.disabled=!offset;more.disabled=next===null;
   const id=new URLSearchParams(location.hash.split('?')[1]||'').get('adjustment');if(id&&id!==deepOpened){deepOpened=id;await open(id);}
  }catch(e){if(mine===sequence&&owner===userId?.()){error.textContent=e.message;feedback.textContent='Chưa tải được danh sách phiếu.';}}
 }
 function open(id){
  if(opening)return opening;
  const next=draw(id).finally(()=>{if(opening===next)opening=null;});opening=next;return next;
 }
 async function draw(id){
  const owner=userId?.();
  let data;try{data=await api((kind==='stocktake'?'/inventory/stocktakes/':'/inventory/adjustments/')+encodeURIComponent(id));}catch(e){if(owner===userId?.())toast(e.message,'err');return;}
  if(owner!==userId?.())return;
  const r=data.adjustment,dialog=el('dialog','modal inv-adjust-review'),head=el('div','modal-head'),body=el('div','modal-body'),foot=el('div','modal-foot');
  let busy=false;const close=()=>{if(!busy)dialog.close();};head.append(el('h2','',r.refNo),btn('Đóng',close));
  body.append(el('p','',states[r.status]),el('p','muted small',`${r.warehouseName} · Người lập: ${r.createdByName} · ${when(r.createdAt)}`),el('p','',r.reason));
  if(r.reviewedAt)body.append(el('p','small',`Xử lý bởi ${r.reviewedByName} · ${when(r.reviewedAt)}${r.reviewNote?' · '+r.reviewNote:''}`));
  const table=el('table','data-table'),thead=el('thead'),tr=el('tr'),tbody=el('tbody');for(const text of ['Mã hàng','Sản phẩm','Tồn đối chiếu','Điều chỉnh','Thực đếm / sau điều chỉnh'])tr.append(el('th','',text));thead.append(tr);
  for(const l of r.lines){const row=el('tr'),before=data.balances[l.sku]||0;for(const value of [l.sku,data.names?.[l.sku]?.name||'—',number(l.source==='stocktake'?l.expectedQty:before),(l.qty>0?'+':'')+number(l.qty),l.source==='stocktake'?number(l.countedQty):r.status==='pending'?number(before+l.qty):'Đã xử lý'])row.append(el('td','',value));tbody.append(row);}
  table.append(thead,tbody);const wrap=el('div','table-wrap');wrap.append(table);body.append(wrap);
  if(r.status==='pending')body.append(el('p','muted small','Phiếu chờ duyệt chưa làm thay đổi tồn. Chỉ Manager duyệt mới ghi tăng/giảm vào sổ kho.'));
  const error=el('p','error');error.setAttribute('role','alert');body.append(error);
  if(r.status==='pending'&&data.canApprove){
   const note=el('textarea');note.maxLength=500;note.placeholder='Ghi chú duyệt / lý do từ chối';note.setAttribute('aria-label','Ghi chú xét duyệt');body.append(note);
   const review=async decision=>{if(busy)return;if(decision==='rejected'&&note.value.trim().length<3){error.textContent='Nhập lý do từ chối.';return;}busy=true;error.textContent='';approve.disabled=reject.disabled=true;
    try{await api('/inventory/adjustments/'+encodeURIComponent(id)+'/review','POST',{decision,note:note.value.trim()});busy=false;dialog.close();toast(decision==='approved'?'Đã duyệt và ghi tồn kho.':'Đã từ chối phiếu, không đổi tồn.');await onChanged();}
    catch(e){error.textContent=e.message;busy=false;approve.disabled=reject.disabled=false;}
   };
   const approve=btn('Duyệt hoàn thành và ghi kho',()=>review('approved'),'btn primary'),reject=btn('Từ chối phiếu',()=>review('rejected'));approve.dataset.mobilePrimary='';foot.append(reject,approve);
  }
  // Xuất Excel phiếu (đối chiếu / lưu hồ sơ): mã, tồn đối chiếu, điều chỉnh, thực đếm.
  foot.append(btn('Xuất Excel',()=>downloadExcel((kind==='stocktake'?'kiem-ke_':'can-bang-kho_')+r.refNo,[{name:r.refNo,header:['Mã hàng','Sản phẩm','ĐVT','Tồn đối chiếu','Thực đếm / sau điều chỉnh','Chênh lệch'],
   rows:r.lines.map(l=>{const before=l.source==='stocktake'?l.expectedQty:data.balances[l.sku]||0;return [l.sku,data.names?.[l.sku]?.name||'',data.names?.[l.sku]?.unit||'',before,l.source==='stocktake'?l.countedQty:before+l.qty,l.qty];}),widths:[18,40,8,14,22,12],autoFilter:true}])));
  foot.append(btn('Đóng',close));dialog.append(head,body,foot);document.body.append(dialog);dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
 }
 return {load,open};
}
