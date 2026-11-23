<?php
/**
 * Plugin Name: Minh Long Category Browsing
 * Description: Newest-first figurines with unavailable products last.
 * Version: 1.0.0
 */
defined('ABSPATH') || exit;

function mlcb_is_figurine_archive() {
 return !is_admin() && strtolower((string)wp_parse_url(home_url('/'), PHP_URL_HOST)) === 'minhlongonline.com'
  && function_exists('is_product_category') && is_product_category('tuong-linh-vat-minh-long');
}
function mlcb_explicit_order() {
 // Read-only catalog preference; no mutation or nonce is required.
 return isset($_GET['orderby']) && is_string($_GET['orderby']) ? sanitize_key(wp_unslash($_GET['orderby'])) : '';
}
add_filter('woocommerce_default_catalog_orderby', static function ($order) {
 return mlcb_is_figurine_archive() ? 'date' : $order;
}, 1000000);
add_filter('woocommerce_get_catalog_ordering_args', static function ($args) {
 if (mlcb_is_figurine_archive() && '' === mlcb_explicit_order()) {
  // Override the older sitewide price default only for this archive.
  $args['orderby'] = 'date';
  $args['order'] = 'DESC';
  $args['meta_key'] = '';
 }
 return $args;
}, 1000000);

add_filter('posts_clauses', static function ($clauses, $query) {
 if (!mlcb_is_figurine_archive() || !$query->is_main_query() || !$query->is_tax('product_cat', 'tuong-linh-vat-minh-long')) return $clauses;
 global $wpdb;
 $alias = 'mlcb_stock_lookup';
 if (false === strpos($clauses['join'], $alias)) {
  $clauses['join'] .= " LEFT JOIN {$wpdb->prefix}wc_product_meta_lookup AS {$alias} ON {$wpdb->posts}.ID = {$alias}.product_id ";
 }
 $out = $wpdb->prepare("{$alias}.stock_status = %s", 'outofstock');
 // The installed preorder plugin treats tagged out-of-stock items as purchasable backorders.
 if (function_exists('mlpo_eligible')) {
  $tag = get_term_by('slug', 'sap-co-hang', 'product_tag');
  if ($tag && !is_wp_error($tag)) {
   $out .= $wpdb->prepare(" AND NOT EXISTS (SELECT 1 FROM {$wpdb->term_relationships} AS mlcb_preorder WHERE mlcb_preorder.object_id = {$wpdb->posts}.ID AND mlcb_preorder.term_taxonomy_id = %d)", (int)$tag->term_taxonomy_id);
  }
 }
 $order = mlcb_explicit_order();
 $tail = in_array($order, array('', 'date'), true) ? "{$wpdb->posts}.post_date DESC" : $clauses['orderby'];
 if (!$tail) $tail = "{$wpdb->posts}.post_date DESC";
 $clauses['orderby'] = "CASE WHEN ({$out}) THEN 1 ELSE 0 END ASC, {$tail}, {$wpdb->posts}.ID DESC";
 return $clauses;
}, 1000000, 2);

