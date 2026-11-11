/** Assignment is attached to server-generated source work; never accepts a free-form replacement task. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sources={packing:'Đóng gói',transfer:'Điều chuyển kho',purchase:'Nhận hàng NCC'};
const labels={free:'Đang rảnh',offered:'Chờ nhận',working:'Đang làm',blocked:'Đang vướng mắc'};
const localDate=s=>{const d=new Date(s);return Number.isFinite(+d)?new Date(+d+7*3600000).toISOString().slice(0,16):'';};
export function initWarehouseAssignment({api,toast,identity,isManager,onSaved=()=>{}}){
 let dialog=null,seq=0,pendingTimer=null,pendingKey='';
 const close=()=>{seq++;dialog?.close();dialog?.remove();dialog=null;};
 async function open(taskId=''){
  if(!isManager())return;close();const current=++seq,key=identity();
  dialog=document.createElement('dialog');dialog.className='modal ww-assignment-dialog';dialog.innerHTML='<div class="ww-assignment-loading" role="status">Đang lấy công việc tự sinh và người phụ trách…</div>';document.body.append(dialog);dialog.showModal();
  let list=[],info=null,mode='single',lead='',selected=new Set(),values=new Map(),due='',reason='',page=0;
  const alive=()=>current===seq&&key===identity()&&dialog?.open;
  function remember(){if(!dialog)return;for(const row of dialog.querySelectorAll('[data-member]')){const id=row.dataset.member,part=row.querySelector('[data-part]'),minutes=row.querySelector('[data-minutes]'),units=row.querySelector('[data-units]');if(part)values.set(id,{part:part.value,minutes:minutes?.value??'',units:units?.value??'1'});}due=dialog.querySelector('[name=dueAt]')?.value??due;reason=dialog.querySelector('[name=reason]')?.value??reason;}
  async function load(id='',preserveList=false){const q=new URLSearchParams(id?{taskId:id}:{page:String(page)}),next=await api('/warehouse-workspace/assignment-options?'+q);if(!alive())return;
   info=next;if(!preserveList)list=next.tasks;mode='single';lead=next.recommended||'';selected=new Set(lead?[lead]:[]);values=new Map();
   const task=info.tasks.find(t=>t.id===info.selectedTaskId),stamp=task?.dueDate?task.dueDate+'T'+(task.dueTime||'23:59')+':00+07:00':'';
   due=stamp&&Date.parse(stamp)>Date.parse(info.now)?localDate(stamp):'';reason='';draw();
  }
  function draw(){if(!alive())return;const task=info?.tasks.find(t=>t.id===info.selectedTaskId),people=info?.people||[],ids=mode==='single'?(lead?[lead]:[]):[...selected];
   dialog.innerHTML=`<form data-no-busy><header class="modal-head"><div><h2>Phân công việc kho</h2><p>Chọn người hoặc cả team cho công việc từ phiếu gốc.</p></div><button type="button" class="icon-btn" data-close aria-label="Đóng">×</button></header><div class="ww-assignment-body">
    ${info?.blocked?.length?`<details class="ww-assignment-wait" data-blocked><summary>${info.blocked.length} việc cần kiểm tra kho nguồn</summary>${info.blocked.map(t=>`<p><b>${esc(t.title)}</b><br>${esc(t.reason)}</p>`).join('')}</details>`:''}
    <label>Công việc tự sinh <span class="error">*</span><select name="sourceTask" required><option value="">${list.length?'Chọn công việc':'Chưa có việc cần chuẩn bị'}</option>${list.map(t=>`<option value="${esc(t.id)}"${t.id===info.selectedTaskId?' selected':''}>${esc(t.title)}</option>`).join('')}</select></label>
    ${!task?`<p class="muted">Chỉ lấy việc tự sinh đang chờ xử lý, chưa theo dõi định mức. Không tạo thêm việc trùng phiếu.</p>${info?.hasMore?'<button type="button" class="btn secondary" data-next>Trang công việc tiếp theo →</button>':''}`:`<div class="ww-assignment-summary"><b>${esc(task.title)}</b><small>Phiếu nguồn · ${esc(sources[task.source]||task.source)} · Hạn gốc ${esc(task.dueDate||'chưa có')}</small></div>
    <div class="ww-assignment-modes" role="group" aria-label="Cách phân công"><button type="button" data-mode="single" aria-pressed="${mode==='single'}">Một nhân viên</button><button type="button" data-mode="team" aria-pressed="${mode==='team'}">Cả team</button></div>
    <div class="ww-assignment-recommendation"><b>${esc(info.reason)}</b><span>${info.recommended?'Đề xuất: '+esc(people.find(p=>p.id===info.recommended)?.name):'Kho chưa có nhân viên đủ quyền. Cần phân công kho trước.'}</span></div>
    ${mode==='team'?`<label>Phụ trách chính <span class="error">*</span><select name="lead" required><option value="">Chọn thành viên</option>${people.filter(p=>selected.has(p.id)).map(p=>`<option value="${esc(p.id)}"${lead===p.id?' selected':''}>${esc(p.name)}</option>`).join('')}</select></label><p class="muted">Team gồm những nhân viên được phân công tại kho nguồn. Mỗi người theo dõi phần việc riêng.</p>`:''}
    <div class="ww-assignment-members">${people.map(p=>{const checked=ids.includes(p.id),v=values.get(p.id)||{};return `<article class="ww-assignment-member ${checked?'selected':''}" data-member="${esc(p.id)}"><label class="ww-assignment-person"><input type="${mode==='team'?'checkbox':'radio'}" name="assignee" value="${esc(p.id)}"${checked?' checked':''}><b>${esc(p.name)}</b><span class="ww-person-state ${p.status==='free'?'free':'busy'}">${esc(labels[p.status]||p.status)}</span></label><div class="ww-assignment-stats"><span>Hệ số: <b>${p.coefficient==null?'Chưa đủ dữ liệu':p.coefficient.toLocaleString('vi-VN',{maximumFractionDigits:2})}</b></span><span>Việc chờ: <b>${p.queueCount}</b></span>${p.id===info.recommended?'<span class="ww-suggested">Đề xuất</span>':''}</div><div class="ww-assignment-part"${checked?'':' hidden'}><label>Phần việc *<input data-part maxlength="300" placeholder="VD: kiểm đếm, đóng gói, bàn giao…" value="${esc(v.part|| (mode==='single'?'Thực hiện công việc nguồn':''))}"${checked?' required':' disabled'}></label><label>Phút công chuẩn *<input type="number" data-minutes min="0.1" max="100000" step="0.1" value="${esc(v.minutes||'')}"${checked?' required':' disabled'}></label>${mode==='team'?`<label>Phần khối lượng *<input type="number" data-units min="0.1" max="10000" step="0.1" value="${esc(v.units||1)}"${checked?' required':' disabled'}></label>`:''}</div></article>`;}).join('')}</div>
    ${mode==='team'?'<p class="muted">Khối lượng mặc định chia đều; có thể điều chỉnh trước khi giao. Tổng khối lượng các phần bằng một việc nguồn, không tính trùng.</p>':''}
    <p class="ww-assignment-wait">Người đang bận nhận việc ở trạng thái <b>Chờ lượt</b>; không bắt đầu hai việc cùng lúc.</p>
    <label>Hạn hoàn tất phần việc *<input type="datetime-local" name="dueAt" value="${esc(due)}" required></label><small class="muted">Việc đã quá hạn nguồn cần đặt hạn theo dõi mới và ghi lý do; không đổi ngày trên phiếu gốc hoặc hồi tố giờ làm.</small>
    <label>Lý do / ghi chú phối hợp<textarea name="reason" maxlength="1000" placeholder="Bắt buộc nếu đổi người đề xuất hoặc đổi hạn phần việc">${esc(reason)}</textarea></label>`}
    <p class="error" role="alert" data-error></p></div><footer class="ww-assignment-foot"><button type="button" class="btn secondary" data-close>Quay lại</button><button type="submit" class="btn navy"${!task||!ids.length?' disabled':''}>${mode==='team'?'Giao team ('+ids.length+')':'Xác nhận phân công'}</button></footer></form>`;
   dialog.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',close));dialog.querySelector('[data-next]')?.addEventListener('click',()=>{page++;load().catch(error);});
   dialog.querySelector('[name=sourceTask]')?.addEventListener('change',e=>{if(e.target.value)load(e.target.value,true).catch(error);});
   dialog.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{remember();mode=b.dataset.mode;if(mode==='team')for(const v of values.values())if(v.part==='Thực hiện công việc nguồn')v.part='';if(mode==='team'&&!selected.size&&lead)selected.add(lead);if(mode==='team'&&selected.size===1)selected=new Set(people.map(p=>p.id));draw();}));
   dialog.querySelectorAll('[name=assignee]').forEach(input=>input.addEventListener('change',()=>{remember();if(mode==='single'){lead=input.value;selected=new Set([lead]);}else{input.checked?selected.add(input.value):selected.delete(input.value);if(!selected.has(lead))lead=[...selected][0]||'';}draw();}));
   dialog.querySelector('[name=lead]')?.addEventListener('change',e=>{lead=e.target.value;});
   dialog.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();remember();const currentIds=mode==='single'?[lead]:[...selected];if(!currentIds.length||mode==='team'&&currentIds.length<2){error(new Error('Giao team cần ít nhất hai thành viên.'));return;}
    const members=currentIds.map(memberId=>{const v=values.get(memberId);return{memberId,part:v.part,standardMinutes:Number(v.minutes),units:Number(v.units||1)};}),body={mode,leadId:lead,members,reason,dueAt:new Date(due+':00+07:00').toISOString(),taskRevision:task.taskRevision};
    const submit=dialog.querySelector('[type=submit]');submit.disabled=true;
    try{if(!alive())return;await api('/warehouse-workspace/'+encodeURIComponent(task.id)+'/assign','POST',body);if(!alive())return;close();toast('Đã phân công từ phiếu gốc. Người đang bận sẽ chờ lượt.');onSaved();}
    catch(e){if(alive()){error(e);submit.disabled=false;}}
   });
  }
  function error(e){if(!alive())return;const el=dialog.querySelector('[data-error]');if(el)el.textContent=e.message;else{dialog.innerHTML=`<p class="error">${esc(e.message)}</p><button type="button" class="btn secondary" data-close>Đóng</button>`;dialog.querySelector('[data-close]').onclick=close;}}
  dialog.addEventListener('cancel',()=>{seq++;dialog?.remove();dialog=null;});
  try{await load(taskId);}catch(e){error(e);}
 }
 function afterWrite({path,method,data,body}){
  if(!isManager()||method==='GET')return;
  let type='',id='';const match=/^\/(packing|stock-transfers|purchase-orders|purchase-early-requests)(?:\/([^/?]+))?/.exec(path);if(!match)return;
  type=({packing:'packing','stock-transfers':'transfer','purchase-orders':'purchase','purchase-early-requests':'early'})[match[1]];
  id=match[2]||body?.orderId||data?.id;if(!id)return;
  const key=identity();pendingKey=key;clearTimeout(pendingTimer);let tries=0;
  const show=async()=>{if(key!==identity()||!isManager())return;if(document.querySelector('dialog[open]')){if(++tries<120)pendingTimer=setTimeout(show,500);return;}
   try{const sync=await api('/warehouse-workspace/source-sync','POST',{type,id});if(key!==identity())return;for(const taskId of sync.taskIds||[]){const options=await api('/warehouse-workspace/assignment-options?taskId='+encodeURIComponent(taskId));if(key!==identity())return;if(options.tasks.length){await open(taskId);break;}}}catch(e){if(key===identity())toast('Phiếu đã lưu; cần kiểm tra phân công việc Kho: '+e.message,'err');}
  };pendingTimer=setTimeout(show,350);
 }
 const listener=e=>afterWrite(e.detail||{});globalThis.addEventListener?.('crm:warehouse-source-written',listener);
 return{open,afterWrite,close,destroy(){close();clearTimeout(pendingTimer);pendingKey='';globalThis.removeEventListener?.('crm:warehouse-source-written',listener);}};
}
