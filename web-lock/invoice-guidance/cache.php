<?php
defined('ABSPATH') || exit;
add_action('rest_api_init', function () {
register_rest_route('store-invoice-cache/v1', '/refresh', array(
'methods' => 'POST',
'permission_callback' => function ($r) { return hash_equals('__TOKEN__', (string) $r->get_header('X-Invoice-Token')); },
'callback' => function () {
do_action('litespeed_purge_all');
$key = (string) get_option('litespeed.conf.cdn-cloudflare_key', '');
$email = (string) get_option('litespeed.conf.cdn-cloudflare_email', '');
if (!$key) return array('local'=>true, 'cdn'=>'not_configured');
$choices = array(array('Authorization'=>'Bearer '.$key, 'Content-Type'=>'application/json'));
if ($email) array_unshift($choices, array('X-Auth-Email'=>$email,'X-Auth-Key'=>$key,'Content-Type'=>'application/json'));
foreach ($choices as $headers) {
$r=wp_remote_get('https://api.cloudflare.com/client/v4/zones?name=__HOST__&per_page=50',array('headers'=>$headers,'timeout'=>15));
if(is_wp_error($r))continue;
$j=json_decode(wp_remote_retrieve_body($r),true);
foreach(($j['result']??array()) as $zone){
if(($zone['name']??'')!=='__HOST__'||!preg_match('/^[a-f0-9]{32}$/i',$zone['id']??''))continue;
$r=wp_remote_post('https://api.cloudflare.com/client/v4/zones/'.$zone['id'].'/purge_cache',array('headers'=>$headers,'timeout'=>15,'body'=>wp_json_encode(array('hosts'=>array('__HOST__')))));
$j=is_wp_error($r)?array():json_decode(wp_remote_retrieve_body($r),true);
return array('local'=>true,'cdn'=>!empty($j['success']));
}}
return array('local'=>true,'cdn'=>false);
}));
});
