import {initEarlyQuickCreate} from './early-request-quick-create.js';
import {earlyListBulk} from './early-list-bulk.js';
import { initEarlyRequests } from './purchase-early-requests.js';
import { openEarlyRequestFile } from './purchase-early-file.js';
import {openEarlyRequestPhoto} from './purchase-early-photo.js';
import {buyHead,buyKpis,buyTools,buyBadge,buyDate,buyDueText,buyProgress} from './buy-layout.js';
const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;};
const button=(text,fn,cls='btn secondary')=>{const n=node('button',cls,text);n.type='button';n.onclick=fn;return n;};
const label=(text,input)=>{const n=node('label','early-page-field');n.append(node('span','small muted',text),input);return n;};
const select=entries=>{const n=node('select');for(const [value,text] of entries)n.append(Object.assign(node('option','',text),{value}));return n;};
const states=[['','Tất cả trạng thái'],['draft','Nháp'],['pending','Chờ NCC xác nhận'],['accepted','NCC đồng ý'],['rejected','NCC từ chối'],['mixed','NCC phản hồi khác nhau'],['submitted','Tất cả đã gửi NCC']];
const TONE={draft:'grey',pending:'amber',accepted:'blue',rejected:'red',mixed:'amber',submitted:'blue'};
const labels=Object.fromEntries(states),number=n=>Number(n||0).toLocaleString('vi-VN');
const requestHref=id=>'#/early-requests/'+encodeURIComponent(id);
let excelPromise;
function loadXlsx(){return globalThis.XLSX?Promise.resolve(globalThis.XLSX):(excelPromise||=new Promise((resolve,reject)=>{
 const script=node('script');script.src='xlsx.full.min.js';script.onload=()=>resolve(globalThis.XLSX);script.onerror=()=>{excelPromise=null;script.remove();reject(Error('Không tải được bộ Excel. Vui lòng thử lại.'));};document.head.append(script);
}));}

