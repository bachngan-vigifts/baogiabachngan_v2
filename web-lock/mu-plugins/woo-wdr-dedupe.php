<?php
/**
 * Plugin Name: Lock discount table dedupe
 * Description: Woo Discount Rules asks the server for the same bulk discount table of a variable product several times per page view (seen 3 identical calls on load, more on each variation change). Each call boots WordPress. Send each distinct request only once per page view and reuse the answer. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }
if (defined('LNL_WDR_DEDUPE_OFF') && LNL_WDR_DEDUPE_OFF) { return; }

add_action('wp_footer', function () {
    if (is_admin() || !function_exists('is_product') || !is_product()) { return; }
    echo '<script id="lnl-wdr-dedupe">' . lnl_wdr_dedupe_js() . '</script>';
}, 1);

function lnl_wdr_dedupe_js() {
    $js = <<<'JS'
(function () {
  var tries = 0;
  function setup($) {
    var cache = {};
    $.ajaxTransport('+*', function (o) {
      if (!o || typeof o.data !== 'string' || String(o.type).toUpperCase() !== 'POST') { return; }
      if (String(o.url).indexOf('admin-ajax.php') === -1) { return; }
      if (o.data.indexOf('action=wdr_ajax') === -1 || o.data.indexOf('method=get_variable_product_bulk_table') === -1) { return; }
      var key = o.data.replace(/(^|&)awdr_nonce=[^&]*/, '');
      return {
        send: function (headers, done) {
          var p = cache[key];
          if (!p) {
            p = cache[key] = new Promise(function (res, rej) {
              var x = new XMLHttpRequest();
              x.open('POST', o.url, true);
              x.setRequestHeader('Content-Type', o.contentType || 'application/x-www-form-urlencoded; charset=UTF-8');
              x.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
              x.onload = function () { if (x.status >= 200 && x.status < 300) { res({ s: x.status, t: x.statusText, r: x.responseText, h: x.getAllResponseHeaders() }); } else { delete cache[key]; res({ s: x.status, t: x.statusText, r: x.responseText, h: x.getAllResponseHeaders() }); } };
              x.onerror = function () { delete cache[key]; rej(); };
              x.send(o.data);
            });
          }
          p.then(function (v) { done(v.s, v.t, { text: v.r }, v.h); }, function () { done(0, 'error'); });
        },
        abort: function () {}
      };
    });
  }
  (function wait() {
    if (window.jQuery && window.jQuery.ajaxTransport) { setup(window.jQuery); return; }
    if (++tries < 200) { setTimeout(wait, 25); }
  })();
})();
JS;
    return $js;
}
