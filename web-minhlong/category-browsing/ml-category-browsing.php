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
