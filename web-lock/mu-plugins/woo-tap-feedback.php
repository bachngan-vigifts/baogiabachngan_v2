<?php
/**
 * Plugin Name: Lock tap feedback
 * Description: Shows a thin progress bar at the top as soon as a visitor taps a product or category link, so slow page loads do not look like the tap was missed. No data, no requests. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }
if (defined('LNL_TAP_FEEDBACK_OFF') && LNL_TAP_FEEDBACK_OFF) { return; }

add_action('wp_footer', function () {
    if (is_admin()) { return; }
    ?>
<style id="lnl-tap-feedback-css">
#lnl-tap-bar{position:fixed;top:0;left:0;height:3px;width:0;background:#c8102e;z-index:2147483000;opacity:0;pointer-events:none}
#lnl-tap-bar.on{opacity:1;width:85%;transition:width 8s cubic-bezier(.1,.6,.2,1)}
.lnl-tapped{opacity:.65;transition:opacity .1s}
</style>
<script id="lnl-tap-feedback">
(function () {
  var bar = document.createElement('div'); bar.id = 'lnl-tap-bar'; document.body.appendChild(bar);
  function reset() { bar.className = ''; bar.style.width = '0'; var t = document.querySelectorAll('.lnl-tapped'); for (var i = 0; i < t.length; i++) { t[i].classList.remove('lnl-tapped'); } }
  window.addEventListener('pageshow', reset);
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { return; }
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.target === '_blank' || a.hasAttribute('download')) { return; }
    var h = a.getAttribute('href') || '';
    if (!h || h.charAt(0) === '#' || /^(javascript|mailto|tel):/i.test(h)) { return; }
    var u; try { u = new URL(a.href, location.href); } catch (x) { return; }
    if (u.origin !== location.origin || (u.pathname === location.pathname && u.search === location.search)) { return; }
    if (/\/(wp-admin|wp-login)|[?&]add-to-cart=|wc-ajax/.test(u.href)) { return; }
    var card = a.closest('.product-small, .product, .box'); if (card) { card.classList.add('lnl-tapped'); }
    void bar.offsetWidth; bar.className = 'on';
    setTimeout(reset, 15000);
  }, true);
})();
</script>
    <?php
}, 100);
