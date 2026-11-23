<?php
defined('ABSPATH') || exit;
add_action('rest_api_init',function(){
 register_rest_route('ml-mobile-fix/v1','/refresh',array(
 'methods'=>'POST',
 'permission_callback'=>function($r){return time()<__EXPIRES__ && hash_equals('__TOKEN__',(string)$r->get_header('X-ML-Mobile'));},
 'callback'=>function(){
  if(strtolower((string)wp_parse_url(home_url('/'),PHP_URL_HOST))!=='minhlongonline.com')return new WP_Error('host','Wrong host',array('status'=>403));
  do_action('litespeed_purge_all');
  return array('local'=>true);
 }
 ));
});
