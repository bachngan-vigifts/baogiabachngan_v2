<?php
/**
 * Plugin Name: Lock checkout error popup
 * Description: Checkout page: validation errors (missing province/district/ward, name, phone...) are shown in a popup instead of only at the top of the form. After closing, the page scrolls to the first field to fix. The normal WooCommerce notice stays as a fallback. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }
if (defined('LNL_CHECKOUT_POPUP_OFF') && LNL_CHECKOUT_POPUP_OFF) { return; }

add_action('wp_footer', function () {
    if (is_admin() || !function_exists('is_checkout') || !is_checkout()) { return; }
    if (function_exists('is_order_received_page') && is_order_received_page()) { return; }
    echo '<style id="lnl-err-popup-css">' . lnl_checkout_popup_css() . '</style>';
    echo '<script id="lnl-err-popup">' . lnl_checkout_popup_js() . '</script>';
}, 100);

function lnl_checkout_popup_css() {
    $css = <<<'CSS'
#lnl-err-popup-wrap { position: fixed; inset: 0; z-index: 2147483600; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(0,0,0,.45); }
#lnl-err-popup-box { width: 100%; max-width: 380px; max-height: 80vh; overflow: auto; background: #fff; border-radius: 14px; padding: 18px 18px 14px; box-shadow: 0 10px 40px rgba(0,0,0,.25); text-align: left; }
#lnl-err-popup-box h4 { margin: 0 0 10px; font-size: 17px; font-weight: 700; color: #c8102e; }
#lnl-err-popup-box ul { margin: 0 0 14px; padding: 0; list-style: none; }
#lnl-err-popup-box li { margin: 0; padding: 7px 0 7px 22px; position: relative; font-size: 15px; line-height: 1.35; color: #222; border-top: 1px solid #f0f0f0; }
#lnl-err-popup-box li:first-child { border-top: 0; }
#lnl-err-popup-box li::before { content: "!"; position: absolute; left: 0; top: 8px; width: 16px; height: 16px; border-radius: 50%; background: #c8102e; color: #fff; font-size: 11px; font-weight: 700; line-height: 16px; text-align: center; }
#lnl-err-popup-ok { display: block; width: 100%; height: 46px; margin: 0; border: 0; border-radius: 10px; background: #c8102e; color: #fff; font-size: 16px; font-weight: 700; }
CSS;
    return $css;
}

function lnl_checkout_popup_js() {
    $js = <<<'JS'
(function () {
  if (!window.jQuery) { return; }
  var $ = window.jQuery;
  var MAP = [[/Tỉnh|Thành phố/i, '#billing_ghn_province_id_field'], [/Quận|Huyện/i, '#billing_ghn_district_id_field'], [/Phường|Xã/i, '#billing_ghn_ward_code_field']];
  function close(target) {
    var w = document.getElementById('lnl-err-popup-wrap'); if (w) { w.parentNode.removeChild(w); }
    if (target && target.scrollIntoView) {
      try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { target.scrollIntoView(); }
      var f = target.querySelector('input:not([type=hidden]), select, textarea'); if (f) { setTimeout(function () { try { f.focus({ preventScroll: true }); } catch (e) {} }, 400); }
    }
  }
  function show() {
    var items = document.querySelectorAll('.woocommerce-NoticeGroup-checkout .woocommerce-error li, form.checkout > .woocommerce-error li');
    var texts = [], i;
    for (i = 0; i < items.length; i++) { var t = (items[i].textContent || '').replace(/\s+/g, ' ').trim(); if (t && texts.indexOf(t) === -1) { texts.push(t); } }
    if (!texts.length) { return; }
    var target = null, j;
    for (i = 0; i < texts.length && !target; i++) { for (j = 0; j < MAP.length; j++) { if (MAP[j][0].test(texts[i])) { target = document.querySelector(MAP[j][1]); break; } } }
    var firstInvalid = document.querySelector('form.checkout .woocommerce-invalid');
    if (firstInvalid && (!target || (firstInvalid.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING))) { target = firstInvalid; }
    close(null);
    var wrap = document.createElement('div'); wrap.id = 'lnl-err-popup-wrap'; wrap.setAttribute('role', 'alertdialog'); wrap.setAttribute('aria-modal', 'true');
    var box = document.createElement('div'); box.id = 'lnl-err-popup-box';
    var h = document.createElement('h4'); h.textContent = 'Vui lòng kiểm tra lại';
    var ul = document.createElement('ul');
    for (i = 0; i < texts.length; i++) { var li = document.createElement('li'); li.textContent = texts[i]; ul.appendChild(li); }
    var ok = document.createElement('button'); ok.type = 'button'; ok.id = 'lnl-err-popup-ok'; ok.textContent = 'Đã hiểu';
    box.appendChild(h); box.appendChild(ul); box.appendChild(ok); wrap.appendChild(box); document.body.appendChild(wrap);
    ok.addEventListener('click', function () { close(target); });
    wrap.addEventListener('click', function (e) { if (e.target === wrap) { close(target); } });
    try { ok.focus(); } catch (e) {}
  }
  $(document.body).on('checkout_error', function () { setTimeout(show, 60); });
})();
JS;
    return $js;
}