/** Trang Lấy hàng trước: đầu trang 1 nút tạo phiếu, ô đếm theo trạng thái, tìm + bộ lọc gập, bảng phiếu; ghi/nhận dùng luồng sẵn có. */
export function initEarlyRequestPage({api,root,go,today,toast}){
 let sequence=0,timer,offset=0,nextOffset=null,detailId='',canSend=false,suppliers=[],creator=null;
 const openFile=()=>openEarlyRequestFile({api,loadXlsx,suppliers,today:today(),go,requestHref}),openPhoto=()=>openEarlyRequestPhoto({api,loadXlsx,suppliers,today:today(),go,requestHref});
 const chooser=createChooser({go,openFile,openPhoto});
 const head=buyHead({eyebrow:'Mua hàng',title:'Lấy hàng trước',desc:'Xin NCC cho lấy trước một phần hàng của đơn mua đang chờ giao. NCC đồng ý thì kho nhận theo phiếu.',
  primary:{label:'+ Tạo phiếu lấy trước',onClick:()=>chooser.open()},
  more:[{label:'Hàng đang về theo mã',hint:'Chọn hàng từ các đơn mua đang về',onClick:()=>go('#/purchases?mode=incoming')},{label:'Làm mới',hint:'Tải lại danh sách',onClick:()=>refreshNow()}]});
 const header=head.node,intro=header.firstElementChild;head.primary.hidden=true;
 const createHost=node('section','early-quick-host');createHost.hidden=true;
 const back=node('a','btn secondary early-page-back','‹ Danh sách lấy hàng trước');back.href='#/early-requests';back.hidden=true;
 const section=node('section','early-page-index'),detail=node('section','early-page-detail');detail.hidden=true;
 const supplier=select([['','Tất cả NCC']]),status=select(states),dateBy=select([['pickup','Ngày lấy'],['created','Ngày lập']]);
 const from=node('input'),to=node('input');from.type=to.type='date';
 const changed=()=>{offset=0;load();};
 const tools=buyTools({placeholder:'Tìm số phiếu, mã hoặc tên hàng, NCC, số đơn mua',fields:[['Nhà cung cấp',supplier],['Trạng thái',status],['Lọc ngày theo',dateBy],['Từ ngày',from],['Đến ngày',to]],
  onSearch:changed,onClear:()=>{tools.search.value=supplier.value=status.value=from.value=to.value='';dateBy.value='pickup';changed();}});
 const search=tools.search;search.setAttribute('aria-label','Tìm phiếu lấy hàng trước');tools.panel.classList.add('early-page-filters');
 search.addEventListener('input',()=>{++sequence;selection.reset();});
 const kpis=buyKpis([{key:'draft',label:'Nháp, chưa gửi'},{key:'pending',label:'Chờ NCC xác nhận',tone:'warn'},{key:'accepted',label:'NCC đồng ý'},{key:'rejected',label:'NCC từ chối',tone:'bad'},{key:'',label:'Tất cả'}],
  key=>{status.value=status.value===key?'':key;changed();});
 const error=node('p','error');error.hidden=true;error.setAttribute('role','alert');
 const feedback=node('p','muted small buy-summary');feedback.setAttribute('role','status');
 const table=node('table','data-table buy-list early-page-table'),thead=node('thead'),hr=node('tr'),list=node('tbody','early-page-list');
 for(const text of ['Phiếu','Hàng xin lấy','Từ đơn mua','Ngày lấy','Trạng thái','Việc tiếp theo'])hr.append(node('th','',text));thead.append(hr);table.append(thead,list);
 const wrap=node('div','table-wrap');wrap.append(table);
 const pager=node('div','buy-pager early-page-pager');
 const prev=button('‹ Trang trước',()=>{offset=Math.max(0,offset-20);load();}),next=button('Trang tiếp ›',()=>{if(nextOffset!==null){offset=nextOffset;load();}});
 const refreshNow=()=>detailId==='new'?creator?.refresh():detailId?history.load(detailId):load();
 const selection=earlyListBulk({api,onSaved:async()=>{await load();toast('Đã cập nhật các phiếu đã chọn.');}});
 const panel=node('div','panel buy-panel');panel.append(tools.node,feedback,selection.host,wrap,pager);
 pager.append(prev,next);section.append(kpis.node,panel);root.append(header,back,error,section,detail,createHost);
 const history=initEarlyRequests({api,host:detail,canWrite:()=>canSend,requestHref,currentRequest:()=>detailId,onDeleted:()=>detailId?go('#/early-requests'):load(),onSaved:()=>toast('Đã cập nhật phiếu lấy hàng trước.')});
 function params(){const p=new URLSearchParams();for(const [key,value] of [['q',search.value.trim()],['supplierId',supplier.value],['status',status.value],['dateBy',dateBy.value],['from',from.value],['to',to.value]])if(value)p.set(key,value);return p;}
 function fail(message=''){error.textContent=message;error.hidden=!message;}
 const nextStep=(r,complete)=>complete?'':r.status==='draft'?'Gửi NCC':r.status==='pending'?'Chờ NCC xác nhận':r.status==='rejected'?'Chọn NCC khác hoặc huỷ':r.lines.some(l=>l.allocations.some(a=>a.status==='accepted'&&a.remainingToReceive>0))?'Nhận hàng':r.status==='mixed'?'Xem phản hồi NCC':'';
 async function load(){
  const mine=++sequence;clearTimeout(timer);selection.reset();fail();prev.disabled=next.disabled=true;section.setAttribute('aria-busy','true');feedback.textContent='Đang tải phiếu…';
  const p=params();p.set('limit','20');p.set('counts','1');if(offset)p.set('offset',String(offset));
  // Giữ bộ lọc trên URL để Quay lại/chia sẻ/tải lại vẫn đúng danh sách.
  const saved=params();if(offset)saved.set('offset',String(offset));
  if(location.hash.split('?')[0]==='#/early-requests')historyReplace(saved);
  tools.setActive([supplier.value,from.value,to.value,dateBy.value!=='pickup'?'1':''].filter(Boolean).length+(status.value&&!['draft','pending','accepted','rejected'].includes(status.value)?1:0));
  try{const data=await api('/purchase-early-requests?'+p);if(mine!==sequence)return;
   canSend=!!data.canSend;head.primary.hidden=!canSend;nextOffset=data.nextOffset;list.replaceChildren();selection.reset(data.requests,data);
   kpis.update(data.counts?{...data.counts,'':data.counts.all}:null,status.value);
   const fmt=new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeZone:'Asia/Ho_Chi_Minh'}),todayIso=today();
   for(const request of data.requests){
    const row=node('tr','early-page-card'),docCell=node('td','early-page-card-head'),title=node('div','early-list-title');
    const open=node('a','data-link buy-doc',request.ticketNumber||'Phiếu '+request.id.slice(0,8).toUpperCase());open.href=requestHref(request.id);
    const check=selection.checkbox(request);if(check)title.append(check);title.append(open);
    docCell.append(title,node('small','muted',(request.createdByName||'Chưa rõ người tạo')+' · lập '+fmt.format(new Date(request.createdAt))));
    if(request.pxkNo)docCell.append(node('small','muted','Số PXK '+request.pxkNo));
    const allocations=request.lines.flatMap(l=>l.allocations),names=[...new Set(allocations.map(a=>a.supplierName))],orders=[...new Set(allocations.map(a=>a.ticketNumber+(a.supplierOrderNo?' · NCC '+a.supplierOrderNo:'')))];
    const requested=request.lines.reduce((sum,line)=>sum+Number(line.quantity||0),0),received=allocations.reduce((sum,a)=>sum+Number(a.receivedQty||0),0);
    const complete=requested>0&&received>=requested&&allocations.length>0&&allocations.every(a=>Number(a.receivedQty||0)>=Number(a.quantity));
    const goods=node('td');for(const l of request.lines.slice(0,3)){const line=node('div','buy-line');line.append(node('div','',l.name||l.sku),node('small','muted',`${l.sku} · xin ${number(l.quantity)} ${l.unit||''}`));goods.append(line);}
    if(request.lines.length>3)goods.append(node('small','muted',`+${request.lines.length-3} mã khác`));
    goods.append(node('small','muted',`Đã nhận ${number(received)}/${number(requested)}`));goods.append(buyProgress(received,requested));
    const source=node('td');source.append(node('div','',orders.join(' · ')||'—'),node('small','muted',names.join(' · ')));
    const pickup=node('td'),late=request.pickupDate&&request.pickupDate<todayIso&&!complete;
    pickup.append(node('div',late?'buy-late':'',request.pickupDate?buyDate(request.pickupDate):'Chưa hẹn'));if(request.pickupDate&&!complete)pickup.append(node('small','muted'+(late?' buy-late':''),buyDueText(request.pickupDate,todayIso)));
    const state=node('td');state.append(complete?buyBadge('Đã nhận đủ','green'):buyBadge(labels[request.status]||request.status,TONE[request.status]||'grey'));
    const step=node('td');step.append(node('span','buy-next',nextStep(request,complete)));
    row.append(docCell,goods,source,pickup,state,step);row.addEventListener('click',e=>{if(!e.target.closest('a,button,input,label'))go(requestHref(request.id));});
    list.append(row);
   }
   if(!data.requests.length){const tr=node('tr'),td=node('td','muted','Không có phiếu phù hợp bộ lọc.');td.colSpan=6;tr.append(td);list.append(tr);}
   feedback.textContent=data.requests.length?`Phiếu ${offset+1}–${offset+data.requests.length}${nextOffset!==null?' · còn trang sau':''}`:'0 phiếu';
   prev.disabled=offset===0;next.disabled=nextOffset===null;pager.hidden=offset===0&&nextOffset===null;
  }catch(e){if(mine!==sequence)return;fail(e.message||'Không tải được phiếu.');feedback.textContent='Tải phiếu chưa thành công. Bấm Thêm › Làm mới để thử lại.';}
  finally{if(mine===sequence)section.removeAttribute('aria-busy');}
 }
 function historyReplace(p){const href='#/early-requests'+(p.size?'?'+p:'');window.history.replaceState(null,'',href);back.href=href;}
 for(const input of [supplier,status,dateBy,from,to])input.addEventListener('change',changed);
 return {async show(id='',query=''){
  const mine=++sequence;clearTimeout(timer);detailId=id;selection.reset();creator?.hide();creator=null;createHost.hidden=true;back.hidden=!id;section.hidden=!!id;detail.hidden=!id||id==='new';intro.querySelector('h1').textContent=id==='new'?'Tạo đơn lấy hàng nhanh':'Lấy hàng trước';intro.querySelector('p').textContent=id==='new'?'Chọn mã hàng và đơn mua NCC đã đặt để tạo phiếu lấy trước.':'Xin NCC cho lấy trước một phần hàng của đơn mua đang chờ giao. NCC đồng ý thì kho nhận theo phiếu.';fail();
  try{const options=await api('/purchase-options');if(mine!==sequence)return;
   suppliers=options.suppliers||[];canSend=!!options.canRequestEarly;head.primary.hidden=!canSend;
   const keep=supplier.value;supplier.replaceChildren(...select([['','Tất cả NCC'],...suppliers.map(s=>[s.id,s.name])]).children);supplier.value=keep;
   if(id==='new'){head.primary.hidden=true;if(!canSend){fail('Bạn chưa được cấp quyền tạo phiếu lấy hàng trước.');return;}createHost.hidden=false;creator=initEarlyQuickCreate({api,host:createHost,go,today,toast});await creator.show();return;}
   if(id){await history.load(id);return;}
   const p=new URLSearchParams(query);search.value=p.get('q')||'';supplier.value=p.get('supplierId')||'';status.value=p.get('status')||'';dateBy.value=p.get('dateBy')||'pickup';from.value=p.get('from')||'';to.value=p.get('to')||'';offset=Number(p.get('offset')||0);await load();
  }catch(e){if(mine===sequence)fail(e.message);}
 },refresh(){return detailId==='new'?creator?.refresh():detailId?history.load(detailId):load();}};
}

