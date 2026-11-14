/** Lịch giao theo ngày của cổng NCC. Chỉ đọc: dùng API đơn đặt hàng đã giới hạn theo NCC ở máy chủ, không ghi dữ liệu. */
const pad=n=>String(n).padStart(2,'0');
const iso=(y,m,d)=>y+'-'+pad(m)+'-'+pad(d);
const WEEKDAYS=['T2','T3','T4','T5','T6','T7','CN'];
/** Các ô của một tháng, tuần bắt đầu từ thứ Hai; ô ngoài tháng là null. */
export function monthCells(year,month){
 const first=new Date(Date.UTC(year,month-1,1)),days=new Date(Date.UTC(year,month,0)).getUTCDate(),lead=(first.getUTCDay()+6)%7,cells=[];
 for(let i=0;i<lead;i++)cells.push(null);for(let d=1;d<=days;d++)cells.push(iso(year,month,d));while(cells.length%7)cells.push(null);return cells;
}
/** Gom đơn theo ngày hẹn giao; bỏ đơn đã huỷ và đơn chưa có ngày hẹn hợp lệ. */
export function groupByDay(orders){
 const days=new Map();
 for(const o of orders){if(o.status==='cancelled'||!/^\d{4}-\d{2}-\d{2}$/.test(String(o.expected||'')))continue;const day=days.get(o.expected)||{orders:[],quantity:0};day.orders.push(o);day.quantity+=typeof o.quantity==='number'?o.quantity:0;days.set(o.expected,day);}
 return days;
}
export const shiftMonth=(year,month,delta)=>{const d=new Date(Date.UTC(year,month-1+delta,1));return[d.getUTCFullYear(),d.getUTCMonth()+1];};

