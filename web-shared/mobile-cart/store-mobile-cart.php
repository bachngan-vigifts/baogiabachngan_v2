<?php
/**
 * Plugin Name: Store Mobile Cart Option 3
 * Description: Compact mobile cart cards and synchronized sticky checkout; preserves WooCommerce pricing and actions.
 * Version: 1.2.1
 */
defined('ABSPATH') || exit;
add_filter('woocommerce_cart_item_class', function($classes,$item){
 if(function_exists('mlpo_eligible') && isset($item['data']) && mlpo_eligible($item['data'])) $classes.=' bnmc-preorder';
 return $classes;
},100,2);
add_action('wp_head',function(){
 if(!function_exists('is_cart') || !is_cart()) return;
?>
<style id="bnmc-style">
#bnmc-bar,#bnmc-top{display:none}
@media(max-width:549px){
body.woocommerce-cart #header,body.woocommerce-cart #footer,body.woocommerce-cart .footer-wrapper,body.woocommerce-cart .absolute-footer,
body.woocommerce-cart .page-title,body.woocommerce-cart .woocommerce-breadcrumb,body.woocommerce-cart .continue-shopping,
body.woocommerce-cart .fixed-contact,body.woocommerce-cart #top-link,body.woocommerce-cart #claw-ai-launcher,body.woocommerce-cart #claw-ai-panel,
body.woocommerce-cart #lnl-chat-launch,body.woocommerce-cart #lnl-chat-dialog,body.woocommerce-cart .header-wrapper,
body.woocommerce-cart .cart-footer-content,body.woocommerce-cart .section_breadcrumb,body.woocommerce-cart #breadcrumbs{display:none!important}
body.woocommerce-cart .woocommerce-notices-wrapper:empty{display:none!important;outline:0!important;border:0!important}
body.woocommerce-cart .woocommerce:focus,body.woocommerce-cart .woocommerce-notices-wrapper:focus{outline:none!important}
body.woocommerce-cart #wrapper{padding-top:0!important;margin-top:0!important;background:#f3f6f9!important}
body.woocommerce-cart #main{padding-top:0!important;margin-top:0!important;min-height:75vh}
body.woocommerce-cart #main>.container,body.woocommerce-cart #main .page-wrapper>.container{padding:0!important;max-width:100%!important}
body.woocommerce-cart #bnmc-top{display:block;max-width:549px;margin:0 auto;padding:14px 14px 6px;background:#f3f6f9}
#bnmc-top a{display:inline-flex;align-items:center;min-height:44px;padding:8px 13px;border:1px solid #cfdae7;background:#fff;color:#143e69;border-radius:8px;font-size:14px;font-weight:600;line-height:1.4;text-decoration:none}
body.woocommerce-cart .cart_item .product-remove{right:8px!important;top:8px!important;left:auto!important;transform:none!important}
body.woocommerce-cart .cart_item .product-name{padding-right:22px!important}
body.woocommerce-cart .cart_item .product-remove a{position:static!important;transform:none!important}

body.woocommerce-cart{--bnmc-blue:#143e69;--bnmc-line:#e0e8ef;padding-bottom:calc(100px + env(safe-area-inset-bottom))!important}
body.woocommerce-cart #main{background:#f3f6f9!important}
body.woocommerce-cart .page-wrapper{padding:12px 0 24px!important}
body.woocommerce-cart .woocommerce>.row{margin:0!important;background:transparent!important;border-radius:0!important}
body.woocommerce-cart .woocommerce>.row>.col{padding:0 12px 14px!important}
body.woocommerce-cart .cart-wrapper{overflow:visible!important}
body.woocommerce-cart table.woocommerce-cart-form__contents,body.woocommerce-cart table.woocommerce-cart-form__contents>tbody{display:block!important;width:100%!important;margin:0!important}
body.woocommerce-cart table.woocommerce-cart-form__contents>thead{display:none!important}
body.woocommerce-cart .cart_item{position:relative!important;display:grid!important;grid-template-columns:88px minmax(0,1fr)!important;gap:8px 12px!important;background:#fff!important;border:1px solid var(--bnmc-line)!important;border-radius:14px!important;padding:14px!important;margin:0 0 12px!important;box-shadow:0 3px 12px #173b6510}
body.woocommerce-cart .cart_item>td{display:block!important;width:auto!important;min-width:0!important;padding:0!important;margin:0!important;border:0!important;background:transparent!important;text-align:left!important}
body.woocommerce-cart .cart_item>td:before{display:none!important}
body.woocommerce-cart .cart_item .product-thumbnail{grid-column:1;grid-row:1 / span 3}
body.woocommerce-cart .cart_item .product-thumbnail img{display:block!important;width:88px!important;height:100px!important;object-fit:contain!important;border-radius:9px;background:#f8fafc}
body.woocommerce-cart .cart_item .product-name{grid-column:2;grid-row:1;padding-right:20px!important;font-size:14px!important;line-height:1.45!important}
body.woocommerce-cart .cart_item .product-name>a{font-weight:650;color:var(--bnmc-blue)}
body.woocommerce-cart .cart_item .product-price{display:none!important}
body.woocommerce-cart .cart_item .mobile-product-price{display:block!important;margin-top:7px;font-size:15px!important}
body.woocommerce-cart .cart_item .mobile-product-price__qty{display:none!important}
body.woocommerce-cart .cart_item .mobile-product-price del{font-size:11px;opacity:.55}
body.woocommerce-cart .cart_item .mobile-product-price ins{text-decoration:none;font-weight:750;color:var(--bnmc-blue)}
body.woocommerce-cart .cart_item .product-remove{position:absolute!important;right:8px;top:10px;z-index:1}
body.woocommerce-cart .cart_item .product-remove a{border:0!important;color:#677789!important;width:28px!important;height:28px!important;font-size:23px!important;line-height:26px!important}
body.woocommerce-cart .cart_item .product-quantity{grid-column:2;grid-row:2}
body.woocommerce-cart .cart_item .quantity{margin:0!important;display:inline-flex!important;height:36px;float:none!important}
body.woocommerce-cart .cart_item .quantity input{height:36px!important;min-height:36px!important;min-width:34px!important;max-width:44px!important;padding:0!important;margin:0!important;border:1px solid #d6e0ea!important;background:#fff!important;box-shadow:none!important;color:var(--bnmc-blue)!important;font-size:15px!important}
body.woocommerce-cart .cart_item .product-subtotal{grid-column:2;grid-row:3;font-size:13px!important}
body.woocommerce-cart .cart_item .product-subtotal:before{display:inline!important;content:'Thành tiền: ';font-size:11px;color:#738295;float:none!important}
body.woocommerce-cart .cart_item .awdr-you-saved-text{font-size:11px!important;line-height:1.4!important}
body.woocommerce-cart .cart_item dl.variation{font-size:12px!important;margin:5px 0!important}
body.woocommerce-cart .bnmc-preorder .product-name:before{content:'ĐẶT TRƯỚC';display:table!important;background:#fff0dd;color:#a74b09;font-weight:750;font-size:10px;border-radius:5px;padding:3px 7px;margin-bottom:5px}
body.woocommerce-cart .cart_item .backorder_notification{font-size:12px!important;color:#a74b09!important}
body.woocommerce-cart .woocommerce-cart-form__contents>tbody>tr:not(.cart_item){display:block!important}
body.woocommerce-cart .woocommerce-cart-form__contents .actions,body.woocommerce-cart .freeship-notice-simple{display:block!important;width:100%!important;padding:10px 0!important}
body.woocommerce-cart.bnmc-has-voucher .actions .coupon{display:none!important}
body.woocommerce-cart .cart_totals{display:flex!important;flex-direction:column!important;background:#fff;border:1px solid var(--bnmc-line);padding:14px!important;border-radius:14px!important}
body.woocommerce-cart .cart_totals>table:first-child{display:none!important}
body.woocommerce-cart .cart_totals>h2{display:block!important;font-size:16px!important;margin:5px 0 12px!important;color:var(--bnmc-blue)}
body.woocommerce-cart .cart_totals>.shop_table{margin-bottom:12px!important;font-size:13px!important}
body.woocommerce-cart .cart_totals th,body.woocommerce-cart .cart_totals td{font-size:13px!important}
body.woocommerce-cart .cart_totals .order-total .amount{font-size:19px!important;color:var(--bnmc-blue)}
body.woocommerce-cart .wc-proceed-to-checkout{display:contents!important}
body.woocommerce-cart.bnmc-ready .wc-proceed-to-checkout>.checkout-button{display:none!important}
body.woocommerce-cart .lnl-voucher-shop-wrap.context-cart{order:-2!important;display:block!important;margin:0 0 15px!important}
body.woocommerce-cart .lnl-voucher-shop-row{display:flex!important;align-items:center!important;padding:12px!important;background:#f8fbff!important;border:1px solid #dce7f2!important;border-radius:10px!important;min-height:56px!important}
body.woocommerce-cart .lnl-voucher-shop-copy strong{font-size:14px!important;color:var(--bnmc-blue)!important}
body.woocommerce-cart .lnl-voucher-shop-copy small{font-size:11px!important}
body.woocommerce-cart .lnl-voucher-shop-action{font-size:12px!important;white-space:nowrap!important;color:var(--bnmc-blue)!important}
body.woocommerce-cart .lnl-voucher-shop-icon{background:var(--bnmc-blue)!important}
body.woocommerce-cart .lnl-voucher-modal{z-index:100100!important}
body.woocommerce-cart .lnl-voucher-modal-panel{position:fixed!important;top:auto!important;bottom:0!important;left:0!important;right:0!important;transform:none!important;width:100%!important;max-width:none!important;max-height:85dvh!important;overflow:auto!important;border-radius:18px 18px 0 0!important;padding-bottom:calc(18px + env(safe-area-inset-bottom))!important}
body.woocommerce-cart .vigifts-reward-points-box{order:3;font-size:12px!important;padding:10px!important;margin-top:10px!important}
body.woocommerce-cart [class*="invoice-request--cart"]{order:2;margin:4px 0!important;font-size:13px!important}
body.woocommerce-cart.bnmc-ready #bnmc-bar:not([hidden]){position:fixed;display:flex;align-items:center;justify-content:space-between;gap:12px;bottom:0;left:0;right:0;z-index:9990;background:#fff;border-top:1px solid #dce4ed;box-shadow:0 -5px 20px #143e6910;padding:12px 16px calc(12px + env(safe-area-inset-bottom));margin:0}
#bnmc-bar small{display:block;font-size:11px;color:#697b8d;line-height:1.4}
#bnmc-total{display:block;font-size:20px;font-weight:800;color:var(--bnmc-blue);line-height:1.3;white-space:nowrap}
#bnmc-buy{border:0;border-radius:9px;background:var(--bnmc-blue);color:white;margin:0;padding:12px 17px;min-height:46px;font-size:14px;line-height:1.3;letter-spacing:0;text-transform:none}
#bnmc-buy:disabled{opacity:.55;cursor:wait}
#bnmc-status{max-width:185px}
body.woocommerce-cart.bnmc-ready .fixed-contact{bottom:100px!important}
body.woocommerce-cart.bnmc-ready #top-link{bottom:155px!important}
body.woocommerce-cart.bnmc-modal #bnmc-bar{visibility:hidden}
}
@media(max-width:359px){
body.woocommerce-cart .cart_item{grid-template-columns:70px minmax(0,1fr)!important;padding:10px!important;gap:7px 9px!important}
body.woocommerce-cart .cart_item .product-thumbnail img{width:70px!important;height:88px!important}
#bnmc-total{font-size:18px}#bnmc-buy{padding:11px;font-size:13px}
}

.bnmc-summary{display:contents}
.bnmc-summary-title{display:none}
@media(max-width:549px){
body.woocommerce-cart{background:#f3f6f9!important}
body.woocommerce-cart #bnmc-top{max-width:549px;padding:12px 12px 10px!important}
body.woocommerce-cart #main .cart-container.container.page-wrapper{width:100%!important;max-width:549px!important;padding:0 12px 18px!important;margin:0 auto!important}
body.woocommerce-cart .cart-container .woocommerce,
body.woocommerce-cart .cart-container .woocommerce>.row,
body.woocommerce-cart .cart-container .woocommerce>.row>.col,
body.woocommerce-cart .cart-sidebar,body.woocommerce-cart .cart-sidebar>.col-inner,
body.woocommerce-cart .woocommerce-cart-form,body.woocommerce-cart .cart-wrapper{
padding:0!important;margin:0!important;border:0!important;outline:0!important;box-shadow:none!important;background:transparent!important;width:100%!important;max-width:100%!important
}
body.woocommerce-cart .woocommerce>.row{display:flex!important;flex-direction:column!important;gap:12px!important}
body.woocommerce-cart .woocommerce>.row>.col{flex-basis:auto!important}
body.woocommerce-cart .cart-container,body.woocommerce-cart .woocommerce-notices-wrapper{outline:0!important;box-shadow:none!important}
body.woocommerce-cart .cart_item{margin:0 0 10px!important;padding:12px!important;border-radius:12px!important;gap:6px 10px!important;box-shadow:0 2px 6px #173b6507!important}
body.woocommerce-cart .cart_item .product-name{font-size:14px!important;line-height:1.4!important}
body.woocommerce-cart .cart_item .product-name>a{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
body.woocommerce-cart .cart_item .product-subtotal{font-size:12px!important;line-height:1.4!important}
body.woocommerce-cart .cart_item .product-subtotal br{display:none}
body.woocommerce-cart .cart_item .product-subtotal .awdr-you-saved-text{display:none!important}
body.woocommerce-cart .bnmc-preorder .backorder_notification{display:none!important}
body.woocommerce-cart .bnmc-preorder dl.variation{font-size:11px!important;line-height:1.35!important}
body.woocommerce-cart .freeship-notice-simple{font-size:12px!important;padding:0 4px 8px!important;text-align:left!important;border:0!important}
body.woocommerce-cart.bnmc-has-voucher .woocommerce-cart-form__contents>tbody>tr:has(>.actions){display:none!important}
body.woocommerce-cart .cart_totals{display:flex!important;flex-direction:column!important;gap:12px!important;padding:0!important;margin:0!important;border:0!important;background:transparent!important;box-shadow:none!important;border-radius:0!important}
body.woocommerce-cart .cart_totals .bnmc-summary{display:block!important;order:1;background:white;border:1px solid #e0e8ef;border-radius:12px;padding:14px!important;margin:0!important}
body.woocommerce-cart .bnmc-summary>h2,body.woocommerce-cart .bnmc-summary>table:not(.shop_table){display:none!important}
body.woocommerce-cart .bnmc-summary-title{display:block;font-size:16px;font-weight:750;color:#143e69;line-height:1.4;margin:0 0 10px}
body.woocommerce-cart .bnmc-summary>.shop_table{margin:0!important}
body.woocommerce-cart .bnmc-summary .shop_table th,body.woocommerce-cart .bnmc-summary .shop_table td{padding:10px 0!important;font-size:13px!important;border-color:#edf0f4!important}
body.woocommerce-cart .bnmc-summary [class*="invoice-request--cart"]{margin:10px 0 0!important;padding:10px 0 0!important;border:0!important;border-top:1px solid #e0e8ef!important;background:transparent!important;box-shadow:none!important;border-radius:0!important}
body.woocommerce-cart .lnl-voucher-shop-wrap.context-cart{order:0!important;margin:0!important;padding:0!important;width:100%!important}
body.woocommerce-cart .lnl-voucher-shop-row{background:white!important;border:1px solid #e0e8ef!important;border-radius:12px!important;margin:0!important;min-height:60px!important;padding:11px 12px!important;gap:9px!important;width:100%!important}
body.woocommerce-cart .lnl-voucher-shop-copy{text-transform:none!important;letter-spacing:0!important;flex:1;min-width:0}
body.woocommerce-cart .lnl-voucher-shop-copy strong{text-transform:none!important;font-size:14px!important;line-height:1.4!important}
body.woocommerce-cart .lnl-voucher-shop-copy small{text-transform:none!important;font-size:11px!important;line-height:1.3!important}
body.woocommerce-cart .lnl-voucher-shop-action{text-transform:none!important}
body.woocommerce-cart .mlpo-checkout-note{order:3!important;font-size:11px!important;line-height:1.5!important;margin:0!important;padding:10px 12px!important;border-radius:10px!important}
body.woocommerce-cart .vigifts-reward-points-box{order:4!important;margin:0!important}
body.woocommerce-cart .bnmc-summary .order-total .amount{font-size:17px!important}
}

@media(max-width:549px){
body.woocommerce-cart .bnmc-summary .shipping__table th:after,body.woocommerce-cart .bnmc-summary .shipping__table th:before{content:none!important}
body.woocommerce-cart .bnmc-summary .shipping__table{margin:0!important}
body.woocommerce-cart .bnmc-summary .shipping__table th,body.woocommerce-cart .bnmc-summary .shipping__table td{padding:5px 0!important;vertical-align:top!important}
body.woocommerce-cart .bnmc-summary .woocommerce-shipping-destination,body.woocommerce-cart .bnmc-summary .woocommerce-shipping-contents{display:none!important}
body.woocommerce-cart .bnmc-summary .shipping__list{margin:0!important}
body.woocommerce-cart .bnmc-summary .shipping__list_item{margin:0!important;line-height:1.4!important}
}
</style>
<?php
},999);
add_action('wp_footer',function(){
 if(!function_exists('is_cart') || !is_cart()) return;
?>
<nav id="bnmc-top" aria-label="Trở lại mua hàng"><a href="<?php echo esc_url(wc_get_page_permalink('shop')); ?>">← Trở lại mua hàng</a></nav>
<div id="bnmc-bar" hidden aria-label="Thanh toán giỏ hàng">
 <div><small>Tổng thanh toán</small><strong id="bnmc-total"></strong><small id="bnmc-status" role="status"></small></div>
 <button id="bnmc-buy" type="button">Thanh toán →</button>
</div>
<script id="bnmc-script">
(function(){
'use strict';
const top=document.getElementById('bnmc-top');if(top)document.body.insertBefore(top,document.body.firstChild);
const bar=document.getElementById('bnmc-bar'),buy=document.getElementById('bnmc-buy'),total=document.getElementById('bnmc-total'),status=document.getElementById('bnmc-status');
let saved=new Map(),timer=0;
function fields(){return Array.from(document.querySelectorAll('.woocommerce-cart-form input.qty'));}
function snapshot(){saved=new Map(fields().map(e=>[e.name,e.value]));}
function dirty(){return fields().some(e=>saved.get(e.name)!==e.value);}
function arrange(){
 const totals=document.querySelector('.cart_totals');if(!totals)return;
 if(!totals.querySelector(':scope > .bnmc-summary')){
 const summary=document.createElement('div');summary.className='bnmc-summary';
 const title=document.createElement('h3');title.className='bnmc-summary-title';title.textContent='Chi tiết thanh toán';summary.append(title);
 Array.from(totals.children).filter(e=>e.matches('table,h2,[class*="invoice-request--cart"]')).forEach(e=>summary.append(e));
 totals.append(summary);
 }
 const note=document.querySelector('.mlpo-checkout-note');
 if(note&&note.parentElement!==totals)totals.append(note);
 totals.querySelectorAll('.shipping__table th').forEach(e=>{if(e.textContent.trim()==='Shipment')e.textContent='Vận chuyển';});
 const label=totals.querySelector('.lnl-voucher-shop-copy strong');
 if(label&&label.textContent!=='Voucher Shop')label.textContent='Voucher Shop';
}
function sync(){
 arrange();
 const form=document.querySelector('.woocommerce-cart-form'),link=document.querySelector('.wc-proceed-to-checkout a.checkout-button'),amount=document.querySelector('.cart_totals .order-total .amount');
 const ok=!!(form&&link&&amount&&fields().length);
 bar.hidden=!ok;document.body.classList.toggle('bnmc-ready',ok);
 if(!ok)return;
 const busy=!!document.querySelector('.woocommerce-cart-form.processing,.cart_totals.processing,.woocommerce-cart-form .blockUI,.cart_totals .blockUI');
 const changed=dirty();
 const value=amount.textContent.trim();if(total.textContent!==value)total.textContent=value;
 const msg=busy?'Đang cập nhật…':changed?'Cần cập nhật số lượng':'Đã gồm phí giao hàng hiển thị';
 if(status.textContent!==msg)status.textContent=msg;
 buy.disabled=busy;buy.textContent=changed&&!busy?'Cập nhật giỏ':'Thanh toán →';
 document.body.classList.toggle('bnmc-has-voucher',!!document.querySelector('.lnl-voucher-shop-wrap.context-cart'));
 const modal=document.querySelector('.lnl-voucher-modal[aria-hidden="false"]');
 document.body.classList.toggle('bnmc-modal',!!modal);
}
function schedule(){clearTimeout(timer);timer=setTimeout(sync,60);}
buy.addEventListener('click',function(){
 sync();if(buy.disabled)return;
 if(dirty()){
 const button=document.querySelector('.woocommerce-cart-form [name="update_cart"]');
 if(button){button.disabled=false;button.click();schedule();}return;
 }
 const link=document.querySelector('.wc-proceed-to-checkout a.checkout-button');
 if(link)link.click();
});
document.addEventListener('input',schedule);
document.addEventListener('change',schedule);
document.addEventListener('click',schedule);
snapshot();sync();
if(window.jQuery)jQuery(document.body).on('updated_wc_div.bnmc updated_cart_totals.bnmc wc_cart_emptied.bnmc applied_coupon.bnmc removed_coupon.bnmc',function(e){
 if(e.type==='updated_wc_div')snapshot();schedule();
});
const observer=new MutationObserver(function(records){
 if(records.some(r=>!bar.contains(r.target)))schedule();
});
observer.observe(document.querySelector('#main')||document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','aria-hidden']});
window.addEventListener('resize',schedule);
})();
</script>
<?php
},999);
