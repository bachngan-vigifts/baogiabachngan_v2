import { initEarlyRequests } from './purchase-early-requests.js';
import { openEarlyRequestFile, earlyRequestTemplate } from './purchase-early-file.js';
const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;};
const button=(text,fn,cls='btn secondary')=>{const n=node('button',cls,text);n.type='button';n.onclick=fn;return n;};
const label=(text,input)=>{const n=node('label','early-page-field');n.append(node('span','small muted',text),input);return n;};
const select=entries=>{const n=node('select');for(const [value,text] of entries)n.append(Object.assign(node('option','',text),{value}));return n;};
const states=[['','Tất cả trạng thái'],['draft','Nháp'],['pending','Chờ NCC xác nhận'],['accepted','NCC đồng ý'],['rejected','NCC từ chối'],['mixed','NCC phản hồi khác nhau'],['submitted','Tất cả đã gửi NCC']];
const labels=Object.fromEntries(states),number=n=>Number(n||0).toLocaleString('vi-VN');
const requestHref=id=>'#/early-requests/'+encodeURIComponent(id);
let excelPromise;
function loadXlsx(){return globalThis.XLSX?Promise.resolve(globalThis.XLSX):(excelPromise||=new Promise((resolve,reject)=>{
 const script=node('script');script.src='xlsx.full.min.js';script.onload=()=>resolve(globalThis.XLSX);script.onerror=()=>{excelPromise=null;script.remove();reject(Error('Không tải được bộ Excel. Vui lòng thử lại.'));};document.head.append(script);
}));}

