<?php
/**
 * Plugin Name: Lock buy now direct
 * Description: Product page "Mua ngay": go straight to the checkout page and add the product in that same request (one server round trip instead of two). Falls back to the theme's normal behaviour when a variation is not chosen yet. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }
if (defined('LNL_BUY_DIRECT_OFF') && LNL_BUY_DIRECT_OFF) { return; }

function lnl_buy_direct_request() {
    return isset($_GET['lnl_buy'], $_GET['add-to-cart']) && $_GET['lnl_buy'] === '1';
}

// Stay on the checkout page after adding (no extra redirect to the cart page).
add_filter('pre_option_woocommerce_cart_redirect_after_add', function ($pre) {
    return lnl_buy_direct_request() ? 'no' : $pre;
});

// The "added to cart" success notice is not needed on the checkout page; keep error notices.
add_action('template_redirect', function () {
    if (!lnl_buy_direct_request() || !function_exists('wc_get_notices')) { return; }
    $all = wc_get_notices();
    if (isset($all['success'])) { unset($all['success']); wc_set_notices($all); }
}, 5);

add_action('wp_footer', function () {
    if (is_admin()) { return; }
    if (function_exists('is_checkout') && is_checkout()) {
        echo '<script id="lnl-buy-direct-clean">(function(){try{if(/[?&]add-to-cart=/.test(location.search)){history.replaceState(null,"",location.pathname);}}catch(e){}})();</script>';
        return;
    }
    if (!function_exists('is_product') || !is_product()) { return; }
    $js = str_replace('%%CHECKOUT%%', esc_js(wc_get_checkout_url()), lnl_buy_direct_js());
    echo '<script id="lnl-buy-direct">' . $js . '</script>';
}, 90);

function lnl_buy_direct_js() {
    $js = <<<'JS'
(function () {
  var CHECKOUT = '%%CHECKOUT%%';
  if (!window.FormData || !window.URLSearchParams) { return; }
  var busy = false;
  document.addEventListener('submit', function (e) {
    var f = e.target, s = e.submitter;
    if (!f || !s || s.name !== 'ux-buy-now' || !f.matches || !f.matches('form.cart')) { return; }
    if (f.closest('.sticky-add-to-cart')) { return; }
    if (e.defaultPrevented || s.disabled || (s.classList && s.classList.contains('disabled'))) { return; }
    var fd = new FormData(f);
    var pid = s.value || fd.get('add-to-cart') || fd.get('product_id') || '';
    if (!pid) { return; }
    if (f.classList.contains('variations_form')) {
      var vid = parseInt(fd.get('variation_id') || '0', 10);
      if (!vid) { return; }
    }
    var p = new URLSearchParams();
    fd.forEach(function (v, k) { if (typeof v === 'string' && k !== 'ux-buy-now' && k !== 'add-to-cart' && k.indexOf('_wp') !== 0) { p.append(k, v); } });
    p.set('add-to-cart', String(pid));
    p.set('lnl_buy', '1');
    e.preventDefault(); e.stopImmediatePropagation();
    if (busy) { return; }
    busy = true;
    try { s.style.opacity = '.7'; s.textContent = '\u0110ang x\u1eed l\u00fd\u2026'; } catch (x) {}
    setTimeout(function () { busy = false; }, 15000);
    window.location.assign(CHECKOUT + (CHECKOUT.indexOf('?') === -1 ? '?' : '&') + p.toString());
  }, true);
})();
JS;
    return $js;
}
