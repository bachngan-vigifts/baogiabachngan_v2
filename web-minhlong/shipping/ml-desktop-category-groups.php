<?php
/**
 * Plugin Name: Minh Long Desktop Grouped Category Menu
 * Version: 1.0.1
 */
defined('ABSPATH')||exit;
add_action('init',function(){
 if(get_option('ml_desktop_needs_version')==='2')return;
 do_action('litespeed_purge_all');
 update_option('ml_desktop_needs_version','2',false);
});
add_action('wp_footer',function(){
?>
<style id="ml-desktop-needs-style">.ml-desktop-needs .lnl-needs-menu{display:none;}
@media(min-width:850px){

.ml-desktop-needs.lnl-needs-ready > .menu-menu-doc-container > .menu-item-object-product_cat,.ml-desktop-needs.lnl-needs-ready .sidebar-menu > .nav-sidebar > .header-search-form{display:none!important;}
.ml-desktop-needs .lnl-needs-menu{display:block;padding:20px 14px 24px;color:#245b88;background:linear-gradient(#fff,#f1f8fe);text-transform:none;}
.ml-desktop-needs .lnl-needs-menu h2{font-size:20px;line-height:1.3;font-weight:800;color:#245b88;margin:0 0 16px;}
.ml-desktop-needs .lnl-needs-search{display:flex;gap:0;margin:0 0 14px;}
.ml-desktop-needs .lnl-needs-search input[type=search]{flex:1;min-width:0;height:42px;margin:0;border:1px solid #bed9ee;border-right:0;border-radius:9px 0 0 9px;background:#fff;box-shadow:none;font-size:12px;padding:0 10px;color:#234d70;}
.ml-desktop-needs .lnl-needs-search button{width:42px;min-width:42px;height:42px;margin:0;padding:0;border:1px solid #bed9ee;border-left:0;border-radius:0 9px 9px 0;background:#fff;color:#245b88;box-shadow:none;line-height:1;}
.ml-desktop-needs .lnl-needs-search .lnl-needs-reset{width:26px;min-width:26px;border-right:0;border-radius:0;color:#6d8ba3;font-size:20px;}
.ml-desktop-needs .lnl-needs-search svg{width:19px;height:19px;vertical-align:middle;}
.ml-desktop-needs .lnl-need{margin:0 0 10px;border:1px solid #cde3f5;border-radius:12px;background:#fff;overflow:hidden;}
.ml-desktop-needs .lnl-need > summary{display:flex;align-items:center;gap:10px;padding:12px 10px;min-height:70px;list-style:none;cursor:pointer;}
.ml-desktop-needs .lnl-need > summary::-webkit-details-marker,.ml-desktop-needs .lnl-needs-all > summary::-webkit-details-marker{display:none;}
.ml-desktop-needs .lnl-need-icon{display:flex;align-items:center;justify-content:center;flex:0 0 48px;width:48px;height:48px;border-radius:10px;background:#eef7fe;color:#245b88;}
.ml-desktop-needs .lnl-need-icon{overflow:hidden;background:#fff;}
.ml-desktop-needs .lnl-need-icon img{display:block;width:48px;height:48px;object-fit:contain;border-radius:9px;}
.ml-desktop-needs .lnl-need-caption{flex:1;min-width:0;}
.ml-desktop-needs .lnl-need-caption strong{display:block;font-size:15px;line-height:1.3;font-weight:800;color:#245b88;}
.ml-desktop-needs .lnl-need-caption small{display:block;margin-top:4px;font-size:11px;line-height:1.4;color:#567088;}
.ml-desktop-needs .lnl-need > summary:after{content:'';width:6px;height:6px;border-right:1.5px solid #245b88;border-bottom:1.5px solid #245b88;transform:rotate(-45deg);flex:0 0 auto;margin:0 3px;}
.ml-desktop-needs .lnl-need[open] > summary{background:#f1f8ff;}
.ml-desktop-needs .lnl-need[open] > summary:after{transform:rotate(45deg);}
.ml-desktop-needs .lnl-need-links{border-top:1px solid #e5eef7;padding:4px 8px 8px;}
.ml-desktop-needs .lnl-need-links a{display:block;padding:11px 10px;min-height:42px;color:#245b88;font-size:13px;font-weight:600;line-height:1.4;border-radius:6px;text-transform:none;}
.ml-desktop-needs .lnl-need-links a:hover,.ml-desktop-needs .lnl-need-links a:focus-visible{background:#eef7ff;}
.ml-desktop-needs .lnl-needs-all{margin-top:16px;border:1px solid #9bc4e7;border-radius:10px;background:#fff;}
.ml-desktop-needs .lnl-needs-all > summary{list-style:none;padding:12px;text-align:center;color:#245b88;font-size:14px;font-weight:800;cursor:pointer;}
.ml-desktop-needs .lnl-needs-all > summary:after{content:' ＋';}
.ml-desktop-needs .lnl-needs-all[open] > summary:after{content:' −';}
.ml-desktop-needs .lnl-needs-menu [hidden]{display:none!important;}
.ml-desktop-needs .lnl-needs-empty{font-size:13px;color:#52697b;line-height:1.5;padding:10px 4px;}
.ml-desktop-needs .lnl-needs-menu summary:focus-visible{outline:2px solid #468ac2;outline-offset:-3px;}
}
@media(min-width:850px){
.ml-desktop-needs.lnl-needs-ready>.menu-menu-doc-container{display:none!important}
.header-vertical-menu:focus-within .header-vertical-menu__fly-out.ml-desktop-needs{display:block!important;opacity:1!important;visibility:visible!important;pointer-events:auto!important}
.header-vertical-menu__fly-out.ml-desktop-needs{width:390px!important;max-width:calc(100vw - 32px)!important;max-height:calc(100dvh - 150px)!important;border:1px solid #cde3f5;border-radius:0 0 14px 14px;overflow:auto!important;background:#fff}
.ml-desktop-needs .lnl-needs-menu{padding:16px!important}
.ml-desktop-needs .lnl-needs-menu h2{font-size:18px!important;margin-bottom:12px!important}
.ml-desktop-needs .lnl-need{margin-bottom:7px!important}
.ml-desktop-needs .lnl-need>summary{min-height:64px!important;padding:8px 10px!important}
.ml-desktop-needs .lnl-needs-search{display:flex!important;height:42px!important}
.ml-desktop-needs .lnl-needs-search button{display:flex!important;align-items:center!important;justify-content:center!important;position:static!important;transform:none!important;min-height:42px!important;line-height:1!important;margin:0!important;padding:0!important}
.ml-desktop-needs .lnl-need-links a{white-space:normal!important}
}
</style>
<script id="ml-desktop-needs-script">(function(){
function init(){
var root=document.querySelector('.header-vertical-menu__fly-out');if(!root||root.querySelector('.lnl-needs-menu'))return;
var sidebar=root,source=root.querySelector('.menu-menu-doc-container');if(!source)return;
var originals=Array.from(source.querySelectorAll('.menu-item-object-product_cat > a[href]'));if(!originals.length)return;
var ui=document.createElement('section');ui.className='lnl-needs-menu';ui.setAttribute('aria-label','Danh mục theo nhu cầu');
var heading=document.createElement('h2');heading.textContent='Danh mục sản phẩm';ui.appendChild(heading);
var search=document.createElement('form');search.className='lnl-needs-search';search.method='get';search.action="https:\/\/minhlongonline.com\/";
search.innerHTML='<input type="search" name="s" placeholder="Tìm sản phẩm hoặc danh mục" aria-label="Tìm sản phẩm hoặc danh mục" autocomplete="off"><input type="hidden" name="post_type" value="product"><button type="submit" aria-label="Tìm sản phẩm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg></button>';ui.appendChild(search);
var input=search.querySelector('input[type=search]');
var photos={"bag":"https://minhlongonline.com/wp-content/uploads/2026/09/tai-xuong-46.webp","box":"https://minhlongonline.com/wp-content/uploads/2026/11/noi-duong-sinh-ceres-cao-healthycook-kim-sa-510x510.webp","care":"https://minhlongonline.com/wp-content/uploads/2026/11/112776565-binh-hoa-ma-dao-thanh-cong-minh-long-27cm-k26.webp","gift":"https://minhlongonline.com/wp-content/uploads/2026/11/01654020803.webp","pot":"https://minhlongonline.com/wp-content/uploads/sapo-migrated/0-3-sen-vang.webp","home":"https://minhlongonline.com/wp-content/uploads/sapo-migrated/chen-com-11-2.webp"};
function icon(name){return '<img src="'+photos[name]+'" alt="" width="48" height="48" loading="lazy" decoding="async">';}
function lookup(ids){return ids.map(function(id){return source.querySelector('.menu-item-'+id+' > a');}).filter(Boolean);}
var groups=[
['Bữa cơm gia đình','Bộ đồ ăn, chén, dĩa, tô và muỗng sứ','bag',[27929,27933,27928,27931,27934,27936,27942]],
['Thưởng trà • Cà phê','Bộ trà, bình trà, ca và ly sứ','pot',[27927,27941,27938,27932,27943]],
['Nấu ăn dưỡng sinh','Nồi sứ Healthycook, Luna và Vesta','box',[]],
['Trang trí nhà cửa','Bình hoa và tượng linh vật','care',[27930,27935]],
['Nhà hàng • Khách sạn','Chén, dĩa, tô và tách LY’S','home',[27937,27939,27940,27943]],
['Quà tặng doanh nghiệp','Catalogue và quà tặng in logo','gift',[]]
];
function appendLinks(panel,links){links.forEach(function(old){var a=document.createElement('a');a.href=old.href;a.textContent=old.textContent.trim();panel.appendChild(a);});}
var records=[];
groups.forEach(function(g){var links=lookup(g[3]);if(g[2]==='gift')links=Array.from(document.querySelectorAll('#wide-nav .hide-for-medium .menu-item-28753 > a,#wide-nav .hide-for-medium .menu-item-27888 > a'));if(g[2]==='box'){var seen=new Set();links=Array.from(document.querySelectorAll('a[href*="/danh-muc/healthycook/"]')).filter(function(a){if(seen.has(a.href))return false;seen.add(a.href);return true;});if(!links.length){var healthy=document.createElement('a');healthy.href='/danh-muc/healthycook/';healthy.textContent='Xem sản phẩm Healthycook';links=[healthy];}}if(!links.length)return;
var d=document.createElement('details');d.className='lnl-need';var s=document.createElement('summary');s.innerHTML='<span class="lnl-need-icon">'+icon(g[2])+'</span><span class="lnl-need-caption"><strong></strong><small></small></span>';s.querySelector('strong').textContent=g[0];s.querySelector('small').textContent=g[1];d.appendChild(s);var list=document.createElement('div');list.className='lnl-need-links';appendLinks(list,links);d.appendChild(list);ui.appendChild(d);records.push({element:d,title:g[0]+' '+g[1],links:Array.from(list.querySelectorAll('a'))});d.addEventListener('toggle',function(){if(d.open&&!ui.querySelector('input[type=search]').value.trim())records.forEach(function(r){if(r.element!==d)r.element.open=false;});});
});
var empty=document.createElement('p');empty.className='lnl-needs-empty';empty.hidden=true;empty.textContent='Không có danh mục phù hợp. Bấm kính lúp hoặc Enter để tìm sản phẩm.';empty.setAttribute('role','status');ui.appendChild(empty);
var all=document.createElement('details');all.className='lnl-needs-all';var allTitle=document.createElement('summary');allTitle.textContent='Xem tất cả danh mục';all.appendChild(allTitle);var allList=document.createElement('div');allList.className='lnl-need-links';appendLinks(allList,originals);all.appendChild(allList);ui.appendChild(all);
function normalized(s){return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');}
function filterMenu(event){if(!event.target.matches('input[type=search]'))return;var q=normalized(event.target.value.trim()),count=0;records.forEach(function(r){var titleMatch=normalized(r.title).indexOf(q)>=0,found=false;r.links.forEach(function(a){var match=!q||titleMatch||normalized(a.textContent).indexOf(q)>=0;a.hidden=!match;if(match)found=true;});r.element.hidden=!found;r.element.open=!!q&&found;if(found)count++;});empty.hidden=!q||count>0;all.hidden=!!q;}
['input','change','search','keyup','focusout'].forEach(function(name){ui.addEventListener(name,filterMenu,true);});
var reset=document.createElement('button');reset.type='button';reset.className='lnl-needs-reset';reset.setAttribute('aria-label','Xóa tìm kiếm');reset.textContent='×';search.insertBefore(reset,search.querySelector('button[type=submit]'));reset.addEventListener('click',function(){var field=ui.querySelector('input[type=search]');field.value='';filterMenu({target:field});field.focus();});
sidebar.insertBefore(ui,source);root.classList.add('ml-desktop-needs','lnl-needs-ready');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();</script>
<?php
},110);