/** Dedicated index of persisted requests; all writes/receiving reuse existing workflows. */
export function initEarlyRequestPage({api,root,go,today,toast}){
 let sequence=0,timer,offset=0,nextOffset=null,detailId='',canSend=false,suppliers=[];
 const header=node('div','page-head'),intro=node('div');intro.append(node('span','eyebrow','Mua hàng'),node('h1','','Lấy hàng trước'),node('p','muted','Quản lý phiếu xin hàng, phản hồi NCC và nhận hàng theo phiếu.'));
 const actions=node('div','head-actions row-gap');
 const file=button('Xin bằng file',()=>openEarlyRequestFile({api,loadXlsx,suppliers,today:today(),go,requestHref}),'btn primary');file.hidden=true;file.setAttribute('aria-label','Xin hàng bằng file');
 const template=button('Tải file mẫu',async()=>{template.disabled=true;try{const X=await loadXlsx();X.writeFile(earlyRequestTemplate(X),'mau-xin-hang-truoc.xlsx');}catch(e){toast(e.message,'err');}finally{template.disabled=false;}});
 const incoming=node('a','btn secondary','Chọn hàng đang về');incoming.href='#/purchases?mode=incoming';incoming.hidden=true;
 actions.append(file,template,incoming);header.append(intro,actions);
 const back=node('a','btn secondary early-page-back','‹ Danh sách lấy hàng trước');back.href='#/early-requests';back.hidden=true;
 const section=node('section','early-page-index'),detail=node('section','early-page-detail');detail.hidden=true;
 const search=node('input');search.type='search';search.placeholder='Tìm phiếu, mã hàng, tên hàng, NCC, số đơn CRM/NCC';search.setAttribute('aria-label','Tìm phiếu lấy hàng trước');
 const filters=node('details','early-page-filters');filters.open=matchMedia('(min-width: 851px)').matches;filters.append(node('summary','','Bộ lọc phiếu'));
 const fields=node('div','early-page-filter-grid'),supplier=select([['','Tất cả NCC']]),status=select(states),dateBy=select([['pickup','Ngày lấy'],['created','Ngày lập']]);
 const from=node('input'),to=node('input');from.type=to.type='date';
 fields.append(label('Nhà cung cấp',supplier),label('Trạng thái',status),label('Lọc ngày theo',dateBy),label('Từ ngày',from),label('Đến ngày',to));
 const clear=button('Xoá bộ lọc',()=>{search.value=supplier.value=status.value=from.value=to.value='';dateBy.value='pickup';offset=0;load();});
 fields.append(clear);filters.append(fields);
 const error=node('p','error');error.hidden=true;error.setAttribute('role','alert');
 const feedback=node('p','muted small');feedback.setAttribute('role','status');
 const list=node('div','early-page-list'),pager=node('div','early-page-pager');
 const prev=button('‹ Trang trước',()=>{offset=Math.max(0,offset-20);load();}),next=button('Trang tiếp ›',()=>{if(nextOffset!==null){offset=nextOffset;load();}}),refresh=button('Làm mới',()=>detailId?history.load(detailId):load());
 pager.append(prev,next);actions.append(refresh);section.append(search,filters,feedback,list,pager);root.append(header,back,error,section,detail);
 const history=initEarlyRequests({api,host:detail,canWrite:()=>canSend,requestHref,currentRequest:()=>detailId,onDeleted:()=>go('#/early-requests'),onSaved:()=>toast('Đã cập nhật phiếu lấy hàng trước.')});
 function params(){const p=new URLSearchParams();for(const [key,value] of [['q',search.value.trim()],['supplierId',supplier.value],['status',status.value],['dateBy',dateBy.value],['from',from.value],['to',to.value]])if(value)p.set(key,value);return p;}
 function fail(message=''){error.textContent=message;error.hidden=!message;}
 async function load(){
  const mine=++sequence;clearTimeout(timer);fail();prev.disabled=next.disabled=true;section.setAttribute('aria-busy','true');feedback.textContent='Đang tải phiếu…';
  const p=params();p.set('limit','20');if(offset)p.set('offset',String(offset));
  // Persist filters in the URL so Back/share/reload preserve the current list.
  const saved=params();if(offset)saved.set('offset',String(offset));
  if(location.hash.split('?')[0]==='#/early-requests')historyReplace(saved);
  try{const data=await api('/purchase-early-requests?'+p);if(mine!==sequence)return;
   canSend=!!data.canSend;file.hidden=incoming.hidden=!canSend;nextOffset=data.nextOffset;list.replaceChildren();
   for(const request of data.requests){
    const card=node('article','card early-page-card'),head=node('div','early-page-card-head'),open=node('a','data-link','Phiếu '+request.id.slice(0,8).toUpperCase());open.href=requestHref(request.id);
    head.append(open,node('span','sup-pill early-status early-status-'+request.status,labels[request.status]||request.status));
    const allocations=request.lines.flatMap(l=>l.allocations),names=[...new Set(allocations.map(a=>a.supplierName))],orders=[...new Set(allocations.map(a=>a.ticketNumber+(a.supplierOrderNo?' · NCC: '+a.supplierOrderNo:'')))];
    const created=new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeZone:'Asia/Ho_Chi_Minh'}).format(new Date(request.createdAt));
    card.append(head,node('p','small muted','Lập '+created+' · Ngày lấy: '+(request.pickupDate?request.pickupDate.split('-').reverse().join('/'):'Chưa nhập')),
      node('p','',names.join(' · ')),node('p','small',orders.join(' · ')),node('p','small muted',request.lines.map(l=>l.sku+' · '+l.name).join('; ')),
      node('p','small',`${request.lines.length} mã · SL xin ${number(request.lines.reduce((s,l)=>s+l.quantity,0))} · Đã nhận ${number(allocations.reduce((s,a)=>s+(a.receivedQty||0),0))}`));
    list.append(card);
   }
   if(!data.requests.length)list.append(node('p','muted','Không có phiếu phù hợp bộ lọc.'));
   feedback.textContent=data.requests.length?`Đang xem phiếu ${offset+1}–${offset+data.requests.length}${nextOffset!==null?' · Còn phiếu ở trang sau':''}`:'0 phiếu';
   prev.disabled=offset===0;next.disabled=nextOffset===null;
  }catch(e){if(mine!==sequence)return;fail(e.message||'Không tải được phiếu.');feedback.textContent='Tải phiếu chưa thành công. Bấm Làm mới để thử lại.';}
  finally{if(mine===sequence)section.removeAttribute('aria-busy');}
 }
 function historyReplace(p){const href='#/early-requests'+(p.size?'?'+p:'');window.history.replaceState(null,'',href);back.href=href;}
 const changed=()=>{offset=0;load();};for(const input of [supplier,status,dateBy,from,to])input.addEventListener('change',changed);
 search.addEventListener('input',()=>{++sequence;clearTimeout(timer);timer=setTimeout(changed,250);});
 return {async show(id='',query=''){
  const mine=++sequence;clearTimeout(timer);detailId=id;back.hidden=!id;section.hidden=!!id;detail.hidden=!id;fail();
  try{const options=await api('/purchase-options');if(mine!==sequence)return;
   suppliers=options.suppliers||[];canSend=!!options.canRequestEarly;file.hidden=incoming.hidden=!canSend;
   const keep=supplier.value;supplier.replaceChildren(...select([['','Tất cả NCC'],...suppliers.map(s=>[s.id,s.name])]).children);supplier.value=keep;
   if(id){await history.load(id);return;}
   const p=new URLSearchParams(query);search.value=p.get('q')||'';supplier.value=p.get('supplierId')||'';status.value=p.get('status')||'';dateBy.value=p.get('dateBy')||'pickup';from.value=p.get('from')||'';to.value=p.get('to')||'';offset=Number(p.get('offset')||0);await load();
  }catch(e){if(mine===sequence)fail(e.message);}
 },refresh(){return detailId?history.load(detailId):load();}};
}
