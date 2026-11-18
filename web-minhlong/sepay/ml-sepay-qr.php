<?php
/**
 * Plugin Name: Minh Long SePay QR Gate
 * Description: ACB QR checkout with server-side SePay verification and delayed CRM/email release.
 * Version: 1.0.0
 */
defined('ABSPATH') || exit;

function ml_sepay_cfg() {
    static $cfg;
    if (isset($cfg)) return $cfg;
    $path = WP_CONTENT_DIR . '/.ml-sepay-config.php';
    $cfg = is_readable($path) ? require $path : array();
    return is_array($cfg) ? $cfg : array();
}
function ml_sepay_enabled() { $c=ml_sepay_cfg(); return !empty($c['enabled']) && !empty($c['webhook_key']); }
function ml_sepay_proof($order) { return $order instanceof WC_Order && (string)$order->get_meta('_ml_sepay_verified_tx') !== ''; }
function ml_sepay_transfer_code($id) { return 'ML' . absint($id); }
function ml_sepay_is_qr_order($order) { return $order instanceof WC_Order && (string)$order->get_meta('_ml_sepay_version')==='1' && in_array($order->get_payment_method(),array('bacs','ml_sepay_qr'),true); }

// Preserve the existing Minh Long bank-transfer choice and enroll only new orders.
add_action('woocommerce_checkout_create_order',function($order,$data){
    if(ml_sepay_enabled() && $order instanceof WC_Order && ($data['payment_method']??'')==='bacs'){
        $order->update_meta_data('_ml_sepay_version','1');
        $order->update_meta_data('_ml_sepay_code',ml_sepay_transfer_code($order->get_id()));
    }
},5,2);
add_action('woocommerce_checkout_order_processed',function($order_id,$data,$order){
    if(!ml_sepay_enabled() || !$order instanceof WC_Order || $order->get_payment_method()!=='bacs')return;
    $order->update_meta_data('_ml_sepay_version','1');$order->update_meta_data('_ml_sepay_code',ml_sepay_transfer_code($order_id));
    if(!$order->has_status('on-hold'))$order->set_status('on-hold');$order->save();
},5,3);

add_filter('woocommerce_payment_gateways', function($g){ $g[]='ML_SePay_QR_Gateway'; return $g; });
add_action('plugins_loaded', function(){
    if (!class_exists('WC_Payment_Gateway')) return;
    class ML_SePay_QR_Gateway extends WC_Payment_Gateway {
        public function __construct(){
            $this->id='ml_sepay_qr'; $this->method_title='Minh Long - Chuyển khoản QR SePay';
            $this->title='Chuyển khoản ngân hàng (Quét mã QR)';
            $this->description='Quét QR ACB để thanh toán. Đơn chỉ được xác nhận sau khi ngân hàng báo tiền vào.';
            $this->has_fields=false; $this->enabled=ml_sepay_enabled()?'yes':'no';
        }
        public function is_available(){ return ml_sepay_enabled() && parent::is_available(); }
        public function process_payment($order_id){
            $order=wc_get_order($order_id); if(!$order) return array('result'=>'failure');
            $order->update_meta_data('_ml_sepay_version','1');
            $order->update_meta_data('_ml_sepay_code',ml_sepay_transfer_code($order_id));
            $order->update_status('on-hold','Đang chờ SePay xác nhận tiền vào ACB 579268.');
            $order->save();
            WC()->cart->empty_cart();
            return array('result'=>'success','redirect'=>$this->get_return_url($order));
        }
    }
}, 20);

add_filter('woocommerce_webhook_should_deliver', function($ok,$hook,$arg){
    if(!$ok || !is_object($hook) || $hook->get_resource()!=='order') return $ok;
    $order=wc_get_order(is_object($arg)&&method_exists($arg,'get_id')?$arg->get_id():absint($arg));
    if(!ml_sepay_is_qr_order($order)) return $ok;
    $released=(bool)$order->get_meta('_ml_sepay_crm_released');
    return ml_sepay_proof($order) && ($released || doing_action('ml_sepay_release_crm')) ? $ok : false;
}, 999, 3);
add_filter('woocommerce_email_enabled_new_order', 'ml_sepay_email_gate', 999, 3);
add_filter('woocommerce_email_enabled_customer_on_hold_order', 'ml_sepay_email_gate', 999, 3);
add_filter('woocommerce_email_enabled_customer_processing_order', 'ml_sepay_email_gate', 999, 3);
add_filter('woocommerce_email_enabled_customer_completed_order', 'ml_sepay_email_gate', 999, 3);
function ml_sepay_email_gate($enabled,$order){ return ml_sepay_is_qr_order($order)&&!ml_sepay_proof($order)?false:$enabled; }