/** Một nút tạo phiếu, chọn cách nhập trong hộp thoại: chọn hàng, file Excel hoặc ảnh phiếu. */
function createChooser({go,openFile,openPhoto}){
 const dlg=node('dialog','modal buy-chooser');dlg.dataset.mobileActions='off';
 const headRow=node('div','modal-head'),close=button('Đóng',()=>dlg.close());headRow.append(node('h2','','Tạo phiếu lấy hàng trước'),close);
 const body=node('div','modal-body buy-chooser-list');
 const option=(title,hint,fn,aria)=>{const b=node('button','buy-choice');b.type='button';b.append(node('b','',title),node('small','',hint));if(aria)b.setAttribute('aria-label',aria);b.onclick=()=>{dlg.close();fn();};return b;};
 body.append(option('Chọn hàng','Tìm mã hàng, chọn đơn mua NCC đang về và số lượng',()=>go('#/early-requests/new'),'Tạo đơn lấy hàng nhanh'),
  option('Từ file Excel','Tải file danh sách mã và số lượng, có thể nhiều số PXK',openFile,'Xin hàng bằng file'),
  option('Từ ảnh phiếu','Chụp phiếu xin hàng, máy đọc mã và số lượng để anh/chị kiểm lại',openPhoto,'Xin hàng bằng ảnh chụp'));
 dlg.append(headRow,body);
 return {open(){if(!dlg.isConnected)document.body.append(dlg);dlg.showModal();}};
}
