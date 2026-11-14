<?php
/**
 * Plugin Name: Lock AJAX add to cart
 * Description: Single product page (simple + variable): add to cart without a full page reload. Falls back to the normal form on any problem.
 */
if (!defined('ABSPATH')) { exit; }
if (defined('LNL_AJAX_ATC_OFF') && LNL_AJAX_ATC_OFF) { return; }

add_action('wc_ajax_lnl_add_to_cart', function () {
    if (!function_exists('WC') || !WC()->cart) { wp_send_json(array('success' => false)); }
    $product_id   = isset($_POST['product_id']) ? absint(wp_unslash($_POST['product_id'])) : 0;
    $quantity     = isset($_POST['quantity']) ? wc_stock_amount(wp_unslash($_POST['quantity'])) : 1;
    $variation_id = isset($_POST['variation_id']) ? absint(wp_unslash($_POST['variation_id'])) : 0;
    $product      = $product_id ? wc_get_product($product_id) : false;
    if (!$product || !$product->is_type(array('simple', 'variable')) || $quantity < 1) {
        wp_send_json(array('success' => false));
    }
    $variation = array();
    if ($product->is_type('variable')) {
        foreach ($_POST as $key => $value) {
            if (is_string($key) && strpos($key, 'attribute_') === 0 && is_scalar($value)) {
                $variation[wc_clean($key)] = wc_clean(wp_unslash($value));
            }
        }
    }
    $passed = apply_filters('woocommerce_add_to_cart_validation', true, $product_id, $quantity, $variation_id, $variation);
    if (!$passed || false === WC()->cart->add_to_cart($product_id, $quantity, $variation_id, $variation)) {
        wc_clear_notices();
        wp_send_json(array('success' => false));
    }
    wc_clear_notices();
    do_action('woocommerce_ajax_added_to_cart', $product_id);
    ob_start();
    woocommerce_mini_cart();
    $mini = ob_get_clean();
    $fragments = apply_filters('woocommerce_add_to_cart_fragments', array(
        'div.widget_shopping_cart_content' => '<div class="widget_shopping_cart_content">' . $mini . '</div>',
    ));
    wp_send_json(array('success' => true, 'fragments' => $fragments, 'cart_hash' => WC()->cart->get_cart_hash()));
});

add_action('wp_footer', function () {
    if (is_admin() || !function_exists('is_product') || !is_product()) { return; }
    $product = wc_get_product(get_the_ID());
    if (!$product || !$product->is_type(array('simple', 'variable'))) { return; }
    $cfg = array(
        'url'  => add_query_arg('wc-ajax', 'lnl_add_to_cart', home_url('/')),
        'cart' => wc_get_cart_url(),
        'ok'   => "\u{110}\u{e3} th\u{ea}m v\u{e0}o gi\u{1ecf} h\u{e0}ng.",
        'view' => "Xem gi\u{1ecf} h\u{e0}ng",
    );
    ?>
<script id="lnl-ajax-atc">
(function () {
  var C = <?php echo wp_json_encode($cfg); ?>;
  if (!window.fetch || !window.FormData || !window.URLSearchParams) { return; }
  var form = document.querySelector('form.cart');
  if (!form || form.dataset.lnlAtc) { return; }
  form.dataset.lnlAtc = '1';
  var busy = false;
  function fallback(btn) {
    var pid = (form.querySelector('input[name=product_id]') || {}).value || (btn && btn.value) || '';
    if (pid) {
      var h = document.createElement('input');
      h.type = 'hidden'; h.name = 'add-to-cart'; h.value = pid;
      form.appendChild(h);
    }
    form.submit();
  }
  function notice() {
    var old = document.querySelectorAll('.lnl-added'); for (var i = 0; i < old.length; i++) { old[i].parentNode.removeChild(old[i]); }
    var d = document.createElement('div');
    d.className = 'woocommerce-message lnl-added'; d.setAttribute('role', 'alert');
    var a = document.createElement('a'); a.href = C.cart; a.className = 'button wc-forward'; a.textContent = C.view;
    d.appendChild(a); d.appendChild(document.createTextNode(' ' + C.ok));
    form.parentNode.insertBefore(d, form);
  }
  form.addEventListener('submit', function (e) {
    var btn = e.submitter;
    if (!btn || !btn.classList || !btn.classList.contains('single_add_to_cart_button')) { return; }
    if (e.defaultPrevented) { return; }
    e.preventDefault();
    if (busy) { return; }
    busy = true; btn.classList.add('loading');
    var fd = new FormData(form);
    var pid = (form.querySelector('input[name=product_id]') || {}).value || btn.value || '';
    fd.set('product_id', pid);
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 25000) : null;
    fetch(C.url, { method: 'POST', body: new URLSearchParams(fd), credentials: 'same-origin', signal: ctl ? ctl.signal : undefined, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (timer) { clearTimeout(timer); }
        if (!j || !j.success) { busy = false; btn.classList.remove('loading'); fallback(btn); return; }
        var $ = window.jQuery;
        if ($) {
          $.each(j.fragments || {}, function (k, v) { $(k).replaceWith(v); });
          $(document.body).trigger('added_to_cart', [j.fragments, j.cart_hash, $(btn)]);
        }
        notice();
        busy = false; btn.classList.remove('loading');
      })
      .catch(function () { window.location.reload(); });
  }, false);
})();
</script>
    <?php
}, 99);
