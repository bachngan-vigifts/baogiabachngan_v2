<?php
/**
 * Plugin Name: Minh Long hero product links
 * Description: Accessible image hotspots for the November 2026 Kim Sa / Ma Dao hero.
 * Version: 1.0.0
 */
defined('ABSPATH') || exit;
add_action('wp_footer', static function () {
 if (!is_front_page() || strtolower((string)wp_parse_url(home_url('/'), PHP_URL_HOST)) !== 'minhlongonline.com') return;
 ?>
 <style id="ml-hero-product-links-css">.ml-hero-link-host:not(.banner-inner){position:relative}
a.ml-hero-product-link{position:absolute!important;display:block!important;z-index:25!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important;cursor:pointer;box-sizing:border-box}
a.ml-hero-product-link:focus-visible{outline:3px solid #ffce54!important;outline-offset:3px;border-radius:8px}
</style>
 <script id="ml-hero-product-links-js" data-no-optimize="1" data-no-defer="1">(()=>{
 'use strict';
 const items=[
 {slug:'/bo-suu-tap-noi-su-duong-sinh-ceres-kim-sa/',label:'Khám phá nồi dưỡng sinh Kim Sa',pc:[.148,.397,.110,.120],mobile:[.098,.397,.146,.085]},
 {slug:'/san-pham/binh-hoa-ma-dao-thanh-cong-minh-long-27cm-k26/',label:'Xem bình hoa Mã Đáo Thành Công',pc:[.330,.397,.160,.120],mobile:[.310,.397,.212,.085]}
 ];
 function init(){
 document.querySelectorAll('img').forEach(img=>{
  const src=img.currentSrc||img.src;
  if(!/\/banner-san-pham-moi-2026-(pc|mobile)\.webp(?:\?|$)/.test(src)||img.dataset.mlHeroLinks)return;
  const mobile=src.includes('-mobile.webp');
  let host=mobile?img.closest('.img-inner'):img.closest('.banner-inner');
  if(!host)return;
  // Mobile image has an existing full-image link: use sibling hotspots, never nested anchors.
  if(host.closest('a'))host=host.closest('a').parentElement;
  if(!host)return;
  img.dataset.mlHeroLinks='1';host.classList.add('ml-hero-link-host');
  const links=items.map(item=>{
   const a=document.createElement('a');a.className='ml-hero-product-link';a.href=item.slug;
   a.setAttribute('aria-label',item.label);a.title=item.label;host.appendChild(a);return a;
  });
  function layout(){
   const ir=img.getBoundingClientRect(),hr=host.getBoundingClientRect();
   if(!ir.width||!ir.height||!img.naturalWidth){links.forEach(a=>a.style.setProperty('display','none','important'));return;}
   const style=getComputedStyle(img),fit=style.objectFit;
   let rw=ir.width,rh=ir.height;
   if(fit==='cover'||fit==='contain'){
    const scale=Math[fit==='cover'?'max':'min'](ir.width/img.naturalWidth,ir.height/img.naturalHeight);
    rw=img.naturalWidth*scale;rh=img.naturalHeight*scale;
   }
   const pos=style.objectPosition.split(' ');
   const fraction=v=>v?.endsWith('%')?parseFloat(v)/100:.5;
   const ox=(ir.width-rw)*fraction(pos[0]),oy=(ir.height-rh)*fraction(pos[1]);
   items.forEach((item,i)=>{
    const [x,y,w,h]=mobile?item.mobile:item.pc;
    const height=mobile?Math.max(32,rh*h):rh*h;
    const left=Math.max(0,ox+rw*x),top=Math.max(0,oy+rh*y-(height-rh*h)/2);
    const right=Math.min(ir.width,ox+rw*(x+w)),bottom=Math.min(ir.height,top+height);
    const a=links[i];a.style.setProperty('display',right>left&&bottom>top?'block':'none','important');
    Object.assign(a.style,{left:(ir.left-hr.left+left)+'px',top:(ir.top-hr.top+top)+'px',width:Math.max(0,right-left)+'px',height:Math.max(0,bottom-top)+'px'});
   });
  }
  img.addEventListener('load',layout);layout();
  if('ResizeObserver' in window){const ro=new ResizeObserver(layout);ro.observe(img);ro.observe(host);}
  else window.addEventListener('resize',layout,{passive:true});
 });
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();</script>
 <?php
}, 30);