function ml_sepay_qr_url($order){
    $c=ml_sepay_cfg(); $amount=(int)round((float)$order->get_total()); $code=ml_sepay_transfer_code($order->get_id());
    return add_query_arg(array('accountName'=>$c['account_name']??'','amount'=>$amount,'addInfo'=>$code), 'https://img.vietqr.io/image/ACB-579268-compact2.png');
}
function ml_sepay_thankyou($order_id){
    $o=wc_get_order($order_id); if(!$o || !ml_sepay_is_qr_order($o)) return;
    echo '<style>.vigifts-bank-box{display:none!important}</style>';
    if(ml_sepay_proof($o)){ echo '<div class="woocommerce-message">Thanh toán thành công. Đơn hàng đã được ghi nhận.</div>'; return; }
    echo '<section class="ml-sepay" style="text-align:center;max-width:560px;margin:24px auto"><h2>Chờ thanh toán</h2><p>Quét QR đúng số tiền và giữ nguyên nội dung chuyển khoản.</p><img alt="QR thanh toán ACB" style="width:min(92vw,360px);height:auto" src="'.esc_url(ml_sepay_qr_url($o)).'"><p><strong>ACB 579268</strong><br>'.esc_html(ml_sepay_cfg()['account_name']??'').'<br>Số tiền: <strong>'.wp_kses_post(wc_price($o->get_total())).'</strong><br>Nội dung: <strong>'.esc_html(ml_sepay_transfer_code($o->get_id())).'</strong></p><p id="ml-sepay-state">Đang chờ ngân hàng xác nhận…</p></section>';
    $url=rest_url('ml-sepay/v1/status/'.$o->get_id()); $key=$o->get_order_key();
    echo '<script>(function(){let n=0,t=setInterval(async()=>{if(++n>120)return clearInterval(t);try{let r=await fetch('.wp_json_encode(add_query_arg('key',$key,$url)).',{credentials:"same-origin"}),j=await r.json();if(j.paid){clearInterval(t);document.getElementById("ml-sepay-state").textContent="Thanh toán thành công";location.reload();}}catch(e){}},5000)})();</script>';
}
add_action('woocommerce_thankyou_ml_sepay_qr','ml_sepay_thankyou',20);
add_action('woocommerce_thankyou_bacs','ml_sepay_thankyou',20);

