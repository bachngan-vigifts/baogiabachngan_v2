/** Delegated Pointer Events work with mouse/touch/pen and survive list renders. */
export function initProductReorder({root,canStart=()=>true,onMove,announce=()=>{},rowSelector='.product-row[data-product-id]',handleSelector='[data-reorder-handle]',listSelector='.selection',idAttribute='data-product-id'}){
 let active=null,frame=0;
 const rows=list=>[...list.querySelectorAll(rowSelector)];
 const focus=id=>rows(root).find(n=>n.getAttribute(idAttribute)===id)?.querySelector(handleSelector)?.focus();
 function clearTarget(){if(active?.target)delete active.target.dataset.drop;}
 function finish(commit=false){
  const drag=active;if(!drag)return;
  clearTarget();active=null;cancelAnimationFrame(frame);frame=0;
  drag.row.classList.remove('is-reordering');drag.ghost?.remove();
  if(drag.handle.hasPointerCapture?.(drag.pointer))drag.handle.releasePointerCapture(drag.pointer);
  if(commit&&drag.dragging&&drag.target&&drag.row.isConnected&&canStart()){
   if(onMove(drag.id,drag.target.getAttribute(idAttribute),drag.after))focus(drag.id);
  }
 }
 function targetAt(){
  if(!active?.dragging)return;
  clearTarget();active.target=null;
  if(!active.row.isConnected){finish();return;}
  const bounds=active.list.getBoundingClientRect();
  if(active.x<bounds.left||active.x>bounds.right||active.y<bounds.top||active.y>bounds.bottom)return;
  const nodes=rows(active.list),target=nodes.find(n=>active.y<n.getBoundingClientRect().bottom)||nodes.at(-1);
  if(!target||target===active.row)return;
  active.target=target;const r=target.getBoundingClientRect();active.after=active.y>r.top+r.height/2;target.dataset.drop=active.after?'after':'before';
 }
 function scrollParent(node){for(let p=node.parentElement;p;p=p.parentElement)if(/auto|scroll/.test(getComputedStyle(p).overflowY)&&p.scrollHeight>p.clientHeight)return p;return window;}
 function tick(){
  if(!active?.dragging)return;
  if(!active.row.isConnected){finish();return;}
  const scroller=active.scroller,bounds=scroller===window?{top:0,bottom:innerHeight}:scroller.getBoundingClientRect();
  const top=Math.max(0,bounds.top),bottom=Math.min(innerHeight,bounds.bottom),edge=Math.min(64,(bottom-top)/4);
  const speed=active.y<top+edge?-Math.min(14,Math.ceil((top+edge-active.y)/4)):active.y>bottom-edge?Math.min(14,Math.ceil((active.y-bottom+edge)/4)):0;
  if(speed){scroller.scrollBy(0,speed);targetAt();}
  frame=requestAnimationFrame(tick);
 }
 root.addEventListener('pointerdown',event=>{
  let handle=event.target.closest(handleSelector);
  if(!handle||!root.contains(handle)||!event.isPrimary||event.button!==0||!canStart())return;
  let row=handle.closest(rowSelector),list=row?.closest(listSelector);if(!list)return;
  const id=row.getAttribute(idAttribute);
  finish();event.preventDefault();handle.focus({preventScroll:true});
  // Focusing commits a quantity edit, which can replace the entire row synchronously.
  if(!row.isConnected){row=rows(root).find(n=>n.getAttribute(idAttribute)===id);handle=row?.querySelector(handleSelector);list=row?.closest(listSelector);if(!handle||!list)return;handle.focus({preventScroll:true});}
  const bounds=row.getBoundingClientRect();
  active={id:row.getAttribute(idAttribute),row,list,handle,pointer:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,offset:event.clientY-bounds.top,bounds,scroller:scrollParent(list),dragging:false,target:null};
  handle.setPointerCapture?.(event.pointerId);
 });
 window.addEventListener('pointermove',event=>{
  if(!active||event.pointerId!==active.pointer)return;
  active.x=event.clientX;active.y=event.clientY;
  if(!active.dragging&&Math.hypot(active.x-active.startX,active.y-active.startY)<6)return;
  if(!active.dragging){
   active.dragging=true;active.row.classList.add('is-reordering');
   active.ghost=active.row.cloneNode(true);active.ghost.classList.remove('is-reordering');active.ghost.classList.add('reorder-ghost');active.ghost.inert=true;active.ghost.setAttribute('aria-hidden','true');
   Object.assign(active.ghost.style,{left:active.bounds.left+'px',width:active.bounds.width+'px'});document.body.append(active.ghost);frame=requestAnimationFrame(tick);
  }
  active.ghost.style.top=(active.y-active.offset)+'px';targetAt();
 });
 window.addEventListener('pointerup',event=>{if(active&&event.pointerId===active.pointer){active.x=event.clientX;active.y=event.clientY;targetAt();finish(true);}});
 window.addEventListener('pointercancel',()=>finish());window.addEventListener('blur',()=>finish());
 root.addEventListener('lostpointercapture',()=>finish());
 root.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&active){event.preventDefault();event.stopPropagation();finish();announce('Đã huỷ kéo thả.');return;}
  const handle=event.target.closest(handleSelector);if(!handle||!canStart()||!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
  event.preventDefault();const row=handle.closest(rowSelector),nodes=rows(row.closest(listSelector)),i=nodes.indexOf(row);
  const index=event.key==='Home'?0:event.key==='End'?nodes.length-1:event.key==='ArrowUp'?i-1:i+1;
  if(index<0||index>=nodes.length||index===i)return;
  if(onMove(row.getAttribute(idAttribute),nodes[index].getAttribute(idAttribute),index>i))focus(row.getAttribute(idAttribute));
 });
 return {cancel:()=>finish()};
}
