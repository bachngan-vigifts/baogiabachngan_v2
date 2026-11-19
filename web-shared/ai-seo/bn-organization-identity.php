<?php
/**
 * Plugin Name: Bach Ngan organization schema identity
 * Description: Align the existing Rank Math organization with visible Minh Long store identity.
 * Version: 1.0.0
 */
defined('ABSPATH') || exit;
add_filter('rank_math/json_ld', function ($data) {
 if (strtolower((string) wp_parse_url(home_url('/'), PHP_URL_HOST)) !== 'minhlongonline.com' || !is_array($data)) return $data;
 foreach ($data as &$node) {
  if (!is_array($node) || ($node['@id'] ?? '') !== 'https://minhlongonline.com/#organization') continue;
  $node['legalName'] = 'CÔNG TY TNHH SX TM BÁCH NGÂN';
  $node['taxID'] = '1801686576';
  $node['address'] = array(
   '@type' => 'PostalAddress',
   'streetAddress' => '102B đường 3/2, Phường Tân An',
   'addressLocality' => 'Cần Thơ',
   'addressCountry' => 'VN'
  );
 }
 unset($node);
 return $data;
}, 99);
