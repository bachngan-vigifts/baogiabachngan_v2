const kinds={quote:'Báo giá',order:'Đơn hàng',contract:'HĐKT',purchase:'Đơn mua NCC',transfer:'Điều chuyển kho',cash:'Thu / chi',return:'Đổi / trả hàng',customer:'Khách hàng',product:'Sản phẩm'};
/** Read-only global entry to the existing approval inbox; approval itself stays on each document. */
export function initApprovalLauncher({api,button,badge,canApprove,userId,go}) {
  let active=false,sequence=0,timer=null,writeTimer=null;
  async function refresh(){
    if(!active)return;
    if(!canApprove()||!userId()){stop();return;}
    const request=++sequence,who=userId();button.hidden=false;
    try{
      const data=await api('/approvals?summary=1');
      if(request!==sequence||who!==userId()||!active||!canApprove())return;
      const total=Number(data.counts.total)||0;
      badge.textContent=total.toLocaleString('vi-VN');badge.hidden=false;
      button.dataset.empty=String(total===0);button.dataset.pending=String(total>0);
      button.setAttribute('aria-label',`Cần duyệt: ${total} việc`);
      button.title=total ? `Cần duyệt: ${total} việc\n`+Object.entries(kinds).filter(([kind])=>data.counts[kind]>0).map(([kind,label])=>`${label}: ${data.counts[kind]}`).join('\n') : 'Không có việc đang chờ duyệt';
    }catch(error){
      if(request!==sequence||who!==userId()||!active)return;
      if(error.status===403){stop();return;}
      badge.textContent='!';badge.hidden=false;button.dataset.empty='false';button.dataset.pending='false';
      button.title=error.message||'Chưa tải được số việc cần duyệt';button.setAttribute('aria-label','Chưa tải được số việc cần duyệt. Bấm để mở danh sách.');
    }
  }
  function stop(){active=false;sequence++;clearInterval(timer);clearTimeout(writeTimer);timer=writeTimer=null;button.hidden=true;button.dataset.pending='false';badge.textContent='0';}
  function start(){stop();if(!canApprove()||!userId())return;active=true;timer=setInterval(()=>{if(!document.hidden)refresh();},30000);return refresh();}
  function scheduleRefresh(){if(!active)return;clearTimeout(writeTimer);writeTimer=setTimeout(refresh,750);}
  button.addEventListener('click',()=>{if(active&&canApprove())go('#/tasks/approvals');});
  document.addEventListener('visibilitychange',()=>{if(active&&!document.hidden)refresh();});
  return{start,refresh,stop,scheduleRefresh};
}
