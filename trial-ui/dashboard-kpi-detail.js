/** A read-only, paged view of the source records behind one KPI. */
export function openKpiDetail({api,member,part,query,money}){
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
 const dlg=el('dialog',null,'dash-kpi-popup'),title=el('h2',part.label+' · '+member.name),close=el('button','Đóng','btn secondary'),body=el('div'),heading=el('header');
 title.id='dash-kpi-popup-title';dlg.setAttribute('aria-labelledby',title.id);close.type='button';heading.append(title,close);dlg.append(heading,body);document.body.append(dlg);
 let seq=0;const stop=()=>{seq++;dlg.close();};close.onclick=stop;dlg.addEventListener('close',()=>{seq++;dlg.remove();});
 const fmt=n=>n==null?'Chưa xác định':part.key==='revenue'?money(n):Number(n).toLocaleString('vi-VN');
 async function load(page=1){
  const id=++seq;body.replaceChildren(el('p','Đang tải chi tiết…'));body.setAttribute('aria-busy','true');
  try{
   const data=await api('/dashboard/kpi/detail?'+new URLSearchParams({...query,member:member.id,metric:part.key,page:String(page)}));if(id!==seq||!dlg.open)return;
   body.replaceChildren(el('p',`Tháng ${data.month} · KPI đang xem: ${fmt(part.actual)}${part.extra?' + '+part.extra+' quy đổi':''} · Tổng CRM hiện tại: ${fmt(data.total)} · ${data.sourceCount} dòng`,'dash-kpi-detail-summary'));
   if(member.status!=='estimate'||member.source==='manual'||part.actual!==data.total)body.append(el('p','Số KPI có thể là số nhập tay, số đã chốt hoặc bản tính trước đó. Danh sách dưới đây là nguồn CRM hiện tại để đối chiếu; không thay đổi số đã chốt.','dash-kpi-detail-warning'));
   if(part.extra)body.append(el('p','Phần quy đổi từ ngày làm hàng / công tác không phải khách hàng hay giao dịch riêng.'));
   if(data.issues)body.append(el('p',`${data.issues} đơn thiếu căn cứ doanh số; các dòng này chưa được cộng tổng.`,'dash-kpi-detail-warning'));
   if(!data.rows.length)body.append(el('p','Không có bản ghi phù hợp trong kỳ.'));
   else{
    const table=el('table'),head=el('thead'),tr=el('tr'),rows=el('tbody');
    for(const text of ['Ngày','Chứng từ / nội dung','Khách hàng',part.key==='revenue'?'Doanh số':'Số tính KPI','Căn cứ'])tr.append(el('th',text));head.append(tr);
    for(const r of data.rows){const row=el('tr'),label=el('td'),a=el('a',r.label);a.href=r.href;a.addEventListener('click',stop);label.append(a);row.append(el('td',r.date.includes('T')?new Date(Date.parse(r.date)+7*3600000).toISOString().slice(0,10):r.date),label,el('td',r.customer),el('td',fmt(r.amount)),el('td',r.note));rows.append(row);}
    table.append(head,rows);const wrap=el('div',null,'dash-kpi-detail-table');wrap.append(table);body.append(wrap);
   }
   const nav=el('nav',null,'dash-kpi-detail-pages'),prev=el('button','Trang trước','btn secondary'),next=el('button','Trang sau','btn secondary');prev.type=next.type='button';prev.disabled=data.page<=1;next.disabled=data.page>=data.pages;prev.onclick=()=>load(data.page-1);next.onclick=()=>load(data.page+1);nav.append(prev,el('span',`${data.page} / ${data.pages}`),next);body.append(nav);
  }catch(e){if(id!==seq||!dlg.open)return;const retry=el('button','Thử lại','btn secondary');retry.type='button';retry.onclick=()=>load(page);body.replaceChildren(el('p',e.message||'Không tải được chi tiết.','error'),retry);}
  finally{if(id===seq)body.removeAttribute('aria-busy');}
 }
 dlg.showModal();load();return dlg;
}
