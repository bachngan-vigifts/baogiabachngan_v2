const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=String(text);return n;};
const num=n=>new Intl.NumberFormat('vi-VN',{maximumFractionDigits:3}).format(n||0);
export function returnStateText(summary,lines){
 if(!summary?.receivedQty)return '';
 const shipped=lines.reduce((n,l)=>n+l.deliveredQty,0);
 return summary.receivedQty>=shipped&&shipped>0?'Đã nhận hoàn toàn bộ':'Đã nhận hoàn một phần';
}
/** Show actual receipt independently from refunds and the stock-proof workflow. */
export function renderOrderReturns({host,order,summary}){
 if(order.channel!=='crm'||!summary?.requests?.length)return;
 const box=el('section','','order-return-history');box.append(el('h3','Hàng hoàn về'));
 box.append(el('p','Số đã giao giữ nguyên lịch sử; khách đang giữ = đã giao − đã nhận hoàn. Nhận hàng hoàn và hoàn tiền là hai bước riêng.','small muted'));
 const state={pending:'Chờ duyệt',approved:'Đã duyệt — chờ nhận hàng',processing:'Đã nhận hàng — đang xử lý',completed:'Hoàn tất',cancelled:'Đã huỷ',rejected:'Từ chối'};
 for(const r of summary.requests){
  const item=el('div','','order-return-record'),link=el('a',r.returnNo);link.href='#/orders/'+encodeURIComponent(order.id)+'?returns=1';item.append(link,el('span',state[r.status]||r.status,'pill '+(r.receivedAt?'ok':'muted')));
  const date=r.receivedAt?new Date(r.receivedAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'';
  if(r.basisKind==='pre_opening')item.append(el('p','Phiếu hoàn đã được duyệt theo căn cứ hàng giao trước chốt tồn.','small muted'));
  item.append(el('p',r.receivedAt?'Đã nhận về '+r.warehouseName+' · '+date:'Chưa ghi nhận thực nhận; chưa trừ số khách đang giữ.','small'));
  for(const l of r.lines){const suffix=r.receivedAt?`nhận hoàn ${num(l.receivedQty)} ${l.unit} · nhập lại kho ${num(l.restockQty)} ${l.unit}${l.disposition==='damaged'?' · hàng hỏng, không nhập tồn bán':''}`:`đề nghị ${num(l.requestedQty)} ${l.unit}`;item.append(el('p',`${l.sku}: ${suffix}`,'small'));}
  box.append(item);
 }
 host.append(box);
}