export function mountDeliveryCalendar({root,read,openOrder,today,esc,num,date,badge,icon}){
 const valid=/^\d{4}-\d{2}-\d{2}$/.test(String(today||''));let year=valid?Number(today.slice(0,4)):new Date().getFullYear(),month=valid?Number(today.slice(5,7)):new Date().getMonth()+1;
 let disposed=false,seq=0,controller=null,days=new Map(),selected='',truncated=false;const lines=new Map();
 root.innerHTML=`<section class="ncc-card ncc-cal"><div class="ncc-cal-bar"><button class="ncc-button small" data-cal="prev" aria-label="Tháng trước">‹</button><strong id="ncc-cal-title" aria-live="polite"></strong><button class="ncc-button small" data-cal="next" aria-label="Tháng sau">›</button><button class="ncc-button small" data-cal="today">Tháng này</button><span class="ncc-cal-sum" id="ncc-cal-sum"></span></div><div id="ncc-cal-message" class="ncc-message" hidden></div><div class="ncc-cal-grid" id="ncc-cal-grid" role="grid" aria-label="Lịch giao theo ngày hẹn"></div></section><section class="ncc-card" id="ncc-cal-day"></section>`;
 const $=s=>root.querySelector(s),$$=s=>[...root.querySelectorAll(s)];
 const report=(text,error=false)=>{const n=$('#ncc-cal-message');n.className='ncc-message'+(error?' error':' info');n.textContent=text;n.hidden=!text;};
 function drawGrid(){
  $('#ncc-cal-title').textContent='Tháng '+month+'/'+year;
  const total=[...days.values()].reduce((s,d)=>({orders:s.orders+d.orders.length,quantity:s.quantity+d.quantity}),{orders:0,quantity:0});
  $('#ncc-cal-sum').textContent=total.orders?num(total.orders)+' đơn · '+num(total.quantity)+' sản phẩm hẹn giao trong tháng':'Không có đơn hẹn giao trong tháng';
  $('#ncc-cal-grid').innerHTML=WEEKDAYS.map(w=>`<div class="ncc-cal-week" role="columnheader">${w}</div>`).join('')+monthCells(year,month).map(day=>{
   if(!day)return'<div class="ncc-cal-cell empty" role="gridcell"></div>';const info=days.get(day),cls='ncc-cal-cell'+(day===today?' today':'')+(day===selected?' selected':'')+(info?' has':'');
   return info?`<button class="${cls}" role="gridcell" data-day="${day}" aria-pressed="${day===selected}" aria-label="Ngày ${date(day)}: ${info.orders.length} đơn, ${num(info.quantity)} sản phẩm"><b>${Number(day.slice(8))}</b><span class="ncc-cal-count">${info.orders.length} đơn</span><small>${num(info.quantity)} SP</small></button>`:`<div class="${cls}" role="gridcell" aria-label="Ngày ${date(day)}: không có đơn"><b>${Number(day.slice(8))}</b></div>`;
  }).join('');
  $$('[data-day]').forEach(b=>b.onclick=()=>{selected=b.dataset.day;drawGrid();drawDay(true);});
 }
 function lineRows(id){
  const state=lines.get(id);if(!state)return'';if(state.loading)return'<p class="ncc-state" role="status">Đang tải mã hàng…</p>';if(state.error)return`<p class="ncc-message error">${esc(state.error)}</p>`;
  return state.items.length?`<div class="ncc-table-wrap"><table class="ncc-table ncc-cal-lines"><thead><tr><th>Mã hàng</th><th>Tên hàng</th><th class="num">SL đặt</th><th>Hẹn giao dòng</th></tr></thead><tbody>${state.items.map(l=>`<tr><td data-label="Mã hàng"><strong>${esc(l.sku)}</strong></td><td data-label="Tên hàng">${esc(l.name)}</td><td data-label="SL đặt" class="num">${num(l.quantity)} ${esc(l.unit||'')}</td><td data-label="Hẹn giao dòng">${l.promisedDate?date(l.promisedDate):'Theo đơn'}</td></tr>`).join('')}</tbody></table></div>`:'<p class="ncc-state">Đơn chưa có dòng hàng.</p>';
 }
 function drawDay(focus=false){
  const box=$('#ncc-cal-day'),info=days.get(selected);
  if(!info){box.innerHTML=`<div class="ncc-empty">${days.size?'Chọn một ngày có đơn trên lịch để xem đơn hẹn giao ngày đó.':'Tháng này chưa có đơn nào có ngày hẹn giao.'}<br>Đơn chưa có ngày hẹn xem ở trang <a href="#orders">Đơn đặt hàng</a>.</div>`;return;}
  box.innerHTML=`<div class="ncc-table-head"><strong id="ncc-cal-day-title" tabindex="-1">Hẹn giao ngày ${date(selected)}</strong><span class="ncc-badge blue">${info.orders.length} đơn · ${num(info.quantity)} sản phẩm</span></div><div class="ncc-cal-orders">${info.orders.map(o=>`<article class="ncc-cal-order"><header><div><strong>${esc(o.no)}</strong><small>${o.supplierNo?'Số đơn NCC: '+esc(o.supplierNo)+' · ':''}Đặt ngày ${date(o.date)} · ${esc(o.warehouse||'Chưa ghi kho')}</small></div>${badge(o.status)}</header><p>${num(o.quantity)} sản phẩm đặt · đã nhận ${num(o.received)}</p><div class="ncc-actions"><button class="ncc-button small" data-lines="${esc(o.id)}" aria-expanded="${lines.has(o.id)}">${icon('list')}${lines.has(o.id)?'Ẩn mã hàng':'Xem mã hàng'}</button><button class="ncc-button small" data-order="${esc(o.id)}">${icon('cart')}Mở chi tiết đơn</button></div><div class="ncc-cal-order-lines">${lineRows(o.id)}</div></article>`).join('')}</div>`;
  $$('[data-order]').forEach(b=>b.onclick=()=>openOrder(b.dataset.order));
  $$('[data-lines]').forEach(b=>b.onclick=()=>toggleLines(b.dataset.lines));
  if(focus)$('#ncc-cal-day-title')?.focus({preventScroll:false});
 }
 async function toggleLines(id){
  if(lines.has(id)){lines.delete(id);drawDay();return;}
  lines.set(id,{loading:true});drawDay();const n=seq;
  try{const d=await read('/supplier-portal/workspace/orders/'+encodeURIComponent(id));if(disposed||n!==seq||!lines.has(id))return;lines.set(id,{items:Array.isArray(d.lines)?d.lines:[]});}
  catch(e){if(disposed||n!==seq||!lines.has(id))return;lines.set(id,{error:e.message||'Không tải được mã hàng.'});}
  drawDay();
 }
 async function load(){
  const n=++seq;controller?.abort();controller=new AbortController();days=new Map();lines.clear();truncated=false;report('');drawGrid();$('#ncc-cal-day').innerHTML='<div class="ncc-loading" role="status">Đang tải lịch giao…</div>';
  const from=iso(year,month,1),to=iso(year,month,new Date(Date.UTC(year,month,0)).getUTCDate()),all=[];
  try{
   for(let offset=0;offset<1000;offset+=100){const d=await read('/supplier-portal/workspace/orders',{dateField:'expected',from,to,limit:'100',offset:String(offset)},controller.signal);if(disposed||n!==seq)return;all.push(...d.items);if(offset+d.items.length>=d.total||!d.items.length)break;if(offset===900)truncated=true;}
   days=groupByDay(all);if(!days.has(selected))selected=days.has(today)?today:[...days.keys()].sort()[0]||'';
   if(truncated)report('Tháng này có hơn 1.000 đơn; lịch chỉ hiện 1.000 đơn đầu. Dùng trang Đơn đặt hàng để lọc chi tiết hơn.');
   drawGrid();drawDay();
  }catch(e){if(disposed||n!==seq||e?.name==='AbortError')return;report(e.message||'Không tải được lịch giao.',true);$('#ncc-cal-day').innerHTML='<div class="ncc-empty">Chưa tải được lịch giao. Bấm Làm mới để thử lại.</div>';}
 }
 $$('[data-cal]').forEach(b=>b.onclick=()=>{if(b.dataset.cal==='today'){if(valid){year=Number(today.slice(0,4));month=Number(today.slice(5,7));}else{const d=new Date();year=d.getFullYear();month=d.getMonth()+1;}}else[year,month]=shiftMonth(year,month,b.dataset.cal==='prev'?-1:1);selected='';load();});
 load();
 return{reload:load,dispose(){disposed=true;seq++;controller?.abort();}};
}
