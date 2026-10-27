const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;};
const number=n=>Number(n||0).toLocaleString('vi-VN');
const link=(text,href)=>{const n=el('a','',text);n.href=href;return n;};
const date=d=>d?String(d).slice(0,10).split('-').reverse().join('/'):'Chưa nhập';
const stamp=d=>d&&!Number.isNaN(Date.parse(d))?new Date(d).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'Chưa có thời điểm';
const requestName=r=>'Phiếu '+r.id.slice(0,8).toUpperCase();
/** Existing staff endpoint: retain server authorization and follow every page before claiming completeness. */
export async function loadEarlyRequestPages(api,params={},alive=()=>true){
 const rows=[],seen=new Set();let offset=0;
 while(alive()){
  const data=await api('/purchase-early-requests?'+new URLSearchParams({...params,limit:'50',offset:String(offset)}));
  for(const r of data.requests)if(!seen.has(r.id)){seen.add(r.id);rows.push(r);}
  if(data.nextOffset==null)return rows;
  if(!Number.isSafeInteger(data.nextOffset)||data.nextOffset<=offset)throw Error('Không tải tiếp được danh sách phiếu. Vui lòng thử lại.');
  offset=data.nextOffset;
 }
 return rows;
}
export function mergeRelatedRequests(groups){
 const rows=new Map();
 for(const request of groups.flat()){
  if(!rows.has(request.id))rows.set(request.id,{...request,lines:[]});
  const target=rows.get(request.id);
  for(const line of request.lines){let old=target.lines.find(l=>l.id===line.id);if(!old){old={...line,allocations:[]};target.lines.push(old);}const seen=new Set(old.allocations.map(a=>a.id));for(const a of line.allocations)if(!seen.has(a.id)){old.allocations.push(a);seen.add(a.id);}}
 }
 return [...rows.values()];
}
function dialog(title){
 const modal=el('dialog','modal supplier-detail-dialog'),head=el('div','modal-head'),body=el('div','modal-body'),close=el('button','btn secondary small','Đóng');close.type='button';close.onclick=()=>modal.close();
 head.append(el('h2','',title),close);body.addEventListener('click',e=>{if(e.target.closest('a[href]')&&e.button===0&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey)modal.close();});modal.append(head,body);document.body.append(modal);modal.addEventListener('close',()=>modal.remove(),{once:true});modal.showModal();return{modal,body};
}
function requestRow(r,lines,prefix='/',received=false){
 const row=el('article','supplier-context-row');row.append(link(requestName(r),prefix+'#/early-requests/'+encodeURIComponent(r.id)));
 row.append(el('p','muted small','Ngày lấy: '+date(r.pickupDate)));
 for(const {line,allocations}of lines)row.append(el('p','',line.sku+' · '+line.name+' · '+number(allocations.reduce((s,a)=>s+Number(received?a.receivedQty||0:a.quantity),0))+' '+(line.unit||'')));
 return row;
}
/** Manager only: caller checks identity; all reads still use existing staff API authorization. */
export function openSupplierRequestDetails({api,request}){
 const {modal,body}=dialog('Chi tiết đối chiếu · '+requestName(request));
 const suppliers=new Map(request.lines.flatMap(l=>l.allocations).filter(a=>a.supplierId).map(a=>[a.supplierId,a.supplierName]));
 body.append(el('p','muted','Các NCC trên phiếu: '+[...suppliers.values()].join(' · ')));
 const tabs=el('div','chips supplier-detail-tabs'),content=el('section','supplier-detail-content');tabs.setAttribute('role','tablist');body.append(tabs,content);
 const loaders={
  orders:async()=>{
   const rows=[];for(const id of suppliers.keys()){if(!modal.isConnected)return [];const data=await api('/purchase-orders?'+new URLSearchParams({supplierId:id}));rows.push(...data.orders.filter(o=>o.supplierId===id));}return rows;
  },
  requests:async()=>{
   const groups=[];for(const id of suppliers.keys())groups.push(await loadEarlyRequestPages(api,{supplierId:id},()=>modal.isConnected));return mergeRelatedRequests(groups);
  },
  stock:async()=>{
   const skus=[...new Set(request.lines.map(l=>l.sku))],rows=[];
   for(let i=0;i<skus.length;i+=100){if(!modal.isConnected)return [];const data=await api('/products?'+new URLSearchParams({skus:skus.slice(i,i+100).join(',')}));for(const p of data.products)rows.push({product:p,warehouses:data.warehouses});}return rows;
  }
 };
 const cache=new Map();let sequence=0;
 async function show(key){
  const mine=++sequence;for(const tab of tabs.children)tab.setAttribute('aria-selected',String(tab.dataset.tab===key));
  content.replaceChildren(el('p','muted','Đang tải…'));
  try{
   if(!cache.has(key))cache.set(key,loaders[key]().catch(e=>{cache.delete(key);throw e;}));const rows=await cache.get(key);if(!modal.isConnected||mine!==sequence)return;
   content.replaceChildren();if(key==='stock')content.append(el('p','muted small','Tồn các mã trên phiếu hiện tại; bấm tên để xem tồn và lịch sử đầy đủ trong CRM.'));
   if(!rows.length)content.append(el('p','muted','Không có dữ liệu phù hợp.'));
   for(const r of rows){
    if(key==='orders'){const row=el('article','supplier-context-row');row.append(link(r.ticketNumber,'/#/purchases/'+encodeURIComponent(r.id)),el('p','small',r.supplierName+' · '+(r.internalNo||'Chưa có số NCC')+' · '+(r.stateLabel||r.state||'')));content.append(row);}
    else if(key==='requests'){const lines=r.lines.map(line=>({line,allocations:line.allocations.filter(a=>suppliers.has(a.supplierId))})).filter(x=>x.allocations.length);content.append(requestRow(r,lines));}
    else{const row=el('article','supplier-context-row'),p=r.product;row.append(link(p.name+' ('+p.sku+')','/#/products?sku='+encodeURIComponent(p.sku)));for(const w of r.warehouses)row.append(el('p','small',w.name+': '+(p.stock?.[w.id]==null?'Chưa có dữ liệu':number(p.stock[w.id]))));row.append(el('p','muted small','Cập nhật: '+stamp(p.stockUpdatedAt)));content.append(row);}
   }
  }catch(e){if(!modal.isConnected||mine!==sequence)return;const retry=el('button','btn secondary','Thử lại');retry.type='button';retry.onclick=()=>show(key);content.replaceChildren(el('p','error',e.message),retry);}
 }
 for(const [key,title]of [['orders','Đơn mua NCC'],['requests','Phiếu xin hàng'],['stock','Tồn kho']]){const tab=el('button','chip',title);tab.type='button';tab.dataset.tab=key;tab.setAttribute('role','tab');tab.onclick=()=>show(key);tabs.append(tab);}
 show('orders');
}
export function receivedRequestLines(request,orderId,sku){
 return request.lines.filter(l=>l.sku.toLowerCase()===sku.toLowerCase()).map(line=>({line,allocations:line.allocations.filter(a=>a.orderId===orderId&&Number(a.receivedQty)>0)})).filter(x=>x.allocations.length);
}
/** Received quantity is supplied by purchase progress; show only attributed, non-cancelled early receipts. */
export async function openReceivedEarlyRequests({api,order,line}){
 const {modal,body}=dialog('Phiếu xin hàng đã nhận · '+line.sku);body.append(el('p','',line.name+' · Đã nhận đạt: '+number(line.good)+' '+(line.unit||'')));
 const list=el('div');body.append(list);
 async function load(){
  list.replaceChildren(el('p','muted','Đang tải phiếu xin hàng…'));
  try{
   const rows=await loadEarlyRequestPages(api,{q:line.sku,...(order.supplier?.id?{supplierId:order.supplier.id}:{})},()=>modal.isConnected);if(!modal.isConnected)return;
   list.replaceChildren();let linked=0;
   for(const r of rows){const lines=receivedRequestLines(r,order.id,line.sku);
    if(lines.length){linked+=lines.reduce((s,x)=>s+x.allocations.reduce((n,a)=>n+Number(a.receivedQty),0),0);list.append(requestRow(r,lines,'',true));}}
   if(!linked)list.append(el('p','muted','Không có phiếu xin hàng được ghi nhận nhận hàng cho mã này. Phần đã nhận có thể đến từ phiếu nhận thường hoặc dữ liệu nhập cũ.'));
   else if(linked<Number(line.good))list.append(el('p','muted small','Còn '+number(Number(line.good)-linked)+' không gắn phiếu xin hàng; xem Phiếu nhận hàng của đơn mua.'));
  }catch(e){if(!modal.isConnected)return;const retry=el('button','btn secondary','Thử lại');retry.type='button';retry.onclick=load;list.replaceChildren(el('p','error',e.message),retry);}
 }
 await load();
}
