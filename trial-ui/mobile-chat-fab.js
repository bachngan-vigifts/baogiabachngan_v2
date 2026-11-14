/**
 * Nút tin nhắn tròn trên điện thoại: tránh che nút của trang.
 * Cuộn xuống → nút lùi xuống dưới (ẩn); cuộn lên, về đầu trang hoặc tới cuối trang → hiện lại.
 * Chỉ đổi class trên <body>; không đổi dữ liệu hay luồng tin nhắn.
 */
export function chatFabDirection(previous,current,{top,bottom}){
 if(current<=40||current>=bottom-8)return'show';
 if(current-previous>8)return'hide';
 if(previous-current>8)return'show';
 return'keep';
}
export function installChatFab({win=window,doc=document,query='(max-width: 850px)'}={}){
 const media=win.matchMedia?.(query);const positions=new WeakMap();let frame=0;
 function onScroll(event){
  if(!media?.matches||frame)return;
  const node=event.target===doc||event.target===doc.documentElement||event.target===doc.body?doc.scrollingElement||doc.documentElement:event.target;
  if(!(node instanceof win.Element)||node.closest?.('dialog,.chat-panel,.crm-filter-sheet,.mobile-action-list'))return;
  if(node!==doc.scrollingElement&&node.scrollHeight<=node.clientHeight+80)return; // ô cuộn nhỏ (bảng, danh sách gợi ý) không điều khiển nút
  frame=win.requestAnimationFrame(()=>{frame=0;
   const current=node.scrollTop,previous=positions.get(node)??0;positions.set(node,current);
   const verdict=chatFabDirection(previous,current,{top:0,bottom:node.scrollHeight-node.clientHeight});
   if(verdict!=='keep')doc.body.classList.toggle('chat-fab-tucked',verdict==='hide');
  });
 }
 doc.addEventListener('scroll',onScroll,{capture:true,passive:true});
 const reset=()=>doc.body.classList.remove('chat-fab-tucked');win.addEventListener('hashchange',reset);
 return()=>{doc.removeEventListener('scroll',onScroll,{capture:true});win.removeEventListener('hashchange',reset);reset();};
}
