<?php
$guard = null; $priority = null;
function add_action($hook, $callback, $order = 10) {
    global $guard, $priority;
    if ($hook !== 'init') throw new Exception('Wrong lifecycle hook');
    $guard=$callback; $priority=$order;
}
require __DIR__.'/lnl-cart-single-add.php';
if($priority !== -100 || !is_callable($guard)) throw new Exception('Hook not registered early');
function check_case($label,$method,$query,$post,$strip) {
    global $guard;
    $_SERVER['REQUEST_METHOD']=$method; $_GET=$query; $_POST=$post; $_REQUEST=array_merge($query,$post);
    $before=[$_GET,$_POST,$_REQUEST]; $guard();
    if($strip){
       if(isset($_REQUEST['add-to-cart']) || isset($_POST['add-to-cart']) || isset($_GET['add-to-cart'])) throw new Exception($label.': native trigger remains');
       foreach(['product_id','variation_id','quantity','attribute_pa_mau-sac'] as $key) if(isset($post[$key]) && $_POST[$key]!==$post[$key])throw new Exception($label.': cart data altered');
       $guard(); // Repeated invocation is safe.
    } 
    if(!$strip && $before!==[$_GET,$_POST,$_REQUEST]) throw new Exception($label.': unrelated request changed');
    echo "PASS ".$label."\n";
}
$post=['product_id'=>'3165','variation_id'=>'14882','quantity'=>'1','attribute_pa_mau-sac'=>'be','add-to-cart'=>'3165'];
check_case('variable AJAX strips native trigger','POST',['wc-ajax'=>'lnl_add_to_cart'],$post,true);
$post['quantity']='3';
check_case('quantity three is preserved','POST',['wc-ajax'=>'lnl_add_to_cart'],$post,true);
check_case('simple AJAX','POST',['wc-ajax'=>'lnl_add_to_cart'],['product_id'=>'42','quantity'=>'2','add-to-cart'=>'42'],true);
check_case('Buy Now native POST unchanged','POST',[],array_merge($post,['ux-buy-now'=>'3165']),false);
check_case('native add to cart unchanged','POST',[],$post,false);
check_case('standard Woo AJAX unchanged','POST',['wc-ajax'=>'add_to_cart'],$post,false);
check_case('GET add link unchanged','GET',['wc-ajax'=>'lnl_add_to_cart','add-to-cart'=>'3165'],$post,false);
check_case('unrelated checkout AJAX unchanged','POST',['wc-ajax'=>'update_order_review'],$post,false);
check_case('malformed route unchanged','POST',['wc-ajax'=>['lnl_add_to_cart']],$post,false);
check_case('missing product id unchanged','POST',['wc-ajax'=>'lnl_add_to_cart'],['add-to-cart'=>'3165'],false);
check_case('array product id unchanged','POST',['wc-ajax'=>'lnl_add_to_cart'],['product_id'=>['3165'],'add-to-cart'=>'3165'],false);
check_case('invalid product id unchanged','POST',['wc-ajax'=>'lnl_add_to_cart'],['product_id'=>'0','add-to-cart'=>'3165'],false);
