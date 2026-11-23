<?php
defined('ABSPATH') || exit;
add_action('rest_api_init',function(){
register_rest_route('lnl-cache-check/v1','/refresh',array('methods'=>'POST','permission_callback'=>function($r){return hash_equals('__PROBE__',(string)$r->get_header('X-LNL-Shipping'));},'callback'=>function(){
$key=(string)get_option('litespeed.conf.cdn-cloudflare_key','');$email=(string)get_option('litespeed.conf.cdn-cloudflare_email','');$configured=(string)get_option('litespeed.conf.cdn-cloudflare_zone','');
if(!$key)return array('found'=>false);
$candidates=array(array('Authorization'=>'Bearer '.$key,'Content-Type'=>'application/json'));
if($email)array_unshift($candidates,array('X-Auth-Email'=>$email,'X-Auth-Key'=>$key,'Content-Type'=>'application/json'));
foreach($candidates as $headers){
$r=wp_remote_get('https://api.cloudflare.com/client/v4/zones?name=locknlockonline.com&per_page=50',array('headers'=>$headers,'timeout'=>15));
if(is_wp_error($r))continue;
$j=json_decode(wp_remote_retrieve_body($r),true);
foreach(($j['result']??array()) as $zone){
if(($zone['name']??'')!=='locknlockonline.com'||!preg_match('/^[a-f0-9]{32}$/i',$zone['id']??''))continue;
do_action('litespeed_purge_post',(int)get_option('page_on_front'));do_action('litespeed_purge_url',home_url('/'));
$rr=wp_remote_post('https://api.cloudflare.com/client/v4/zones/'.$zone['id'].'/purge_cache',array('headers'=>$headers,'timeout'=>15,'body'=>wp_json_encode(array('hosts'=>array('locknlockonline.com')))));
if(is_wp_error($rr))return array('found'=>true,'purged'=>false,'configured_zone_matches'=>$configured===$zone['id']);
$jj=json_decode(wp_remote_retrieve_body($rr),true);
return array('found'=>true,'purged'=>!empty($jj['success']),'configured_zone_matches'=>$configured===$zone['id']);
}
}
return array('found'=>false);
}));
});