add_action('wp_footer', static function () {
 if (!mlcb_is_figurine_archive()) return;
 ?>
 <script id="mlcb-figurine-order">
 (function(){
  function sync(){
   const order=new URLSearchParams(location.search).get('orderby')||'date';
   document.querySelectorAll('.quick-sort-block input[data-orderby]').forEach(input=>{input.checked=input.dataset.orderby===order;});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',sync,{once:true});else sync();
 })();
 </script>
 <?php
}, 1001);

add_action('wp_footer', static function () {
 if (is_admin() || strtolower((string)wp_parse_url(home_url('/'), PHP_URL_HOST)) !== 'minhlongonline.com' || !function_exists('is_shop') || !(is_shop() || is_product_taxonomy())) return;
 ?>
 <style id="mlcb-sidebar-css">.mlcb-sidebar>.product-categories{display:none!important}
.mlcb-sidebar .mlcb-menu{padding:10px;border:1px solid #d5e5f4;border-radius:10px;background:linear-gradient(#fff,#f1f8fe);color:#245b88}
.mlcb-sidebar .lnl-needs-search{display:flex;gap:0;margin:0 0 12px;height:40px}
.mlcb-sidebar .lnl-needs-search input[type=search]{flex:1;min-width:0;height:40px;margin:0;padding:0 8px;border:1px solid #bed9ee;border-right:0;border-radius:8px 0 0 8px;box-shadow:none;font-size:12px}
.mlcb-sidebar .lnl-needs-search button{display:flex;align-items:center;justify-content:center;position:static;transform:none;flex:0 0 34px;min-width:0;width:34px;height:40px;min-height:40px;margin:0;padding:0;border:1px solid #bed9ee;border-left:0;border-radius:0 8px 8px 0;background:#fff;color:#245b88;line-height:1}
.mlcb-sidebar .lnl-needs-search .lnl-needs-reset{flex-basis:24px;width:24px;border-radius:0;border-right:0;font-size:20px}
.mlcb-sidebar .lnl-needs-search svg{width:18px;height:18px}
.mlcb-sidebar .lnl-need{margin:0 0 8px;border:1px solid #cde3f5;border-radius:10px;background:#fff;overflow:hidden}
.mlcb-sidebar .lnl-need>summary{display:flex;align-items:center;gap:8px;min-height:62px;padding:9px 8px;list-style:none;cursor:pointer}
.mlcb-sidebar summary::-webkit-details-marker{display:none}
.mlcb-sidebar .lnl-need-icon{flex:0 0 38px;width:38px;height:38px;overflow:hidden}
.mlcb-sidebar .lnl-need-icon img{display:block;width:38px;height:38px;object-fit:contain}
.mlcb-sidebar .lnl-need-caption{flex:1;min-width:0}
.mlcb-sidebar .lnl-need-caption strong{display:block;font-size:13px;line-height:1.35;color:#245b88}
.mlcb-sidebar .lnl-need-caption small{display:block;font-size:11px;line-height:1.4;margin-top:3px;color:#567088}
.mlcb-sidebar .lnl-need>summary:after{content:'›';font-size:19px;margin-left:auto}
.mlcb-sidebar .lnl-need[open]>summary{background:#eef6ff}
.mlcb-sidebar .lnl-need[open]>summary:after{transform:rotate(90deg)}
.mlcb-sidebar .lnl-need-links{border-top:1px solid #e5eef7;padding:4px 6px}
.mlcb-sidebar .lnl-need-links a{display:block;padding:10px 8px;min-height:40px;white-space:normal;font-size:13px;line-height:1.4;color:#245b88;border-radius:6px}
.mlcb-sidebar .lnl-need-links a:hover,.mlcb-sidebar .lnl-need-links a[aria-current=page]{background:#e7f1ff;font-weight:700}
.mlcb-sidebar .lnl-needs-all{border:1px solid #bed9ee;border-radius:8px;background:#fff}
.mlcb-sidebar .lnl-needs-all>summary{list-style:none;padding:11px 6px;text-align:center;cursor:pointer;font-size:13px;font-weight:700}
.mlcb-sidebar .lnl-needs-all>summary:after{content:' ＋'}
.mlcb-sidebar .lnl-needs-all[open]>summary:after{content:' −'}
.mlcb-sidebar .lnl-needs-empty{font-size:12px;line-height:1.5}
.mlcb-sidebar [hidden]{display:none!important}
.mlcb-sidebar summary:focus-visible,.mlcb-sidebar a:focus-visible{outline:2px solid #468ac2;outline-offset:-2px}
</style>
 <script id="mlcb-sidebar-js" data-no-optimize="1" data-no-defer="1">(()=>{
 function init(){
  const source=document.querySelector('.header-vertical-menu__fly-out .lnl-needs-menu');
  if(!source||!source.querySelector('.lnl-need'))return;
  document.querySelectorAll('.widget_product_categories').forEach(widget=>{
   const original=widget.querySelector('ul.product-categories');
   if(!original||widget.querySelector('.mlcb-menu'))return;
   const menu=source.cloneNode(true);menu.classList.add('mlcb-menu');
   menu.querySelector('h2')?.remove();
   menu.querySelectorAll('[id]').forEach(e=>e.removeAttribute('id'));
   const field=menu.querySelector('input[type=search]');
   const all=menu.querySelector('.lnl-needs-all'),empty=menu.querySelector('.lnl-needs-empty');
   const groups=[...menu.querySelectorAll('.lnl-need')];
   const normalize=s=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');
   const path=u=>new URL(u,location.origin).pathname.replace(/\/$/,'');
   function markCurrent(){
    menu.querySelectorAll('a[href]').forEach(a=>{if(path(a.href)===path(location.href))a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
   }
   function reset(){
    field.value='';menu.querySelectorAll('[hidden]').forEach(e=>e.hidden=false);
    if(empty)empty.hidden=true;
    menu.querySelectorAll('details').forEach(d=>d.open=false);
    groups.forEach(d=>{d.open=!!d.querySelector('a[aria-current=page]');});
   }
   function filter(){
    const q=normalize(field.value.trim());if(!q){reset();return;}
    let found=0;
    groups.forEach(d=>{
     const title=normalize(d.querySelector('summary').textContent),titleMatch=title.includes(q);
     const links=[...d.querySelectorAll('.lnl-need-links a')];
     links.forEach(a=>a.hidden=!titleMatch&&!normalize(a.textContent).includes(q));
     d.hidden=!links.some(a=>!a.hidden);d.open=!d.hidden;if(!d.hidden)found++;
    });
    if(all)all.hidden=true;if(empty)empty.hidden=found>0;
   }
   markCurrent();reset();
   field.addEventListener('input',filter);field.addEventListener('search',filter);
   menu.querySelector('.lnl-needs-reset')?.addEventListener('click',()=>{reset();field.focus();});
   groups.forEach(d=>d.addEventListener('toggle',()=>{if(d.open&&!field.value.trim())groups.forEach(other=>{if(other!==d)other.open=false;});}));
   widget.classList.add('mlcb-sidebar');original.hidden=true;original.before(menu);
  });
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();</script>
 <?php
}, 1002);
