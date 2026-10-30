import { downloadExcel } from './sheet-export.js';
import { printSheet } from './print-page.js';
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;};
const number=n=>Number(n||0).toLocaleString('vi-VN',{maximumFractionDigits:3});
const when=s=>s?new Date(s).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'—';
const states={pending:'Chờ Manager duyệt',approved:'Đã duyệt · đã ghi kho',rejected:'Đã từ chối'};
const btn=(text,fn,cls='btn secondary small')=>{const b=el('button',cls,text);b.type='button';b.onclick=fn;return b;};
const PILL={pending:'warn',approved:'ok',rejected:'danger'};
const field=(label,control)=>{const l=el('label');l.append(document.createTextNode(label),control);return l;};
const select=(options,label)=>{const s=el('select');s.setAttribute('aria-label',label);for(const [value,text] of options)s.append(Object.assign(el('option','',text),{value}));return s;};
const fill=(control,options,placeholder)=>{const value=control.value;control.replaceChildren(...[['',placeholder],...options].map(([value,text])=>Object.assign(el('option','',text),{value})));control.value=options.some(([v])=>v===value)?value:'';};
const money=n=>Math.round(Number(n)||0).toLocaleString('vi-VN')+' đ';
const signedMoney=n=>(n>0?'+':n<0?'−':'')+money(Math.abs(n));
/**
 * In phiếu đếm / phiếu kiểm kê (A4): mã, tên, ĐVT, tồn sổ kho, ô thực đếm (trống nếu chưa đếm), ghi chú; chữ ký người đếm / Manager.
 * `lines` = [{sku,name,unit,expected,counted}].
 */
