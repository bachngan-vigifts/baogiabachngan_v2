<?php
/**
 * Plugin Name: Minh Long Complete Grouped Categories
 * Description: Populate grouped navigation from the complete product taxonomy.
 * Version: 1.0.0
 */
defined('ABSPATH') || exit;
function mlcm_category_group($term, $map) {
 $slugs=array($term->slug);$seen=array($term->term_id=>true);$parent=$term->parent;
 while($parent && isset($map[$parent]) && !isset($seen[$parent])){
  $seen[$parent]=true;$slugs[]=$map[$parent]->slug;$parent=$map[$parent]->parent;
 }
 if(in_array('healthycook',$slugs,true))return 2;
 if(in_array('lys',$slugs,true))return 4;
 if(preg_match('/binh-hoa|tuong|nen-thom|trang-suc/',$term->slug))return 3;
 if(preg_match('/tra-ca-phe|ca-su|ly-su|dia-lot-tach|bo-khay-ruou/',$term->slug))return 1;
 if(strpos($term->slug,'chai-hop')!==false)return 2;
 return 0;
}
function mlcm_category_rows() {
 $terms=get_terms(array('taxonomy'=>'product_cat','hide_empty'=>false));
 if(is_wp_error($terms))return array();
 $map=array();foreach($terms as $term)$map[$term->term_id]=$term;
 $rows=array();
 foreach($terms as $term){
  $url=get_term_link($term);if(is_wp_error($url))continue;
  $brand='';$parent=$term->parent;$seen=array();
  while($parent && isset($map[$parent]) && !isset($seen[$parent])){
   $seen[$parent]=true;$brand=$map[$parent]->name;$parent=$map[$parent]->parent;
  }
  $rows[]=array('id'=>(int)$term->term_id,'name'=>html_entity_decode($term->name,ENT_QUOTES,'UTF-8'),'parent'=>(int)$term->parent,'slug'=>$term->slug,'brand'=>$brand,'url'=>esc_url_raw($url),'group'=>mlcm_category_group($term,$map));
 }
 return $rows;
}
add_action('wp_footer',static function(){
 if(is_admin() || strtolower((string)wp_parse_url(home_url('/'),PHP_URL_HOST))!=='minhlongonline.com')return;
 $rows=mlcm_category_rows();if(!$rows)return;
 ?>
 <script id="mlcm-category-data" type="application/json"><?php echo wp_json_encode($rows,JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT); ?></script>
 <script id="mlcm-complete-menu" data-no-optimize="1" data-no-defer="1">(()=>{
 'use strict';
 const data=JSON.parse(document.getElementById('mlcm-category-data').textContent);
 const definitions=[
 ['Bữa cơm gia đình','Bộ đồ ăn, tô, dĩa, chén và phụ kiện bàn ăn'],
 ['Thưởng trà • Cà phê','Bộ trà, bình trà, ca, ly và phụ kiện'],
 ['Nấu ăn dưỡng sinh','Nồi, chai và hộp sứ dưỡng sinh'],
 ['Trang trí nhà cửa','Bình hoa, tượng, nến thơm và trang sức'],
 ['Nhà hàng • Khách sạn','Đầy đủ các danh mục LY’S'],
 ['Quà tặng doanh nghiệp','Catalogue và quà tặng in logo']
 ];
 const norm=s=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');
 const path=u=>new URL(u,location.origin).pathname.replace(/\/$/,'');
 function prefix(menu){return menu.classList.contains('mlcb-menu')?'mlcb-':'lnl-';}
 function filter(menu){
  const p=prefix(menu),field=menu.querySelector('input[type=search]');if(!field)return;
  const q=norm(field.value.trim());let found=0;
  menu.querySelectorAll('.'+p+'need').forEach(d=>{
   const title=norm(d.querySelector('summary').textContent),titleMatch=title.includes(q);
   const links=[...d.querySelectorAll('.'+p+'need-links a')];
   links.forEach(a=>a.hidden=!!q&&!titleMatch&&!norm(a.textContent).includes(q));
   d.hidden=!links.some(a=>!a.hidden);d.open=q?!d.hidden:!!d.querySelector('[aria-current=page]');
   if(!d.hidden)found++;
  });
  const all=menu.querySelector('.'+p+'needs-all');if(all){all.hidden=!!q;all.open=false;}
  const empty=menu.querySelector('.'+p+'needs-empty');if(empty)empty.hidden=!q||found>0;
 }
 function anchor(t,all=false){
  const a=document.createElement('a');a.href=t.url;a.dataset.mlcmTerm=String(t.id);
  a.textContent=!t.parent?'Tất cả '+t.name:t.name+(all&&t.brand?' · '+t.brand:'');
  if(path(a.href)===path(location.href))a.setAttribute('aria-current','page');
  return a;
 }
 function enrich(menu){
  if(menu.dataset.mlcmComplete==='1')return;
  const p=prefix(menu),groups=[...menu.querySelectorAll('.'+p+'need')];
  if(groups.length!==6)return;
  const rows=[...data].sort((a,b)=>Number(!!a.parent)-Number(!!b.parent)||a.name.localeCompare(b.name,'vi'));
  groups.forEach((d,i)=>{
   d.querySelector('strong').textContent=definitions[i][0];
   const small=d.querySelector('small');if(small)small.textContent=definitions[i][1];
   if(i===5)return; // Preserve the existing, verified corporate gifting destinations.
   const list=d.querySelector('.'+p+'need-links');
   list.replaceChildren(...rows.filter(t=>t.group===i).map(t=>anchor(t)));
  });
  const all=menu.querySelector('.'+p+'needs-all .'+p+'need-links');
  if(all)all.replaceChildren(...rows.map(t=>anchor(t,true)));
  menu.dataset.mlcmComplete='1';
  const field=menu.querySelector('input[type=search]');if(field)field.value='';
  filter(menu);
 }
 const selector='.lnl-needs-menu,.mlcb-menu';
 function scan(root){
  if(root.nodeType!==1)return;
  if(root.matches(selector))enrich(root);
  root.querySelectorAll(selector).forEach(enrich);
 }
 function init(){
  scan(document.body);
  // Mobile drawers can be inserted later. Only inspect newly added menu subtrees.
  new MutationObserver(records=>records.forEach(r=>r.addedNodes.forEach(scan))).observe(document.body,{childList:true,subtree:true});
 }
 // Legacy menu handlers retain the old hard-coded link list. Handle the refreshed
 // menus before those handlers, without affecting other search boxes or forms.
 ['input','change','search','keyup','focusout'].forEach(type=>window.addEventListener(type,e=>{
  if(!(e.target instanceof Element)||!e.target.matches('[data-mlcm-complete="1"] input[type=search]'))return;
  e.stopImmediatePropagation();filter(e.target.closest('[data-mlcm-complete="1"]'));
 },true));
 window.addEventListener('click',e=>{
  if(!(e.target instanceof Element))return;
  const button=e.target.closest('[data-mlcm-complete="1"] .lnl-needs-reset,[data-mlcm-complete="1"] .mlcb-needs-reset');
  if(!button)return;e.preventDefault();e.stopImmediatePropagation();
  const menu=button.closest('[data-mlcm-complete="1"]'),field=menu.querySelector('input[type=search]');
  field.value='';filter(menu);field.focus();
 },true);
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();</script>
 <?php
},900);
