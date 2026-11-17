<?php
/**
 * Plugin Name: Minh Long Preorder Purchase
 * Description: Tagged coming-soon products: extra 10%, no coupons on preorder lines, separate free delivery.
 * Version: 1.2.0
 */
defined('ABSPATH') || exit;
function mlpo_eligible($product) {
 if (!$product instanceof WC_Product) return false;
 $id=$product->get_parent_id() ?: $product->get_id();
 if (!has_term('sap-co-hang','product_tag',$id)) return false;
 return 'outofstock'===$product->get_stock_status('edit');
}
function mlpo_price($price,$product) {
 return mlpo_eligible($product) && ''!==$price ? wc_format_decimal((float)$price*0.9,wc_get_price_decimals()) : $price;
}
add_filter('woocommerce_product_get_price','mlpo_price',999999,2);
add_filter('woocommerce_product_variation_get_price','mlpo_price',999999,2);
add_filter('woocommerce_variation_prices_price','mlpo_price',999999,2);
add_filter('woocommerce_get_variation_prices_hash',function($hash){$hash['mlpo_policy']='v1';return $hash;},99);
add_filter('woocommerce_product_get_stock_status',function($status,$p){return mlpo_eligible($p)?'onbackorder':$status;},999999,2);
add_filter('woocommerce_product_variation_get_stock_status',function($status,$p){return mlpo_eligible($p)?'onbackorder':$status;},999999,2);
add_filter('woocommerce_product_is_in_stock',function($yes,$p){return mlpo_eligible($p)?true:$yes;},999999,2);
add_filter('woocommerce_product_backorders_allowed',function($yes,$id,$p){return mlpo_eligible($p)?true:$yes;},999999,3);
add_filter('woocommerce_product_backorders_require_notification',function($yes,$p){return mlpo_eligible($p)?true:$yes;},999999,2);
add_filter('woocommerce_product_is_on_backorder',function($yes,$id,$qty,$p){return mlpo_eligible($p)?true:$yes;},999999,4);
add_filter('woocommerce_get_availability',function($a,$p){
 if(mlpo_eligible($p)){$a['availability']='Đặt trước — shop liên hệ giao khi có hàng';$a['class']='available-on-backorder mlpo-stock';}
 return $a;
},999999,2);
add_filter('woocommerce_get_price_html',function($html,$p){
 if(!mlpo_eligible($p)||$p->is_type('variable'))return $html;
 $discounted=(float)$p->get_price();
 return '<del>'.wc_price(wc_get_price_to_display($p,array('price'=>$discounted/0.9))).'</del> <ins>'.wc_price(wc_get_price_to_display($p,array('price'=>$discounted))).'</ins><small class="mlpo-price-note">Giá đặt trước · Giảm thêm 10%</small>';
},999999,2);
function mlpo_notice(){
 global $product;
 if(!mlpo_eligible($product))return;
 echo '<div class="mlpo-notice" data-mlpo-product="'.esc_attr($product->get_id()).'"><strong>ĐẶT TRƯỚC · GIẢM THÊM 10% · FREESHIP</strong><p>Sản phẩm sắp có hàng. Shop sẽ liên hệ xác nhận thời gian giao khi hàng về.</p><small>Giá đặt trước đã giảm thêm 10%; không cộng voucher cho sản phẩm này. Miễn phí vận chuyển riêng hàng đặt trước, giao sau và tách với hàng có sẵn.</small></div>';
}
add_action('woocommerce_before_add_to_cart_form','mlpo_notice',5);
add_filter('woocommerce_product_single_add_to_cart_text',function($text,$p=null){if(!$p){global $product;$p=$product;}return mlpo_eligible($p)?'ĐẶT TRƯỚC':$text;},999999,2);
add_filter('woocommerce_product_add_to_cart_text',function($text,$p){return mlpo_eligible($p)?'ĐẶT TRƯỚC':$text;},999999,2);
add_filter('woocommerce_loop_add_to_cart_link',function($html,$p){if(mlpo_eligible($p))$html.='<small class="mlpo-loop-note" data-mlpo-product="'.esc_attr($p->get_id()).'">Đặt trước giảm thêm 10% · Freeship<br>Shop liên hệ giao khi có hàng</small>';return $html;},999999,2);
add_filter('woocommerce_get_item_data',function($data,$item){
 if(mlpo_eligible($item['data']))$data[]=array('key'=>'Đặt trước','value'=>'Đã giảm thêm 10% · Freeship riêng · Shop liên hệ giao khi có hàng');
 return $data;
},99,2);
add_filter('woocommerce_coupon_get_items_to_apply',function($items){
 return array_values(array_filter($items,function($item){return !mlpo_eligible($item->product);}));
},999999);
add_filter('woocommerce_coupon_is_valid_for_product',function($valid,$p){return mlpo_eligible($p)?false:$valid;},999999,2);
add_filter('woocommerce_coupon_get_discount_amount',function($discount,$amount,$item){return isset($item['data'])&&mlpo_eligible($item['data'])?0:$discount;},999999,3);
add_filter('woocommerce_coupon_is_valid',function($valid,$coupon){
 if(!WC()->cart)return $valid;
 $pre=false;$ready=0;
 foreach(WC()->cart->get_cart() as $line){if(mlpo_eligible($line['data']))$pre=true;else $ready+=(float)$line['data']->get_price()*$line['quantity'];}
 if($pre&&$ready<=0)throw new Exception('Hàng đặt trước đã được giảm thêm 10% và miễn phí vận chuyển, không áp dụng thêm voucher.');
 if($pre&&$ready<(float)$coupon->get_minimum_amount())throw new Exception('Giá trị hàng có sẵn chưa đạt mức tối thiểu của voucher. Hàng đặt trước không tính vào điều kiện voucher.');
 return $valid;
},999999,2);
function mlpo_packages($packages){
 $result=array();
 foreach($packages as $package){
  $ready=array();$pre=array();
  foreach($package['contents'] as $key=>$line){if(mlpo_eligible($line['data']))$pre[$key]=$line;else $ready[$key]=$line;}
  if(!$pre){$result[]=$package;continue;}
  foreach(array('ready'=>$ready,'preorder'=>$pre) as $kind=>$contents){
   if(!$contents)continue;
   $part=$package;$part['contents']=$contents;$part['contents_cost']=array_sum(array_column($contents,'line_total'));
   $part['cart_subtotal']=array_sum(array_column($contents,'line_subtotal'));$part['mlpo_kind']=$kind;
   if('preorder'===$kind){$part['ship_via']=array('ml_preorder_free');$part['applied_coupons']=array();}
   $result[]=$part;
  }
 }
 return $result;
}
add_filter('woocommerce_cart_shipping_packages','mlpo_packages',999999);
add_action('woocommerce_shipping_init',function(){
 if(class_exists('MLPO_Free_Shipping'))return;
 class MLPO_Free_Shipping extends WC_Shipping_Method{
  public function __construct(){ $this->id='ml_preorder_free';$this->method_title='Giao hàng đặt trước';$this->title='Đặt trước — miễn phí giao khi có hàng';$this->enabled='yes';$this->supports=array();}
  public function is_available($package){return isset($package['mlpo_kind'])&&'preorder'===$package['mlpo_kind'];}
  public function calculate_shipping($package=array()){$this->add_rate(array('id'=>$this->id,'label'=>$this->title,'cost'=>0,'taxes'=>false,'package'=>$package));}
 }
});
add_filter('woocommerce_shipping_methods',function($methods){$methods['ml_preorder_free']='MLPO_Free_Shipping';return $methods;});
add_filter('woocommerce_package_rates',function($rates,$package){
 if(isset($package['mlpo_kind'])&&'preorder'===$package['mlpo_kind'])
  return array('ml_preorder_free'=>new WC_Shipping_Rate('ml_preorder_free','Đặt trước — miễn phí giao khi có hàng',0,array(),'ml_preorder_free'));
 return $rates;
},999999,2);
add_filter('woocommerce_shipping_package_name',function($name,$i,$package){return isset($package['mlpo_kind'])?('preorder'===$package['mlpo_kind']?'Hàng đặt trước — giao sau':'Hàng có sẵn'):$name;},99,3);
add_filter('woocommerce_shipping_free_shipping_is_available',function($available,$package,$method){
 if(isset($package['mlpo_kind'])&&'ready'===$package['mlpo_kind']&&in_array($method->requires,array('min_amount','both','either'),true)&&$package['cart_subtotal']<(float)$method->min_amount){
  if('either'!==$method->requires)return false;
 }
 return $available;
},999999,3);
add_action('woocommerce_checkout_create_order_line_item',function($item,$key,$values,$order){
 if(!mlpo_eligible($values['data']))return;
 $item->add_meta_data('_ml_preorder','yes',true);
 $item->add_meta_data('Đặt trước','Giảm thêm 10%; miễn phí giao riêng khi có hàng; shop liên hệ xác nhận.',true);
 $item->set_name($item->get_name().' (Đặt trước)');
 $order->update_meta_data('_ml_has_preorder','yes');
},99,4);
add_action('woocommerce_checkout_create_order',function($order){
 if('yes'!==$order->get_meta('_ml_has_preorder'))return;
 $message='Hàng đặt trước: shop liên hệ giao khi có hàng; giao tách với hàng có sẵn. Đã giảm thêm 10%, không cộng voucher và miễn phí vận chuyển riêng hàng đặt trước.';
 $order->set_customer_note(trim($order->get_customer_note()."\n".$message));
},99);
add_action('wp_head',function(){?>
<style id="mlpo-style">
.mlpo-notice{padding:13px 15px;margin:12px 0;border:1px solid #dfc291;border-radius:9px;background:#fff9ee;color:#654a21;line-height:1.5}
.mlpo-notice strong{display:block;font-size:14px;color:#8b5916}.mlpo-notice p{margin:5px 0!important;font-size:13px}.mlpo-notice small{display:block;font-size:12px}
.mlpo-price-note,.mlpo-loop-note{display:block;font-size:11px;line-height:1.5;color:#906019;margin:5px 0}.mlpo-stock{color:#906019!important}
.mlpo-product .mlreq-v12-trigger,.mlpo-product .out-of-stock-label{display:none!important}
.mlpo-product .mlreq-v12-actions{display:block!important}.mlpo-product .mlreq-v12-actions>.add-to-cart-button{max-width:100%!important;width:100%!important}
body.mlpo-only-cart #ml-shipping-eta,body.mlpo-only-cart #lnl-shipping-eta{display:none!important}
.mlpo-checkout-note{margin:10px 0;padding:12px;border:1px solid #dfc291;background:#fff9ee;border-radius:8px;font-size:13px;color:#654a21}
.mlpo-badge-host{position:relative!important}
.mlpo-preorder-badge{position:absolute!important;top:12px!important;left:12px!important;z-index:15!important;display:inline-flex!important;align-items:center;justify-content:center;padding:8px 12px!important;border:2px solid #fff;border-radius:7px;background:#a44317;color:#fff!important;font-family:inherit;font-size:12px!important;font-weight:800!important;line-height:1.2!important;letter-spacing:.3px;box-shadow:0 3px 10px #75300c30;pointer-events:none!important;white-space:nowrap}
@media(max-width:549px){.product-small .mlpo-preorder-badge{top:8px!important;left:8px!important;font-size:10px!important;padding:6px 8px!important}}
</style>
<?php });
function mlpo_checkout_notice(){
 if(!WC()->cart)return;
 $pre=0;$ready=0;foreach(WC()->cart->get_cart() as $line){if(mlpo_eligible($line['data']))$pre++;else $ready++;}
 if(!$pre)return;
 echo '<div class="mlpo-checkout-note" data-mlpo-only="'.($ready?'0':'1').'"><strong>Đơn có hàng đặt trước</strong><br>Shop sẽ liên hệ giao hàng đặt trước khi hàng về. Phần hàng này đã giảm thêm 10%, không cộng voucher và được miễn phí vận chuyển riêng.'.($ready?' Hàng có sẵn được giao riêng theo thời gian và phí vận chuyển thông thường.':'').'</div>';
}
add_action('woocommerce_review_order_before_payment','mlpo_checkout_notice',5);
add_action('woocommerce_before_cart_totals','mlpo_checkout_notice',5);
add_action('wp_footer',function(){?>
<script id="mlpo-ui">
(function(){
function refresh(){
document.querySelectorAll('[data-mlpo-product]').forEach(function(n){
const wrap=n.closest('.product-small')||n.closest('.product');if(!wrap)return;wrap.classList.add('mlpo-product');
const scope=wrap.classList.contains('product-small')?wrap:(wrap.querySelector('.product-info')||wrap.querySelector('.summary')||wrap);
scope.classList.add('mlpo-purchase-scope');
const isCard=wrap.classList.contains('product-small');
const slider=wrap.querySelector('.product-gallery-slider');
const gallery=isCard?wrap.querySelector('.box-image'):(wrap.querySelector('.product-gallery')||wrap.querySelector('.woocommerce-product-gallery')||slider?.parentElement||wrap.querySelector('.product-images'));
if(gallery){
gallery.classList.add('mlpo-badge-host');
if(!gallery.querySelector(':scope > .mlpo-preorder-badge')){
const badge=document.createElement('span');badge.className='mlpo-preorder-badge';badge.textContent='ĐẶT TRƯỚC';badge.title='Hàng đặt trước — shop liên hệ giao khi có hàng';gallery.append(badge);
}
const saleRoot=isCard?(wrap.closest('.col-inner')||wrap):gallery;
saleRoot.querySelectorAll('.onsale,.badge-container').forEach(function(sale){sale.style.setProperty('display','none','important');});
}
scope.querySelectorAll('a,button').forEach(function(button){
const label=button.textContent.trim().replace(/\s+/g,' ').toLocaleUpperCase('vi');
if(button.matches('.ml-popup-buy-now,#buy_now_button,.ux-buy-now-button')||label==='MUA NGAY'||label==='ĐẶT TRƯỚC NGAY'){
button.style.setProperty('display','none','important');button.setAttribute('aria-hidden','true');button.tabIndex=-1;
}
});
scope.querySelectorAll('form.cart .single_add_to_cart_button').forEach(function(button){
button.classList.remove('ml-popup-cart-icon');button.classList.add('mlpo-order-button');
if(button.textContent.trim()!=='ĐẶT TRƯỚC')button.textContent='ĐẶT TRƯỚC';
button.setAttribute('aria-label','Đặt trước');button.title='Đặt trước';
button.style.setProperty('font-size','14px','important');button.style.setProperty('width','auto','important');button.style.setProperty('max-width','none','important');button.style.setProperty('min-width','140px','important');button.style.setProperty('grid-column','1 / -1','important');
});
});
document.body.classList.toggle('mlpo-only-cart',!!document.querySelector('[data-mlpo-only="1"]'));
}
let pending=false;new MutationObserver(function(){if(pending)return;pending=true;requestAnimationFrame(function(){pending=false;refresh();});}).observe(document.body,{childList:true,subtree:true});
refresh();
})();
</script>
<?php },120);
add_action('init',function(){
 if(get_option('mlpo_cache_version')==='3')return;
 do_action('litespeed_purge_all');update_option('mlpo_cache_version','3',false);
},30);
