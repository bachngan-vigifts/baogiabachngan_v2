<?php
/**
 * Plugin Name: Lock Google Extended public content permission
 * Description: Authorize Google-Extended while retaining private and transactional exclusions.
 * Version: 1.0.0
 */
defined('ABSPATH') || exit;
add_filter('robots_txt', function ($output, $public) {
 if (!$public || strtolower((string) wp_parse_url(home_url('/'), PHP_URL_HOST)) !== 'locknlockonline.com') return $output;
 if (strpos($output, '# BEGIN LOCK GOOGLE EXTENDED PERMISSION') !== false) return $output;
 // Specific agent groups do not inherit wildcard rules: copy their path restrictions.
 $groups = array(); $agents = array(); $rules = array();
 foreach (preg_split('/\r?\n/', $output) as $line) {
  $line = trim(preg_replace('/#.*/', '', $line));
  if (!preg_match('/^([^:]+):\s*(.*)$/', $line, $m)) continue;
  $field = strtolower(trim($m[1])); $value = trim($m[2]);
  if ($field === 'user-agent') {
   if ($rules) { $groups[] = array($agents, $rules); $agents = array(); $rules = array(); }
   $agents[] = strtolower($value);
  } elseif (($field === 'allow' || $field === 'disallow') && $agents) {
   $rules[] = array($field, $value);
  }
 }
 if ($agents) $groups[] = array($agents, $rules);
 $copied = array();
 foreach ($groups as $group) {
  if (!in_array('*', $group[0], true)) continue;
  foreach ($group[1] as $rule) {
   // A globally private site must never become public through this exception.
   if ($rule[0] === 'disallow' && $rule[1] === '/') return $output;
   if ($rule[1] !== '') $copied[] = ucfirst($rule[0]) . ': ' . $rule[1];
  }
 }
 $private = array('/wp-admin/','/wp-login.php','/wp-json/','/cart/','/checkout/','/my-account/','/gio-hang/','/thanh-toan/','/tai-khoan/','/wishlist/','/*add-to-cart=','/*remove_item=','/*undo_item=','/*wc-ajax=','/*lnl_buy=','/*lno_buy_now=','/wp-content/uploads/wc-logs/','/wp-content/uploads/woocommerce_transient_files/','/wp-content/uploads/woocommerce_uploads/');
 $lines = array('Allow: /');
 foreach ($private as $path) $lines[] = 'Disallow: ' . $path;
 $lines = array_unique(array_merge($lines, $copied));
 return rtrim($output) . "\n\n# BEGIN LOCK GOOGLE EXTENDED PERMISSION\n# Owner permits Google-Extended grounding and training for public content only.\nUser-agent: Google-Extended\nContent-Signal: ai-input=yes,ai-train=yes,use=full\n" . implode("\n", $lines) . "\n# END LOCK GOOGLE EXTENDED PERMISSION\n";
}, PHP_INT_MAX, 2);
