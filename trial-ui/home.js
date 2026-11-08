/** Home is loaded on demand and never mounts a second app or navigation footer. */
let style;
function loadStyle() {
  return style ||= new Promise((resolve,reject)=>{
    const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./home.css',import.meta.url).href;
    link.onload=resolve;link.onerror=()=>{style=null;link.remove();reject(Error('Chưa tải được giao diện Trang chủ.'));};document.head.append(link);
  });
}
export function initHome({root}) {
  let active=false;
  return {
    async show(){active=true;root.dataset.ready='false';await loadStyle();if(!active)return;root.innerHTML='<header class="home-head"><h1>Trang chủ</h1><p>Việc cần làm và các chức năng của bạn</p></header>';root.dataset.ready='true';},
    hide(){active=false;},
  };
}
