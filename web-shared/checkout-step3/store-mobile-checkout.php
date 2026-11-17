<?php
/**
 * Plugin Name: Store mobile checkout option 3
 * Version: 1.0.0
 * Presentation only; WooCommerce remains the order and pricing authority.
 */
defined('ABSPATH') || exit;
function bnco_is_checkout() {
 return function_exists('is_checkout') && is_checkout() && !is_order_received_page() && !is_wc_endpoint_url('order-pay');
}
add_filter('woocommerce_cart_item_name', function($name,$item,$key) {
 if (!(bnco_is_checkout() || (defined('WOOCOMMERCE_CHECKOUT') && WOOCOMMERCE_CHECKOUT))) return $name;
 if (strpos($name,'bnco-product-thumb') !== false || empty($item['data'])) return $name;
 $product=$item['data'];
 $img=wp_get_attachment_image($product->get_image_id(),'woocommerce_thumbnail',false,array('class'=>'bnco-product-thumb','alt'=>'','loading'=>'lazy'));
 if (!$img && $product->get_parent_id()) $img=wp_get_attachment_image(get_post_thumbnail_id($product->get_parent_id()),'woocommerce_thumbnail',false,array('class'=>'bnco-product-thumb','alt'=>'','loading'=>'lazy'));
 $badge=function_exists('mlpo_eligible') && mlpo_eligible($product) ? '<span class="bnco-preorder">ĐẶT TRƯỚC · Giao khi có hàng</span>' : '';
 return $img.$name.$badge;
},999999,3);
add_action('wp_head',function(){
 if(!bnco_is_checkout())return;
?>
<style id="bnco-style">
#bnco-shell,#bnco-footer,.bnco-review-address,.bnco-review-eta,.bnco-product-thumb,.bnco-address-tip,.bnco-confirm-row{display:none}
@media(max-width:549px){
body.bnco-active{background:#f3f6fa!important;color:#182b40!important;padding-bottom:calc(100px + env(safe-area-inset-bottom))!important}
body.bnco-active #header,body.bnco-active #footer,body.bnco-active .footer-wrapper,body.bnco-active .absolute-footer,
body.bnco-active .section_breadcrumb,body.bnco-active .page-title,body.bnco-active #breadcrumbs,
body.bnco-active .fixed-contact,body.bnco-active #top-link,body.bnco-active #claw-ai-launcher,body.bnco-active #claw-ai-panel,body.bnco-active #lnl-chat-launch,body.bnco-active #lnl-chat-dialog{display:none!important}
body.bnco-active #wrapper,body.bnco-active #main{background:#f3f6fa!important;padding:0!important;margin:0!important}
body.bnco-active #main>.container,body.bnco-active #main .page-wrapper{max-width:549px!important;padding:0 12px!important;margin:0 auto!important}
body.bnco-active #main form.checkout{margin:0!important;width:100%!important}
body.bnco-active #main form.checkout>.row{display:block!important;margin:0!important;border:0!important;padding:0!important}
body.bnco-active #main form.checkout>.row>.col{display:contents!important}
body.bnco-active #main form.checkout .col-inner{padding:0!important;border:0!important;box-shadow:none!important;background:transparent!important}
body.bnco-active #customer_details{padding:0!important;margin:0!important;width:100%!important}
body.bnco-active #customer_details>.col,body.bnco-active #customer_details>.col-1,body.bnco-active #customer_details>.col-2{float:none!important;padding:0!important;width:100%!important;max-width:none!important}
body.bnco-active #bnco-shell{display:block;max-width:549px;margin:0 auto;padding:16px 16px 18px;background:#fff}
.bnco-head{display:flex;align-items:center;gap:12px;min-height:42px}
#bnco-back{display:inline-flex;align-items:center;justify-content:center;border:0;background:none;color:#143e69;font-size:25px;width:32px;height:40px;padding:0;margin:0;line-height:1}
#bnco-title{font-size:18px;font-weight:750;line-height:1.3;flex:1;color:#143e69;margin:0}
#bnco-logo{width:90px;max-height:38px;object-fit:contain}
.bnco-steps{display:flex;align-items:center;justify-content:center;gap:12px;margin:20px 0 0;font-size:14px}
.bnco-step{display:flex;align-items:center;gap:7px;color:#788696;white-space:nowrap}
.bnco-step b{display:flex;align-items:center;justify-content:center;border:1px solid #bac4ce;border-radius:50%;height:30px;width:30px;font-weight:700}
.bnco-step.active{color:#143e69;font-weight:700}
.bnco-step.active b,.bnco-step.done b{color:white;background:#143e69;border-color:#143e69}
.bnco-line{height:2px;background:#bd964e;width:48px}
body.bnco-active form.checkout{padding-top:12px!important}
body.bnco-step1 #order_review,body.bnco-step1 #order_review_heading,
body.bnco-step1 .bnco-review-address,body.bnco-step1 .bnco-review-eta,
body.bnco-step2 #customer_details,body.bnco-step2 .woocommerce-additional-fields{display:none!important}
body.bnco-active #order_review_heading{display:none!important}
body.bnco-active .woocommerce-billing-fields>h3,body.bnco-active .woocommerce-additional-fields>h3{display:none!important}
body.bnco-active .woocommerce-billing-fields{background:#fff;border:1px solid #dce4ec;border-radius:12px;padding:16px!important}
body.bnco-active .woocommerce-billing-fields__field-wrapper{display:flex!important;flex-direction:column!important;gap:14px!important}
body.bnco-active #customer_details .form-row{float:none!important;clear:both!important;width:100%!important;margin:0!important;padding:0!important}
body.bnco-active #customer_details .form-row label{font-size:14px!important;color:#202b36!important;font-weight:600!important;margin:0 0 6px!important;line-height:1.4!important}
body.bnco-active #customer_details .form-row input.input-text,body.bnco-active #customer_details .form-row select,body.bnco-active #customer_details .form-row textarea{border:1px solid #c9d3de!important;border-radius:7px!important;min-height:46px!important;background:#fff!important;box-shadow:none!important;padding:10px 12px!important;font-size:16px!important;line-height:1.5!important;margin:0!important;color:#223448!important}
body.bnco-active #customer_details .select2-container{width:100%!important}
body.bnco-active #customer_details .select2-selection--single{border:1px solid #b99555!important;border-radius:7px!important;min-height:46px!important;background:#fff!important}
body.bnco-active #customer_details .select2-selection__rendered{line-height:44px!important;padding-left:12px!important;font-size:16px!important}
body.bnco-active #customer_details .select2-selection__arrow{height:44px!important}
body.bnco-active #billing_first_name_field{order:1}
body.bnco-active #billing_last_name_field{order:2}
body.bnco-active #billing_phone_field{order:3}
body.bnco-active #billing_address_1_field{order:4}
body.bnco-active #billing_ghn_province_id_field{order:5}
body.bnco-active #billing_ghn_district_id_field{order:6}
body.bnco-active #billing_ghn_ward_code_field{order:7}
body.bnco-active #billing_email_field{order:8}
body.bnco-active .bnco-address-tip{order:20;border-radius:8px;background:#edf5ff;padding:10px 12px;font-size:12px;line-height:1.5;color:#34526e;margin:0}
body.bnco-active #ship-to-different-address{font-size:14px!important;padding:12px 2px!important;margin:0!important}
body.bnco-active .shipping_address{background:#fff;padding:14px!important;border:1px solid #dce4ec;border-radius:10px;margin-bottom:12px}
body.bnco-active .shipping_address .form-row{margin-bottom:12px!important}
body.bnco-active .woocommerce-additional-fields{padding-top:12px}
body.bnco-active [class*="invoice-request"]{font-size:13px}
body.bnco-active #lnl-shipping-eta{font-size:12px}
body.bnco-step1 #lnl-shipping-eta{display:none!important}
body.bnco-active #order_review{border:0!important;box-shadow:none!important;background:transparent!important;padding:0!important;margin:0!important;width:100%!important}
body.bnco-step2 .bnco-review-address{display:flex;gap:10px;align-items:flex-start;background:#fff;border:1px solid #dce4ec;border-radius:11px;padding:13px;margin:0 0 12px}
.bnco-address-icon{font-size:22px;color:#ae853f}
#bnco-address-copy{flex:1;font-size:13px;line-height:1.6;white-space:pre-line}
#bnco-edit{padding:0;margin:0;border:0;background:none;min-height:30px;font-size:13px;text-decoration:underline;color:#143e69}
body.bnco-active .woocommerce-checkout-review-order-table{display:block!important;width:100%!important;margin:0 0 12px!important;border:0!important}
body.bnco-active .woocommerce-checkout-review-order-table>thead{display:none!important}
body.bnco-active .woocommerce-checkout-review-order-table>tbody{display:block!important;border:1px solid #dce4ec;background:white;border-radius:11px;padding:0 12px}
body.bnco-active .woocommerce-checkout-review-order-table .cart_item{display:grid!important;grid-template-columns:minmax(0,1fr) 98px;gap:8px;border:0!important;border-bottom:1px solid #edf0f4!important;padding:12px 0!important}
body.bnco-active .woocommerce-checkout-review-order-table .cart_item:last-child{border-bottom:0!important}
body.bnco-active .woocommerce-checkout-review-order-table .cart_item>td{display:block!important;padding:0!important;border:0!important;font-size:13px!important;min-width:0!important;vertical-align:top!important;width:auto!important}
body.bnco-active .woocommerce-checkout-review-order-table .cart_item>.product-total{text-align:right!important;font-size:14px!important}
body.bnco-active .bnco-product-thumb{display:block;float:left;width:64px;height:64px;object-fit:contain;background:#f8fafc;border-radius:7px;margin:0 9px 6px 0}
body.bnco-active .woocommerce-checkout-review-order-table .product-name{line-height:1.45!important;color:#19334f!important}
body.bnco-active .woocommerce-checkout-review-order-table .product-name .quantity input{height:28px!important;min-height:28px!important;font-size:12px!important}
body.bnco-active .woocommerce-checkout-review-order-table .awdr-you-saved-text{font-size:10px!important;line-height:1.4!important}
body.bnco-active .woocommerce-checkout-review-order-table>tfoot{display:table!important;width:100%!important;background:#fff;border:1px solid #dce4ec;border-radius:11px;margin-top:12px}
body.bnco-active .woocommerce-checkout-review-order-table>tfoot>tr>th,
body.bnco-active .woocommerce-checkout-review-order-table>tfoot>tr>td{padding:10px 12px!important;border-color:#edf0f4!important;font-size:13px!important}
body.bnco-active .woocommerce-checkout-review-order-table .order-total .amount{font-size:20px!important;color:#143e69}
body.bnco-active .bnco-review-eta:not([hidden]){display:block;padding:12px;background:#fff;border:1px solid #dce4ec;border-radius:11px;font-size:13px;line-height:1.5;margin:0 0 12px;color:#143e69}
body.bnco-active #payment{background:#fff!important;border:1px solid #dce4ec!important;border-radius:11px!important;padding:14px!important;margin:0 0 12px!important}
body.bnco-active #payment:before{content:'Phương thức thanh toán';display:block;font-size:15px;font-weight:750;color:#143e69;margin-bottom:10px}
body.bnco-active #payment .payment_methods{border:0!important;padding:0!important;margin:0!important}
body.bnco-active #payment .wc_payment_method{padding:9px!important;border:1px solid #dce4ec!important;border-radius:7px;margin:0 0 8px!important;background:#fff}
body.bnco-active #payment .wc_payment_method:has(input:checked){border-color:#ba9450!important;background:#fffcf6!important}
body.bnco-active #payment .wc_payment_method>label{font-size:14px!important;line-height:1.5!important;font-weight:500!important}
body.bnco-active #payment .payment_box{font-size:12px!important;background:transparent!important;padding:5px 0!important;margin:0!important}
body.bnco-active #place_order{display:none!important}
body.bnco-active #payment .place-order{padding:10px 0 0!important;margin:0!important}
body.bnco-active .woocommerce-terms-and-conditions-wrapper{font-size:12px!important}
body.bnco-active .woocommerce-privacy-policy-text{font-size:11px!important;color:#708092}
body.bnco-active .lnl-voucher-shop-wrap{margin:0 0 12px!important}
body.bnco-active .lnl-voucher-shop-row{background:#fff!important;border:1px solid #dce4ec!important;border-radius:10px!important;padding:12px!important}
body.bnco-active .lnl-voucher-shop-copy strong{font-size:14px!important;color:#143e69}
body.bnco-active .lnl-voucher-shop-copy small{font-size:11px!important}
body.bnco-active .lnl-voucher-modal{z-index:100100!important}
body.bnco-active .lnl-voucher-modal-panel{position:fixed!important;left:0!important;right:0!important;top:auto!important;bottom:0!important;transform:none!important;width:100%!important;max-width:none!important;max-height:85dvh!important;border-radius:16px 16px 0 0!important;overflow:auto!important}
body.bnco-active .mlpo-checkout-note{padding:10px!important;margin:0 0 12px!important;font-size:11px!important;border-radius:9px!important}
body.bnco-active .vigifts-reward-points-box{font-size:12px!important;margin:0 0 12px!important;padding:10px!important}
body.bnco-active #bnco-footer{display:flex;position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #bb9553;z-index:9990;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));box-shadow:0 -4px 15px #143e6908}
#bnco-footer small{display:block;font-size:11px;line-height:1.4;color:#66778a}
#bnco-amount{display:block;font-size:21px;font-weight:800;color:#143e69;line-height:1.3;white-space:nowrap}
#bnco-next{margin:0;padding:12px 18px;border:0;background:#143e69;color:white;font-size:15px;border-radius:9px;line-height:1.4;min-height:46px;letter-spacing:0;text-transform:none}
#bnco-next:disabled{opacity:.55;cursor:wait}
#bnco-error{font-size:13px;color:#a12626;background:#fff4f2;border-radius:7px;padding:10px;margin:0 0 12px}
#bnco-error[hidden]{display:none!important}
body.bnco-active.bnco-modal #bnco-footer{visibility:hidden}
}

@media(max-width:549px){
body.bnco-active .is-sticky-column,body.bnco-active .is-sticky-column__inner{position:static!important;transform:none!important;top:auto!important;width:auto!important;height:auto!important}
body.bnco-active .bnco-address-tip,body.bnco-active .bnco-confirm-row{display:block}
body.bnco-step1 #ml-shipping-eta{display:none!important}
body.bnco-step2 #order_review{display:flex!important;flex-direction:column!important;gap:12px}
body.bnco-active #order_review>.woocommerce-checkout-review-order-table{display:contents!important}
body.bnco-active #order_review>.bnco-review-address{order:0;margin:0}
body.bnco-active .woocommerce-checkout-review-order-table>tbody{order:1}
body.bnco-active #order_review>.bnco-review-eta{order:2;margin:0;white-space:pre-line}
body.bnco-active #order_review>.lnl-voucher-before-payment-slot{order:3}
body.bnco-active #order_review>#payment{order:4;margin:0!important}
body.bnco-active .woocommerce-checkout-review-order-table>tfoot{order:5;margin:0}
body.bnco-active #order_review>.bnco-native-place-order{order:6;padding:0!important;margin:0!important}
body.bnco-active #order_review>.mlpo-checkout-note{order:2}
body.bnco-active #order_review>.vigifts-reward-points-box{order:5}
body.bnco-active .bnco-confirm-row{font-size:12px;font-weight:400;line-height:1.6}
body.bnco-active .lnl-checkout-qty-control,body.bnco-active .claw-checkout-qty{display:inline-flex!important;align-items:center;gap:0;margin-top:7px!important;max-width:100%}
body.bnco-active .lnl-checkout-qty-input,body.bnco-active .claw-checkout-qty-input{width:32px!important;min-width:0!important;height:28px!important;margin:0!important;padding:0!important}
body.bnco-active .lnl-checkout-qty-control button,body.bnco-active .claw-checkout-qty button{min-width:25px!important;width:25px!important;height:28px!important;min-height:0!important;padding:0!important;margin:0!important;line-height:1!important}
body.bnco-active .bnco-preorder{display:block;font-size:10px;color:#8b611f;font-weight:700}
body.bnco-active #bnco-shell *,body.bnco-active #bnco-footer *{box-sizing:border-box}
}</style>
<?php
},9999);
add_action('wp_footer',function(){
 if(!bnco_is_checkout())return;
 echo '<script>window.bncoCartUrl='.wp_json_encode(wc_get_cart_url()).';</script>';
?>
<script id="bnco-script">(function(){
'use strict';
const form=document.querySelector('form.checkout'),customer=document.getElementById('customer_details'),review=document.getElementById('order_review');
if(!form||!customer||!review)return;
const mq=matchMedia('(max-width:549px)');
let step=1,pending=false,updateFailed=false,timer=0;
const shell=document.createElement('section');shell.id='bnco-shell';
shell.innerHTML='<div class="bnco-head"><button id="bnco-back" type="button" aria-label="Quay lại">←</button><h1 id="bnco-title">Thông tin nhận hàng</h1><img id="bnco-logo" alt=""></div><div class="bnco-steps" aria-label="Tiến trình thanh toán"><span class="bnco-step active" data-step="1"><b>1</b>Địa chỉ</span><span class="bnco-line"></span><span class="bnco-step" data-step="2"><b>2</b>Xác nhận</span></div>';
const logo=document.querySelector('#header img.header_logo,#header img.header-logo,#logo img');
if(logo){shell.querySelector('img').src=logo.currentSrc||logo.src;shell.querySelector('img').alt=logo.alt;}
else shell.querySelector('img').hidden=true;
document.body.prepend(shell);
const error=document.createElement('div');error.id='bnco-error';error.hidden=true;error.setAttribute('role','alert');form.prepend(error);
const address=document.createElement('div');address.className='bnco-review-address';address.innerHTML='<span class="bnco-address-icon" aria-hidden="true">⌖</span><div id="bnco-address-copy"></div><button type="button" id="bnco-edit">Sửa</button>';review.prepend(address);
const eta=document.createElement('div');eta.className='bnco-review-eta';eta.hidden=true;review.insertBefore(eta,address.nextSibling);
const footer=document.createElement('div');footer.id='bnco-footer';footer.innerHTML='<div><small id="bnco-total-label">Tiền hàng</small><strong id="bnco-amount"></strong><small id="bnco-footnote">Chưa gồm phí giao hàng</small></div><button type="button" id="bnco-next">Tiếp tục →</button>';document.body.append(footer);
const next=footer.querySelector('button');
function value(id){return document.getElementById(id)?.value?.trim()||'';}
function selected(id){const e=document.getElementById(id);return e&&e.value?e.options[e.selectedIndex]?.textContent.trim()||'':'';}
function showError(message,field){
 error.textContent=message;error.hidden=false;
 if(field){field.setAttribute('aria-invalid','true');field.closest('.form-row')?.classList.add('woocommerce-invalid');field.focus();field.scrollIntoView({block:'center',behavior:'smooth'});}
}
function validate(){
 let ids=['billing_first_name','billing_phone','billing_address_1','billing_ghn_province_id','billing_ghn_district_id','billing_ghn_ward_code'];
 if(document.getElementById('ship-to-different-address-checkbox')?.checked)ids.push('shipping_first_name','shipping_address_1','shipping_ghn_province_id','shipping_ghn_district_id','shipping_ghn_ward_code','so-dt-nguoi-nhan');
 if(document.getElementById('createaccount')?.checked)ids.push('account_password');
 const labels={billing_first_name:'họ và tên',billing_phone:'số điện thoại',billing_address_1:'số nhà, tên đường',billing_ghn_province_id:'tỉnh/thành phố',billing_ghn_district_id:'quận/huyện',billing_ghn_ward_code:'phường/xã',shipping_first_name:'tên người nhận',shipping_address_1:'địa chỉ giao hàng',shipping_ghn_province_id:'tỉnh/thành phố giao hàng',shipping_ghn_district_id:'quận/huyện giao hàng',shipping_ghn_ward_code:'phường/xã giao hàng','so-dt-nguoi-nhan':'số điện thoại người nhận',account_password:'mật khẩu'};
 for(const id of ids){const e=document.getElementById(id);if(e&&!e.value.trim()){setStep(1,false);showError('Vui lòng nhập hoặc chọn '+labels[id]+'.',e);return false;}}
 for(const id of ['billing_phone',...(document.getElementById('ship-to-different-address-checkbox')?.checked?['so-dt-nguoi-nhan']:[])]){
 const e=document.getElementById(id);if(e&&!/^[0-9]{9,15}$/.test(e.value.replace(/\D/g,''))){setStep(1,false);showError('Vui lòng kiểm tra số điện thoại.',e);return false;}
 }
 const email=document.getElementById('billing_email');if(email?.value&&!email.validity.valid){setStep(1,false);showError('Vui lòng kiểm tra địa chỉ email.',email);return false;}
 error.hidden=true;return true;
}
function setStep(n,scroll=true){
 step=n;document.body.classList.toggle('bnco-step1',n===1);document.body.classList.toggle('bnco-step2',n===2);
 document.getElementById('bnco-title').textContent=n===1?'Thông tin nhận hàng':'Xác nhận đơn hàng';
 shell.querySelectorAll('.bnco-step').forEach(e=>{const s=Number(e.dataset.step);e.classList.toggle('active',s===n);e.classList.toggle('done',s<n);if(s===n)e.setAttribute('aria-current','step');else e.removeAttribute('aria-current');});
 sync();if(scroll)window.scrollTo({top:0,behavior:'smooth'});
}
function structure(){
 if(!mq.matches){const moved=review.querySelector(':scope > .bnco-native-place-order');if(moved)document.getElementById('payment')?.append(moved);return;}
 const wrap=document.querySelector('.woocommerce-billing-fields__field-wrapper');
 if(wrap&&!wrap.querySelector('.bnco-address-tip')){
 const tip=document.createElement('p');tip.className='bnco-address-tip';tip.textContent='Chọn đủ địa chỉ để xem phí và dự kiến giao hàng.';wrap.append(tip);
 }
 const captions={billing_address_1:'Số nhà, tên đường',billing_phone:'Số điện thoại',shipping_address_1:'Số nhà, tên đường'};
 Object.entries(captions).forEach(([id,text])=>{
 const label=document.querySelector('label[for="'+id+'"]');if(label&&!label.dataset.bncoLabel){label.dataset.bncoLabel='1';label.replaceChildren(document.createTextNode(text+' '));const star=document.createElement('abbr');star.className='required';star.title='bắt buộc';star.textContent='*';label.append(star);}
 });
 const currentReview=document.getElementById('order_review');if(!currentReview)return;
 if(!currentReview.contains(address))currentReview.prepend(address);
 if(!currentReview.contains(eta))currentReview.insertBefore(eta,address.nextSibling);
 currentReview.querySelectorAll('.shipping__table th').forEach(e=>{if(e.textContent.trim()==='Shipment')e.textContent='Vận chuyển';});
 if(mq.matches){
 const native=document.querySelector('#payment > .place-order');
 if(native){currentReview.querySelectorAll(':scope > .bnco-native-place-order').forEach(e=>e.remove());native.classList.add('bnco-native-place-order');currentReview.append(native);}
 if(!document.getElementById('terms')&&!document.getElementById('bnco-review-confirm')){
 const row=document.createElement('label');row.className='bnco-confirm-row';row.innerHTML='<input type="checkbox" id="bnco-review-confirm"> Tôi xác nhận thông tin đặt hàng ở trên là chính xác';currentReview.querySelector('.bnco-native-place-order')?.prepend(row);
 }
 }else{
 const moved=currentReview.querySelector(':scope > .bnco-native-place-order');if(moved)document.getElementById('payment')?.append(moved);
 }
}
function sync(){
 structure();
 const mobile=mq.matches;document.body.classList.toggle('bnco-active',mobile);
 const isShipping=document.getElementById('ship-to-different-address-checkbox')?.checked,prefix=isShipping?'shipping':'billing';
 const name=value(prefix+'_first_name'),phone=isShipping?value('so-dt-nguoi-nhan'):value('billing_phone');
 const addr=[value(prefix+'_address_1'),selected(prefix+'_ghn_ward_code'),selected(prefix+'_ghn_district_id'),selected(prefix+'_ghn_province_id')].filter(Boolean).join(', ');
 const addressText=[name+(phone?' · '+phone:''),addr].filter(Boolean).join('\n');
 const addressCopy=document.getElementById('bnco-address-copy');if(addressCopy.textContent!==addressText)addressCopy.textContent=addressText;
 const realEta=document.querySelector('#lnl-shipping-eta,#ml-shipping-eta');
 const etaResult=realEta?.querySelector('.lnl-eta-result,.ml-eta-result')?.textContent.trim();
 const etaText=realEta&&!realEta.hidden&&etaResult?('GHN · '+etaResult+'\nThời gian tham khảo; shop sẽ xác nhận khi xử lý đơn.'):'';
 eta.hidden=!etaText;if(eta.textContent!==etaText)eta.textContent=etaText;
 const amount=document.querySelector(step===1?'.woocommerce-checkout-review-order-table .cart-subtotal .amount':'.woocommerce-checkout-review-order-table .order-total .amount');
 if(amount){const dest=document.getElementById('bnco-amount');if(dest.textContent!==amount.textContent.trim())dest.textContent=amount.textContent.trim();}
 const busy=updateFailed||pending||form.classList.contains('processing')||!!document.querySelector('#order_review .blockUI,.woocommerce-checkout-review-order-table.processing');
 next.disabled=busy;
 const buttonText=busy?'Đang cập nhật…':step===1?'Tiếp tục →':'Đặt hàng';
 if(next.textContent!==buttonText)next.textContent=buttonText;
 document.getElementById('bnco-total-label').textContent=step===1?'Tiền hàng':'Tổng thanh toán';
 document.getElementById('bnco-footnote').textContent=step===1?'Chưa gồm phí giao hàng':'Đã gồm phí giao hàng hiển thị';
 document.body.classList.toggle('bnco-modal',!!document.querySelector('.lnl-voucher-modal[aria-hidden="false"]'));
}
function schedule(){clearTimeout(timer);timer=setTimeout(sync,80);}
document.getElementById('bnco-back').addEventListener('click',()=>{if(step===2)setStep(1);else location.href=window.bncoCartUrl||'/gio-hang/';});
document.getElementById('bnco-edit').addEventListener('click',()=>setStep(1));
next.addEventListener('click',()=>{
 sync();if(next.disabled)return;
 if(!validate())return;
 if(step===1){setStep(2);return;}
 const confirmation=document.getElementById('bnco-review-confirm');
 if(confirmation&&!confirmation.checked){showError('Vui lòng xác nhận thông tin đặt hàng trước khi tiếp tục.');error.scrollIntoView({block:'center'});return;}
 const native=document.getElementById('place_order');if(native&&!native.disabled)native.click();
});
form.addEventListener('submit',e=>{if(mq.matches&&step===1){e.preventDefault();e.stopImmediatePropagation();if(validate()&&!pending)setStep(2);}},true);
form.addEventListener('keydown',e=>{if(mq.matches&&step===1&&e.key==='Enter'&&e.target.matches('input:not([type=checkbox]):not([type=radio])')){e.preventDefault();next.click();}});
form.addEventListener('input',schedule);form.addEventListener('change',schedule);
if(window.jQuery){
 jQuery(document.body).on('update_checkout.bnco',()=>{pending=true;updateFailed=false;schedule();});
 jQuery(document.body).on('updated_checkout.bnco',()=>{pending=false;updateFailed=false;schedule();});
 jQuery(document.body).on('checkout_error.bnco',()=>{pending=false;if(customer.querySelector('.woocommerce-invalid'))setStep(1);schedule();});
 jQuery(document).ajaxError((e,xhr,settings)=>{if(settings.url?.includes('update_order_review')){pending=false;updateFailed=true;showError('Chưa cập nhật được tổng tiền. Vui lòng kiểm tra kết nối và thử lại.');next.disabled=true;}});
}
new MutationObserver(records=>{if(records.some(r=>!footer.contains(r.target)&&!shell.contains(r.target)&&!address.contains(r.target)&&!eta.contains(r.target)))schedule();}).observe(form,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden','aria-hidden']});
mq.addEventListener('change',()=>{sync();});window.addEventListener('resize',schedule);
setStep(1,false);
})();</script>
<?php
},9999);
