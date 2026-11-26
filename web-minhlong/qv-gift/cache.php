<?php
defined('ABSPATH') || exit;
add_action('rest_api_init',function(){
 register_rest_route('ml-qv-gift/v1','/refresh',array(
  'methods'=>'POST',
  'permission_callback'=>function($r){return time()<__EXPIRES__ && hash_equals('__TOKEN__',(string)$r->get_header('X-ML-POS'));},
  'callback'=>function(){
   $host=strtolower((string)wp_parse_url(home_url('/'),PHP_URL_HOST));
   if(!in_array($host,array('minhlongonline.com'),true))return new WP_Error('wrong_host','Host mismatch',array('status'=>403));
   do_action('litespeed_purge_all');
   $key=(string)get_option('litespeed.conf.cdn-cloudflare_key','');
   $email=(string)get_option('litespeed.conf.cdn-cloudflare_email','');
   if(!$key)return array('local'=>true,'cloudflare'=>'not-configured');
   $headersList=array(array('Authorization'=>'Bearer '.$key,'Content-Type'=>'application/json'));
   if($email)array_unshift($headersList,array('X-Auth-Email'=>$email,'X-Auth-Key'=>$key,'Content-Type'=>'application/json'));
   foreach($headersList as $headers){
    $r=wp_remote_get('https://api.cloudflare.com/client/v4/zones?name='.rawurlencode($host),array('headers'=>$headers,'timeout'=>15));
    if(is_wp_error($r))continue;
    $j=json_decode(wp_remote_retrieve_body($r),true);
    foreach(($j['result']??array()) as $zone){
     if(($zone['name']??'')!==$host||!preg_match('/^[a-f0-9]{32}$/i',$zone['id']??''))continue;
     $rr=wp_remote_post('https://api.cloudflare.com/client/v4/zones/'.$zone['id'].'/purge_cache',array('headers'=>$headers,'timeout'=>15,'body'=>wp_json_encode(array('hosts'=>array($host)))));
     if(is_wp_error($rr))return array('local'=>true,'cloudflare'=>false);
     $jj=json_decode(wp_remote_retrieve_body($rr),true);
     return array('local'=>true,'cloudflare'=>!empty($jj['success']));
    }
   }
   return array('local'=>true,'cloudflare'=>false);
  }
 ));
});