add_action('rest_api_init', function(){
    register_rest_route('ml-sepay/v1','/status/(?P<id>\d+)',array('methods'=>'GET','permission_callback'=>'__return_true','callback'=>function($r){
        $o=wc_get_order(absint($r['id'])); if(!$o || !hash_equals((string)$o->get_order_key(),(string)$r->get_param('key'))) return new WP_Error('not_found','Không tìm thấy đơn hàng',array('status'=>404));
        return array('paid'=>ml_sepay_proof($o),'status'=>$o->get_status());
    }));
    register_rest_route('ml-sepay/v1','/webhook',array('methods'=>'POST','permission_callback'=>'__return_true','callback'=>'ml_sepay_webhook'));
});
function ml_sepay_auth_ok($r){
    $c=ml_sepay_cfg(); $secret=(string)($c['webhook_key']??'');
    $signature=trim((string)$r->get_header('x-sepay-signature')); $timestamp=trim((string)$r->get_header('x-sepay-timestamp'));
    if($secret==='' || !ctype_digit($timestamp) || abs(time()-(int)$timestamp)>300 || !preg_match('/^sha256=[a-f0-9]{64}$/i',$signature)) return false;
    $expected='sha256='.hash_hmac('sha256',$timestamp.'.'.$r->get_body(),$secret);
    return hash_equals($expected,strtolower($signature));
}
function ml_sepay_review($reason,$data,$order=null){
    if($order instanceof WC_Order){$order->add_order_note('SePay cần đối soát: '.$reason);$order->update_meta_data('_ml_sepay_review',$reason);$order->save();}
    wc_get_logger()->warning($reason,array('source'=>'ml-sepay','transaction_id'=>sanitize_text_field((string)($data['id']??''))));
    return new WP_REST_Response(array('success'=>false,'review'=>$reason),202);
}
function ml_sepay_webhook($r){
    if(!ml_sepay_auth_ok($r)) return new WP_Error('unauthorized','Unauthorized',array('status'=>401));
    $d=$r->get_json_params(); if(!is_array($d)) return new WP_Error('bad_json','Invalid payload',array('status'=>400));
    if(strtolower((string)($d['transferType']??''))!=='in') return ml_sepay_review('not_incoming',$d);
    $account=preg_replace('/\D/','',(string)($d['accountNumber']??$d['subAccount']??''));
    if($account!=='579268' || strtoupper((string)($d['gateway']??''))!=='ACB') return ml_sepay_review('wrong_account',$d);
    $content=(string)($d['content']??$d['description']??'');
    if(!preg_match('/(?<![A-Z0-9])ML(\d+)(?![A-Z0-9])/i',$content,$m)) return ml_sepay_review('wrong_code',$d);
    $o=wc_get_order(absint($m[1])); if(!$o || !ml_sepay_is_qr_order($o) || (string)$o->get_meta('_ml_sepay_version')!=='1') return ml_sepay_review('ineligible_order',$d,$o);
    global $wpdb; $lock='ml_sepay_order_'.$o->get_id();
    if((int)$wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 10)',$lock))!==1) return ml_sepay_review('order_lock_timeout',$d,$o);
    try {
    $o=wc_get_order($o->get_id());
    if(in_array($o->get_status(),array('cancelled','refunded','failed'),true)) return ml_sepay_review('late_for_closed_order',$d,$o);
    $tx=sanitize_text_field((string)($d['id']??$d['transactionId']??$d['referenceCode']??'')); if($tx==='') return ml_sepay_review('missing_transaction_id',$d,$o);
    if(ml_sepay_proof($o)) return array('success'=>true,'duplicate'=>true);
    $amount=(float)($d['transferAmount']??$d['amount']??0);
    if(abs($amount-(float)$o->get_total())>0.0001) return ml_sepay_review($amount<(float)$o->get_total()?'underpaid':'overpaid',$d,$o);
    if(!add_option('ml_sepay_tx_'.md5($tx),$o->get_id(),'','no')) return ml_sepay_review('transaction_already_used',$d,$o);
    $o->update_meta_data('_ml_sepay_verified_tx',$tx); $o->update_meta_data('_ml_sepay_paid_at',current_time('mysql',true)); $o->delete_meta_data('_ml_sepay_review'); $o->save();
    $o->payment_complete($tx); $o->add_order_note('SePay xác nhận tiền vào ACB 579268; giao dịch '.$tx.'.');
    if(function_exists('as_enqueue_async_action')) as_enqueue_async_action('ml_sepay_release_crm',array($o->get_id()),'ml-sepay'); else wp_schedule_single_event(time()+2,'ml_sepay_release_crm',array($o->get_id()));
    return array('success'=>true,'order_id'=>$o->get_id());
    } finally { $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)',$lock)); }
}
add_action('ml_sepay_release_crm',function($id){
    $o=wc_get_order($id); if(!$o||!ml_sepay_proof($o))return;
    foreach(array(1,2) as $wid){$key='_ml_sepay_crm_webhook_'.$wid;if($o->get_meta($key))continue;$h=new WC_Webhook($wid);if(!$h->get_id()||$h->get_status()!=='active')throw new Exception('CRM webhook '.$wid.' is not active.');$res=$h->deliver($id);if(!is_wp_error($res)&&(int)wp_remote_retrieve_response_code($res)>=200&&(int)wp_remote_retrieve_response_code($res)<300){$o->update_meta_data($key,current_time('mysql',true));$o->save();}else{throw new Exception('CRM webhook '.$wid.' failed; Action Scheduler will retry.');}}
    $o->update_meta_data('_ml_sepay_crm_released',current_time('mysql',true));$o->save();
},10,1);
