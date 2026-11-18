<?php
define('ABSPATH', __DIR__);
$hooks=[];$host='locknlockonline.com';$orders=[];$sent=0;
function home_url($p){global $host;return 'https://'.$host.$p;}
function add_filter($h,$c,$p=10,$a=1){global $hooks;$hooks[$h][]=$c;}
function add_action($h,$c,$p=10,$a=1){add_filter($h,$c,$p,$a);}
function wc_get_order($id){global $orders;return $orders[$id]??false;}
function apply_test($h,$value,...$args){global $hooks;foreach($hooks[$h]??[] as $c)$value=$c($value,...$args);return $value;}
function action_test($h,...$args){global $hooks;foreach($hooks[$h]??[] as $c)$c(...$args);}
class WC_Order{
 public $method='sepay',$status='on-hold',$paid=null,$meta=[];
 function get_payment_method(){return $this->method;}
 function is_paid(){return in_array($this->status,['processing','completed']);}
 function get_date_paid(){return $this->paid;}
 function get_meta($k){return $this->meta[$k]??'';}
 function update_meta_data($k,$v){$this->meta[$k]=$v;}
 function save_meta_data(){}
}
class Email {
 function trigger($id,$order){
  global $sent;
  if($order->get_meta('_new_order_email_sent')==='true')return;
  if(apply_test('woocommerce_email_enabled_new_order',true,$order)){
   $sent++;$order->update_meta_data('_new_order_email_sent','true');
  }
 }
}
function WC(){return new class{
 function mailer(){return $this;}
 function get_emails(){return ['WC_Email_New_Order'=>new Email];}
};}
class Hook {
 public $resource='order',$url='https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff/integrations/woocommerce/lock/order?token=not-a-real-token';
 function get_resource(){return $this->resource;}
 function get_delivery_url(){return $this->url;}
}
function check($v,$m){if(!$v)throw new Exception($m);echo "PASS $m\n";}
require __DIR__.'/lock-sepay-paid-notifications.php';
$o=new WC_Order;$orders[21825]=$o;$w=new Hook;
check(!apply_test('woocommerce_email_enabled_new_order',true,$o),'unpaid SePay does not notify new order');
check(!apply_test('woocommerce_email_enabled_customer_on_hold_order',true,$o),'unpaid customer confirmation suppressed');
check(!apply_test('woocommerce_webhook_should_deliver',true,$w,21825),'unpaid SePay not sent to CRM');
lnl_png_notify_paid(21825,$o);check($sent===0,'unpaid cannot release email');
$o->status='processing';$o->paid='server-paid-date';
action_test('woocommerce_order_status_changed',21825,'on-hold','processing',$o);
action_test('woocommerce_order_status_on-hold_to_processing_notification',21825,$o);
action_test('woocommerce_order_status_on-hold_to_processing_notification',21825,$o);
check($sent===1,'paid transition notifies once');
check(apply_test('woocommerce_webhook_should_deliver',true,$w,21825),'paid update reaches CRM');
check(!apply_test('woocommerce_webhook_should_deliver',false,$w,21825),'does not override disabled webhook');
$o->status='refunded';$o->paid=null;
check(apply_test('woocommerce_webhook_should_deliver',true,$w,21825),'later refund remains synchronized');
$cod=new WC_Order;$cod->method='cod';$orders[2]=$cod;
check(apply_test('woocommerce_email_enabled_new_order',true,$cod),'COD email unchanged');
check(apply_test('woocommerce_webhook_should_deliver',true,$w,2),'COD CRM unchanged');
check(!apply_test('woocommerce_email_enabled_new_order',false,$cod),'disabled email remains disabled');
$host='minhlongonline.com';$unpaid=new WC_Order;$orders[3]=$unpaid;
check(apply_test('woocommerce_email_enabled_new_order',true,$unpaid),'Minh Long email unchanged');
check(apply_test('woocommerce_webhook_should_deliver',true,$w,3),'Minh Long CRM unchanged');
$host='locknlockonline.com';$other=new Hook;$other->url='https://other.example/order';
check(apply_test('woocommerce_webhook_should_deliver',true,$other,3),'unrelated webhook unchanged');
echo "PAYMENT_NOTIFICATION_GATE_TESTS_OK\n";
