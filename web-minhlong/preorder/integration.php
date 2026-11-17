<?php
function check_pre($ok,$message){if(!$ok)throw new Exception($message);echo "PASS ".$message."\n";}
update_option('woocommerce_currency','VND');update_option('woocommerce_price_num_decimals',0);update_option('woocommerce_enable_coupons','yes');
update_option('woocommerce_shipping_cost_requires_address','no');
$term=term_exists('sap-co-hang','product_tag');if(!$term)$term=wp_insert_term('Sắp có hàng','product_tag',array('slug'=>'sap-co-hang'));
function product_pre($price,$stock,$tag=false){
 $p=new WC_Product_Simple();$p->set_name('Fixture '.uniqid());$p->set_status('publish');$p->set_regular_price($price);$p->set_price($price);$p->set_stock_status($stock);$p->save();
 if($tag)wp_set_object_terms($p->get_id(),'sap-co-hang','product_tag');
 return wc_get_product($p->get_id());
}
$pre=product_pre(988200,'outofstock',true);$ready=product_pre(487944,'instock');$oos=product_pre(100000,'outofstock');$tagReady=product_pre(988200,'instock',true);
check_pre((float)$pre->get_price()===889380.0,'preorder price extra ten percent');
check_pre((float)$pre->get_price()===889380.0&&(float)$pre->get_price('edit')===988200.0,'repeated pricing never compounds');
check_pre($pre->is_in_stock()&&$pre->backorders_allowed()&&$pre->is_on_backorder(1),'preorder purchase enabled without changing inventory');
check_pre(!$oos->is_in_stock(),'untagged out of stock remains unavailable');
check_pre((float)$tagReady->get_price()===988200.0&&!mlpo_eligible($tagReady),'in stock tagged product unchanged');
$variable=new WC_Product_Variable();$variable->set_name('Variable preorder fixture');$variable->set_status('publish');$variable->save();wp_set_object_terms($variable->get_id(),'sap-co-hang','product_tag');
$v=new WC_Product_Variation();$v->set_parent_id($variable->get_id());$v->set_regular_price(100000);$v->set_price(100000);$v->set_status('publish');$v->set_stock_status('outofstock');$v->save();
$v=wc_get_product($v->get_id());check_pre(mlpo_eligible($v)&&(float)$v->get_price()===90000.0&&$v->is_in_stock(),'variation inherits parent preorder tag');
$zone=new WC_Shipping_Zone(0);$flat=$zone->add_shipping_method('flat_rate');update_option('woocommerce_flat_rate_'.$flat.'_settings',array('title'=>'Ready delivery','tax_status'=>'none','cost'=>'33000'));
$free=$zone->add_shipping_method('free_shipping');update_option('woocommerce_free_shipping_'.$free.'_settings',array('title'=>'Ready free threshold','requires'=>'min_amount','min_amount'=>'1000000','ignore_discounts'=>'no'));
WC()->initialize_session();WC()->initialize_cart();
WC()->customer->set_shipping_country('VN');WC()->customer->set_shipping_city('Ho Chi Minh');WC()->customer->set_shipping_address('Fixture address');
$cart=WC()->cart;$cart->add_to_cart($pre->get_id(),2);$cart->calculate_totals();
check_pre((float)$cart->get_subtotal()===1778760.0,'quantity two discounted subtotal');
$packs=WC()->shipping()->get_packages();check_pre(count($packs)===1&&isset($packs[0]['rates']['ml_preorder_free'])&&(float)$cart->get_shipping_total()===0.0,'preorder only free shipping');
$c=new WC_Coupon();$c->set_code('fixture10k');$c->set_discount_type('fixed_cart');$c->set_amount(10000);$c->set_minimum_amount(499000);$c->save();
check_pre(!$cart->apply_coupon('fixture10k'),'voucher rejected for preorder only');
wc_clear_notices();$cart->empty_cart();$prekey=$cart->add_to_cart($pre->get_id(),1);$readykey=$cart->add_to_cart($ready->get_id(),1);$cart->calculate_totals();
check_pre(!$cart->apply_coupon('fixture10k'),'preorder does not satisfy voucher minimum for ready goods');
wc_clear_notices();$cart->set_quantity($readykey,2);$cart->calculate_totals();check_pre($cart->apply_coupon('fixture10k'),'voucher can apply to eligible ready goods');$cart->calculate_totals();
$lines=$cart->get_cart();check_pre((float)$lines[$prekey]['line_total']===889380.0,'fixed cart coupon never discounts preorder');
check_pre((float)$lines[$readykey]['line_total']===965888.0,'voucher discounts ready lines only');
$packs=WC()->shipping()->get_packages();check_pre(count($packs)===2,'mixed order separates shipping packages');
foreach($packs as $pack){
 if($pack['mlpo_kind']==='preorder'){check_pre(count($pack['rates'])===1&&isset($pack['rates']['ml_preorder_free']),'preorder delivery is only free deferred rate');}
 else{check_pre(!array_filter($pack['rates'],function($rate){return $rate->get_method_id()==='free_shipping';}),'preorder value cannot grant free shipping to ready goods');}
}
$ship=array_values(array_filter($packs,function($x){return $x['mlpo_kind']==='ready';}))[0];check_pre((float)reset($ship['rates'])->get_cost()===33000.0,'ready shipping charge preserved');
$order=new WC_Order();$item=new WC_Order_Item_Product();$item->set_name('Fixture preorder');do_action('woocommerce_checkout_create_order_line_item',$item,$prekey,$lines[$prekey],$order);do_action('woocommerce_checkout_create_order',$order,array());
check_pre($item->get_meta('_ml_preorder')==='yes'&&$order->get_meta('_ml_has_preorder')==='yes'&&strpos($order->get_customer_note(),'liên hệ')!==false,'preorder persists to order item and customer note');
$pre->set_stock_status('instock');$pre->save();$restocked=wc_get_product($pre->get_id());check_pre(!mlpo_eligible($restocked)&&(float)$restocked->get_price()===988200.0,'restocked product exits preorder automatically');
echo "PREORDER_ISOLATED_INTEGRATION_PASS\n";