export function printCountSheet({title='PHIẾU KIỂM KÊ',refNo='',warehouse='',reason='',lines=[]}){
 const out=document.getElementById('print-sheet');if(!out)return;
 const head=el('div','ps-head'),brand=el('div','ps-brand'),meta=el('div','ps-meta');
 brand.append(el('span','ps-mark','BN'),el('b','','BÁCH NGÂN'));
 meta.append(el('div','',refNo?'Số phiếu: '+refNo:'Phiếu đếm (chưa gửi)'),el('div','','In lúc: '+new Date().toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})));head.append(brand,meta);
 const info=el('div','ps-info');info.append(el('p','','Kho: '+(warehouse||'—')),el('p','','Lý do: '+(reason||'—')),el('p','','Số mã: '+lines.length),el('p','','Người đếm: ............................................'));
 const table=el('table','ps-table'),thead=el('thead'),hr=el('tr'),tbody=el('tbody');
 for(const h of ['STT','Mã hàng','Sản phẩm','ĐVT','Tồn sổ kho','Thực đếm','Chênh lệch','Ghi chú'])hr.append(el('th','',h));thead.append(hr);
 lines.forEach((l,i)=>{const tr=el('tr'),has=l.counted!==null&&l.counted!==undefined&&l.counted!=='';
  tr.append(el('td','c',i+1),el('td','',l.sku),el('td','',l.name||''),el('td','c',l.unit||''),el('td','n',l.expected===null||l.expected===undefined?'':number(l.expected)),
   el('td','n',has?number(l.counted):''),el('td','n',has&&l.expected!==null&&l.expected!==undefined?(l.counted-l.expected>0?'+':'')+number(l.counted-l.expected):''),el('td',''));tbody.append(tr);});
 table.append(thead,tbody);
 const sign=el('div','ps-sign');for(const who of ['Người kiểm đếm','Manager duyệt']){const d=el('div');d.append(el('p','',who),el('div','space'),el('p','','(Ký, ghi rõ họ tên)'));sign.append(d);}
 out.replaceChildren(head,el('h1','',title),el('p','ps-sub',warehouse),info,table,sign);
 printSheet({clear:true,title:(refNo||'phieu-dem')+'-'+new Date().toISOString().slice(0,10)});
}
/** Lịch sử kiểm kê một mã: các lần đếm (tồn lúc đếm, thực đếm, chênh lệch, trạng thái), mới nhất trước. */
export async function openCountHistory({api,toast,sku,warehouseId='',onOpen}){
 let data;try{data=await api('/inventory/stocktake-history?'+new URLSearchParams({sku,...(warehouseId?{warehouseId}:{})}));}catch(e){toast(e.message,'err');return;}
 const dialog=el('dialog','modal inv-count-history'),head=el('div','modal-head'),body=el('div','modal-body'),close=()=>dialog.close();
 head.append(el('h2','','Lịch sử kiểm kê · '+sku),btn('Đóng',close));
 body.append(el('p','muted small',(data.name||'')+(warehouseId?' · lọc theo kho đang kiểm':' · mọi kho được xem')));
 if(!data.history.length)body.append(el('p','muted','Mã này chưa có phiếu kiểm kê nào.'));
 else{
  const table=el('table','data-table'),thead=el('thead'),hr=el('tr'),tbody=el('tbody');
  for(const h of ['Ngày lập','Phiếu','Kho','Tồn lúc đếm','Thực đếm','Chênh lệch','Trạng thái'])hr.append(el('th','',h));thead.append(hr);
  for(const h of data.history){const tr=el('tr'),ref=el('td');
   const link=btn(h.refNo,()=>{close();onOpen?.(h.id);},'link-btn');ref.append(link);
   const d=el('td','num'+(h.qty<0?' danger-text':''),h.qty?(h.qty>0?'+':'')+number(h.qty):'Khớp');
   const st=el('td');st.append(el('span','pill '+(PILL[h.status]||''),states[h.status]));
   tr.append(el('td','',when(h.createdAt)),ref,el('td','',h.warehouseName),el('td','num',number(h.expectedQty)),el('td','num',number(h.countedQty)),d,st);tbody.append(tr);}
  table.append(thead,tbody);const wrap=el('div','table-wrap');wrap.append(table);body.append(wrap);
  const done=data.history.filter(h=>h.status==='approved'),off=done.filter(h=>Math.abs(h.qty)>0.000001).length;
  if(done.length)body.append(el('p','small',`${done.length} lần đã duyệt · ${off} lần lệch · tổng lệch ${number(done.reduce((n,h)=>n+h.qty,0))}`));
 }
 const foot=el('div','modal-foot');foot.append(btn('Đóng',close));dialog.append(head,body,foot);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
}
/** Tóm tắt dòng phiếu: số mã, mã lệch, tổng tăng / giảm (kiểm kê: thực đếm − tồn đối chiếu). */
export function adjustmentSummary(lines){
 const changed=lines.filter(l=>Math.abs(Number(l.qty)||0)>0.000001);
 const up=changed.filter(l=>l.qty>0).reduce((n,l)=>n+l.qty,0),down=changed.filter(l=>l.qty<0).reduce((n,l)=>n+l.qty,0);
 return {count:lines.length,changed:changed.length,up:Math.round(up*1000)/1000,down:Math.round(down*1000)/1000};
}
export function initAdjustmentQueue({api,host,toast,onChanged,kind,userId}){
 let config=null,sequence=0,offset=0,next=null,deepOpened='',opening=null,canApprove=false,listed=[];
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
 for(const text of ['Số phiếu','Kho',stocktake?'Mã · lệch':'Số mã','Chênh lệch','Giá trị lệch','Người lập','Trạng thái',''])hr.append(el('th',text==='Giá trị lệch'?'inv-value-col':'',text));thead.append(hr);table.append(thead,tbody);list.append(table);
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
  // Giá trị lệch theo giá nhập gần nhất: máy chủ chỉ gửi cho Manager.
  const value=el('td','num inv-value-col');value.dataset.label='Giá trị lệch';
  if(r.valueDelta){value.textContent=r.valueDelta.value?signedMoney(r.valueDelta.value):'—';if(r.valueDelta.value<0)value.classList.add('danger-text');if(r.valueDelta.missing)value.title=r.valueDelta.missing+' mã lệch chưa có giá nhập';}
  const cells=[el('td','',r.warehouseName),el('td','',stocktake?`${sum.count} mã · ${sum.changed} lệch`:`${sum.count} mã`),delta,value,el('td','',r.createdByName),status];
  cells[0].dataset.label='Kho';cells[1].dataset.label=stocktake?'Mã · lệch':'Số mã';cells[4].dataset.label='Người lập';
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
   next=data.nextOffset;canApprove=!!data.canApprove;table.classList.toggle('show-value',data.adjustments.some(r=>r.valueDelta));fill(creator,(data.filterOptions?.creators||[]).map(m=>[m.id,m.name]),'Tất cả người lập');
   listed=data.adjustments;
   tbody.replaceChildren(...(data.adjustments.length?data.adjustments.map(row):[(()=>{const tr=el('tr'),td=el('td','muted','Không có '+noun+' phù hợp bộ lọc.');td.colSpan=8;tr.append(td);return tr;})()]));
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
  const count=r.lines.some(l=>l.source==='stocktake'),pend=r.status==='pending',cost=sku=>data.names?.[sku]?.cost,withCost=r.lines.some(l=>cost(l.sku)!==undefined);
  const current=sku=>data.balances[sku]||0,changedStock=count&&pend?r.lines.filter(l=>Math.abs(current(l.sku)-Number(l.expectedQty))>0.000001):[];
  const table=el('table','data-table'),thead=el('thead'),tr=el('tr'),tbody=el('tbody');
  const cols=count?['Mã hàng','Sản phẩm','Tồn lúc đếm','Thực đếm','Chênh lệch',...(pend?['Tồn hiện tại','Tồn sau duyệt']:[]),...(withCost?['Giá nhập','Giá trị lệch']:[])]
   :['Mã hàng','Sản phẩm','Tồn đối chiếu','Điều chỉnh','Thực đếm / sau điều chỉnh',...(withCost?['Giá nhập','Giá trị lệch']:[])];
  for(const text of cols)tr.append(el('th','',text));thead.append(tr);
  let total=0,missing=0;
  for(const l of r.lines){
   const row=el('tr'),before=current(l.sku),c=cost(l.sku),skuCell=el('td','first');
   if(count){const link=btn(l.sku,()=>openCountHistory({api,toast,sku:l.sku,warehouseId:r.warehouseId,onOpen:id2=>{dialog.close();open(id2);}}),'link-btn');link.title='Xem lịch sử kiểm kê mã này';skuCell.append(link);}else skuCell.textContent=l.sku;
   const cells=count?[number(l.expectedQty),number(l.countedQty),(l.qty>0?'+':'')+number(l.qty),...(pend?[number(before),number(before+l.qty)]:[])]
    :[number(before),(l.qty>0?'+':'')+number(l.qty),pend?number(before+l.qty):'Đã xử lý'];
   row.append(skuCell,el('td','',data.names?.[l.sku]?.name||'—'));for(const v of cells)row.append(el('td','num',v));
   if(count&&pend&&changedStock.includes(l))row.classList.add('inv-stock-changed');
   if(withCost){const v=c===undefined?null:l.qty*c;if(l.qty&&c===undefined)missing++;if(v)total+=v;row.append(el('td','num',c===undefined?'—':money(c)),el('td','num'+(v<0?' danger-text':''),v?signedMoney(v):'—'));}
   tbody.append(row);
  }
  if(withCost){const t=el('tr','inv-total-row'),label=el('td','',`Tổng giá trị lệch (giá nhập gần nhất)${missing?` · ${missing} mã chưa có giá`:''}`);label.colSpan=cols.length-1;t.append(label,el('td','num'+(total<0?' danger-text':''),signedMoney(Math.round(total))));tbody.append(t);}
  table.append(thead,tbody);const wrap=el('div','table-wrap');wrap.append(table);body.append(wrap);
  if(changedStock.length)body.append(el('p','warn-text small',`Tồn đã thay đổi sau lúc đếm ở ${changedStock.length} mã (dòng tô vàng). Duyệt sẽ áp dụng chênh lệch vào tồn hiện tại: tồn sau duyệt = tồn hiện tại + (thực đếm − tồn lúc đếm).`));
  if(r.status==='pending')body.append(el('p','muted small','Phiếu chờ duyệt chưa làm thay đổi tồn. Chỉ Manager duyệt mới ghi tăng/giảm vào sổ kho.'));
  const error=el('p','error');error.setAttribute('role','alert');body.append(error);
  if(r.status==='pending'&&data.canApprove){
   const note=el('textarea');note.maxLength=500;note.placeholder='Ghi chú duyệt / lý do từ chối';note.setAttribute('aria-label','Ghi chú xét duyệt');body.append(note);
   // Tồn đổi sau lúc đếm: nút duyệt chuyển sang "áp chênh lệch vào tồn hiện tại" (máy chủ kiểm lại trong giao dịch).
   let applyDelta=changedStock.length>0;
   const approveText=()=>applyDelta?'Duyệt theo chênh lệch và ghi kho':'Duyệt hoàn thành và ghi kho';
   const review=async decision=>{if(busy)return;if(decision==='rejected'&&note.value.trim().length<3){error.textContent='Nhập lý do từ chối.';return;}busy=true;error.textContent='';approve.disabled=reject.disabled=true;
    try{const result=await api('/inventory/adjustments/'+encodeURIComponent(id)+'/review','POST',{decision,note:note.value.trim(),...(decision==='approved'&&applyDelta?{applyDelta:true}:{})});busy=false;dialog.close();if(owner!==userId?.())return;
      toast(result.status==='approved'?'Đã duyệt và ghi tồn kho.':'Đã từ chối phiếu, không đổi tồn.');
      if(result.id===id&&['approved','rejected'].includes(result.status)){listed=listed.map(r=>r.id===id?{...r,status:result.status}:r).filter(r=>!filter.value||r.status===filter.value);tbody.replaceChildren(...listed.map(row));feedback.textContent='Đã xử lý phiếu · đang cập nhật danh sách và tồn kho…';prev.disabled=more.disabled=true;}
      void Promise.resolve().then(()=>onChanged()).catch(()=>toast('Phiếu đã xử lý; chưa tải lại được dữ liệu. Bấm Làm mới phiếu.','err'));
    }
    catch(e){error.textContent=e.message+(e.code==='STOCKTAKE_STOCK_CHANGED'?' Bấm lại nút duyệt để áp chênh lệch vào tồn hiện tại.':'');if(e.code==='STOCKTAKE_STOCK_CHANGED'){applyDelta=true;approve.textContent=approveText();}busy=false;approve.disabled=reject.disabled=false;}
   };
   const approve=btn(approveText(),()=>review('approved'),'btn primary'),reject=btn('Từ chối phiếu',()=>review('rejected'));approve.dataset.mobilePrimary='';foot.append(reject,approve);
  }
  // Xuất Excel phiếu (đối chiếu / lưu hồ sơ): mã, tồn đối chiếu, điều chỉnh, thực đếm.
  if(count)foot.append(btn('In phiếu',()=>printCountSheet({refNo:r.refNo,warehouse:r.warehouseName,reason:r.reason,lines:r.lines.map(l=>({sku:l.sku,name:data.names?.[l.sku]?.name||'',unit:data.names?.[l.sku]?.unit||'',expected:l.expectedQty,counted:l.countedQty}))})));
  foot.append(btn('Xuất Excel',()=>downloadExcel((kind==='stocktake'?'kiem-ke_':'can-bang-kho_')+r.refNo,[{name:r.refNo,header:['Mã hàng','Sản phẩm','ĐVT','Tồn đối chiếu','Thực đếm / sau điều chỉnh','Chênh lệch',...(withCost?['Giá nhập','Giá trị lệch']:[])],
   rows:r.lines.map(l=>{const before=l.source==='stocktake'?l.expectedQty:data.balances[l.sku]||0,c=cost(l.sku);return [l.sku,data.names?.[l.sku]?.name||'',data.names?.[l.sku]?.unit||'',before,l.source==='stocktake'?l.countedQty:before+l.qty,l.qty,...(withCost?[c??'',c===undefined?'':Math.round(l.qty*c)]:[])];}),widths:[18,40,8,14,22,12,...(withCost?[14,16]:[])],autoFilter:true}])));
  foot.append(btn('Đóng',close));dialog.append(head,body,foot);document.body.append(dialog);dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
 }
 return {load,open};
}
