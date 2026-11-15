<?php
/**
 * Plugin Name: Lock product sticky bar tidy
 * Description: Product page sticky buy bar. Its duplicate (slow, full page reload) form is retired: its buttons now press the main form's buttons, so add-to-cart uses the fast AJAX path. On phones, the sticky buy bar on product pages becomes one clean row (thumbnail + two buttons), and the floating chat/contact buttons move up so they no longer cover it. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }

add_action('wp_head', function () {
    if (is_admin() || !function_exists('is_product') || !is_product()) { return; }
    if (defined('LNL_STICKY_TIDY_OFF') && LNL_STICKY_TIDY_OFF) { return; }
    echo '<style id="lnl-sticky-tidy">' . lnl_sticky_tidy_css() . '</style>';
}, 100);

function lnl_sticky_tidy_css() {
    $css = <<<'CSS'
@media (max-width: 600px) {
  .sticky-add-to-cart--active {
    background: #fff; padding: 8px 10px calc(8px + env(safe-area-inset-bottom)) !important;
    box-shadow: 0 -2px 10px rgba(0,0,0,.1);
  }
  .sticky-add-to-cart--active .sticky-add-to-cart__product {
    display: flex !important; align-items: center; justify-content: flex-start; flex-wrap: nowrap; gap: 8px; margin: 0; padding: 0; width: 100%; max-width: none;
  }
  .sticky-add-to-cart--active .sticky-add-to-cart-img {
    width: 40px !important; height: 40px !important; flex: 0 0 40px; margin: 0 !important; border-radius: 6px;
  }
  .sticky-add-to-cart--active p.stock,
  .sticky-add-to-cart--active .awdr-bulk-customizable-table,
  .sticky-add-to-cart--active .claw-lnl-logo-calc,
  .sticky-add-to-cart--active .ux-quantity { display: none !important; }

  .sticky-add-to-cart--active form.cart {
    display: flex !important; flex: 1 1 0; min-width: 0; width: 100%; align-items: center; gap: 8px; margin: 0 !important; padding: 0;
  }
  .sticky-add-to-cart--active form.cart .button,
  .sticky-add-to-cart--active .sticky-add-to-cart-select-options-button {
    height: 44px; min-height: 0; line-height: 1.15; font-size: 13px; padding: 0 8px; margin: 0 !important;
    border-radius: 8px; white-space: nowrap;
  }
  .sticky-add-to-cart--active form.cart .button { flex: 1 1 0; min-width: 0; width: auto; font-size: 12px; letter-spacing: 0; }
  .sticky-add-to-cart--active .sticky-add-to-cart-select-options-button { margin-left: auto !important; flex: 0 0 auto; padding: 0 14px; }
  .sticky-add-to-cart--active .woocommerce-Price-amount { font-size: 14px; font-weight: 700; white-space: nowrap; }

  /* Floating buttons move above the bar while it is showing */
  body:has(.sticky-add-to-cart--active) .fixed-contact { bottom: calc(64px + env(safe-area-inset-bottom)) !important; top: auto !important; }
  body:has(.sticky-add-to-cart--active) #claw-ai-launcher { bottom: calc(112px + env(safe-area-inset-bottom)) !important; top: auto !important; }
  body:has(.sticky-add-to-cart--active) #top-link { bottom: calc(70px + env(safe-area-inset-bottom)) !important; }
}
CSS;
    return $css;
}

add_action('wp_footer', function () {
    if (is_admin() || !function_exists('is_product') || !is_product()) { return; }
    if (defined('LNL_STICKY_TIDY_OFF') && LNL_STICKY_TIDY_OFF) { return; }
    echo '<script id="lnl-sticky-proxy">' . lnl_sticky_proxy_js() . '</script>';
}, 100);

function lnl_sticky_proxy_js() {
    $js = <<<'JS'
(function () {
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || !f.closest || !f.closest('.sticky-add-to-cart')) { return; }
    var forms = document.querySelectorAll('form.cart'), main = null;
    for (var i = 0; i < forms.length; i++) { if (!forms[i].closest('.sticky-add-to-cart')) { main = forms[i]; break; } }
    if (!main) { return; }
    var s = e.submitter;
    var buy = !!(s && s.name === 'ux-buy-now');
    var btn = main.querySelector(buy ? 'button[name="ux-buy-now"]' : '.single_add_to_cart_button');
    if (!btn || btn.disabled) { return; }
    e.preventDefault(); e.stopImmediatePropagation();
    var q = f.querySelector('input.qty'), mq = main.querySelector('input.qty');
    if (q && mq && q.offsetParent !== null) { mq.value = q.value; }
    if (s && !buy && window.jQuery) {
      s.classList.add('loading');
      var done = function () { s.classList.remove('loading'); };
      window.jQuery(document.body).one('added_to_cart', done); setTimeout(done, 10000);
    }
    btn.click();
  }, true);
})();
JS;
    return $js;
}
