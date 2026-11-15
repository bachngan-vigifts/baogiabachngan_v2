<?php
/**
 * Plugin Name: Lock AJAX buy now
 * Description: Product page "Mua ngay" button: add to cart via AJAX (reuses the lnl_add_to_cart endpoint of woo-ajax-add-to-cart.php), then go straight to checkout. Falls back to the normal submit on any problem. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }
if (defined('LNL_AJAX_BUYNOW_OFF') && LNL_AJAX_BUYNOW_OFF) { return; }

add_action('wp_footer', function () {
    if (is_admin() || !function_exists('is_product') || !is_product()) { return; }
    $product = wc_get_product(get_the_ID());
    if (!$product || !$product->is_type(array('simple', 'variable'))) { return; }
    $cfg = array(
        'url'      => add_query_arg('wc-ajax', 'lnl_add_to_cart', home_url('/')),
        'checkout' => wc_get_checkout_url(),
        'busy'     => "\u{110}ang x\u{1eed} l\u{fd}\u{2026}",
    );
    ?>
<script id="lnl-ajax-buynow">
(function () {
  var C = <?php echo wp_json_encode($cfg); ?>;
  if (!window.fetch || !window.FormData || !window.URLSearchParams) { return; }
  var form = document.querySelector('form.cart');
  if (!form || form.dataset.lnlBuy) { return; }
  form.dataset.lnlBuy = '1';
  var busy = false;
  function fallback(btn) {
    var h = document.createElement('input');
    h.type = 'hidden'; h.name = 'ux-buy-now'; h.value = (btn && btn.value) || '';
    form.appendChild(h);
    form.submit();
  }
  form.addEventListener('submit', function (e) {
    var btn = e.submitter;
    if (!btn || btn.name !== 'ux-buy-now') { return; }
    if (e.defaultPrevented) { return; }
    e.preventDefault();
    if (busy) { return; }
    busy = true;
    var label = btn.textContent;
    btn.textContent = C.busy; btn.style.opacity = '.7'; btn.style.pointerEvents = 'none';
    var fd = new FormData(form);
    var pid = btn.value || (form.querySelector('input[name=product_id]') || {}).value || '';
    fd.set('product_id', pid);
    fd.delete('ux-buy-now');
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 25000) : null;
    function restore() { busy = false; btn.textContent = label; btn.style.opacity = ''; btn.style.pointerEvents = ''; }
    fetch(C.url, { method: 'POST', body: new URLSearchParams(fd), credentials: 'same-origin', signal: ctl ? ctl.signal : undefined, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (timer) { clearTimeout(timer); }
        if (!j || !j.success) { restore(); fallback(btn); return; }
        window.location.href = C.checkout;
      })
      .catch(function () { restore(); fallback(btn); });
  }, false);
})();
</script>
    <?php
}, 99);
