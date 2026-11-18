export function initAiChat({api,root,toast,esc,fmtDate}) {
  let query='', searchTimer=0, pollTimer=0;
  const statusText={pending:'AI đang trả lời…',answered:'Đã trả lời',needs_review:'Cần kiểm tra n8n',failed:'Chưa trả lời được'};
  async function load(){
    clearTimeout(pollTimer);
    const data=await api('/ai-chat/questions?q='+encodeURIComponent(query),'GET',undefined,{fresh:true});
    // Polling may finish while the employee is still typing. Capture the live
    // editor state immediately before replacing the view so no keystroke,
    // selection or focus is lost during the 2.5-second answer refresh.
    const currentEditor=root.querySelector('[data-ask] textarea');
    const draft=currentEditor?{
      value:currentEditor.value,
      focused:document.activeElement===currentEditor,
      start:currentEditor.selectionStart,
      end:currentEditor.selectionEnd,
      direction:currentEditor.selectionDirection,
    }:null;
    root.innerHTML=`<header class="ai-chat-head"><div><p class="eyebrow">Kho kiến thức chung</p><h1>Chat cùng AI</h1><p>Mọi câu hỏi và câu trả lời đều công khai cho toàn bộ nhân viên.</p></div></header>
      <form class="card ai-chat-ask" data-ask><label>Hỏi về CRM, quy trình hoặc cách xử lý công việc<textarea name="question" rows="4" maxlength="3000" required placeholder="Ví dụ: Khi khách yêu cầu sửa báo giá đã duyệt thì em cần làm gì?"></textarea></label><div class="ai-chat-ask-foot"><small>Không nhập mật khẩu, dữ liệu khách hàng, lương thưởng hoặc chuyện cá nhân.</small><button class="btn primary">Gửi câu hỏi công khai</button></div></form>
      <div class="ai-chat-tools"><input type="search" value="${esc(query)}" placeholder="Tìm trong câu hỏi và câu trả lời…" data-search><span>${data.total} câu hỏi</span></div>
      <div class="ai-chat-list">${data.items.length?data.items.map(card).join(''):'<div class="card full-empty">Chưa có câu hỏi phù hợp.</div>'}</div>`;
    root.querySelector('[data-ask]').onsubmit=ask;
    const nextEditor=root.querySelector('[data-ask] textarea');
    if(draft){
      nextEditor.value=draft.value;
      if(draft.focused){
        nextEditor.focus({preventScroll:true});
        nextEditor.setSelectionRange(draft.start,draft.end,draft.direction||'none');
      }
    }
    root.querySelector('[data-search]').oninput=e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{query=e.target.value.trim();load().catch(showError)},300)};
    root.querySelectorAll('[data-helpful]').forEach(b=>b.onclick=async()=>{const on=b.dataset.on!=='1';await api('/ai-chat/questions/'+encodeURIComponent(b.dataset.helpful)+'/helpful','POST',{on});load().catch(showError)});
    if(data.items.some(item=>item.status==='pending')) pollTimer=setTimeout(()=>{if(!root.hidden)load().catch(showError)},2500);
  }
  function card(x){const waiting=x.status!=='answered';return `<article class="card ai-chat-card"><header><span class="pill">${esc(x.topic)}</span><span class="ai-chat-status ${esc(x.status)}">${esc(statusText[x.status]||x.status)}</span><time>${esc(fmtDate(x.createdAt))}</time></header><h2>${esc(x.question)}</h2><p class="ai-chat-author">${esc(x.authorName||'Nhân viên')}</p>${waiting?`<div class="ai-chat-wait">${esc(x.error||'Claw đang tiếp nhận và chuẩn bị câu trả lời.')}</div>`:`<div class="ai-chat-answer"><strong>Claw trả lời</strong><p>${esc(x.answer).replace(/\n/g,'<br>')}</p></div><button class="btn ghost small" data-helpful="${esc(x.id)}" data-on="${x.helpfulByMe?'1':'0'}">${x.helpfulByMe?'✓ ':''}Hữu ích · ${x.helpful}</button>`}</article>`}
  async function ask(e){e.preventDefault();const textarea=e.currentTarget.question,question=textarea.value.trim();try{await api('/ai-chat/questions','POST',{question,topic:'CRM'});toast('Đã đăng câu hỏi công khai. AI đang trả lời.');textarea.value='';await load();}catch(err){showError(err)}}
  function showError(e){toast(e.message||'Không tải được Chat cùng AI.','err')}
  return {show:()=>load().catch(showError)};
}
