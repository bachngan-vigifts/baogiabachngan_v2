<?php
/**
 * Plugin Name: Lock lighter live search
 * Description: The header live search sent one server request per typed letter (about 3 s each). In the browser: wait until the shopper pauses typing (350 ms), skip queries shorter than 3 letters, and reuse answers already received on the same page. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }
if (defined('LNL_LIVE_SEARCH_OFF') && LNL_LIVE_SEARCH_OFF) { return; }
add_action('wp_footer', function () {
    if (is_admin()) { return; }
    echo '<script id="lnl-live-search-lite">' . lnl_live_search_js() . '</script>';
}, 1);
function lnl_live_search_js() {
    $js = <<<'JS'
(function () {
  var tries = 0;
  function setup($) {
    var cache = {}, timer = null, pendingDone = null;
    var EMPTY = '{"suggestions":[]}';
    $.ajaxTransport('+*', function (o) {
      var all = String(o.url || '') + '&' + (typeof o.data === 'string' ? o.data : '');
      if (all.indexOf('action=flatsome_ajax_search_products') === -1) { return; }
      var m = all.match(/(?:^|[?&])query=([^&]*)/);
      var q = m ? decodeURIComponent(m[1].replace(/\+/g, ' ')).trim() : '';
      return {
        send: function (headers, done) {
          if (pendingDone) { var pd = pendingDone; pendingDone = null; clearTimeout(timer); pd(200, 'success', { text: EMPTY }, 'Content-Type: application/json'); }
          if (q.length < 3) { done(200, 'success', { text: EMPTY }, 'Content-Type: application/json'); return; }
          if (cache[q]) { done(200, 'success', { text: cache[q] }, 'Content-Type: application/json'); return; }
          pendingDone = done;
          timer = setTimeout(function () {
            var me = done; pendingDone = null;
            var x = new XMLHttpRequest();
            var method = String(o.type || 'GET').toUpperCase();
            x.open(method, o.url, true);
            x.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
            if (method === 'POST') { x.setRequestHeader('Content-Type', o.contentType || 'application/x-www-form-urlencoded; charset=UTF-8'); }
            x.onload = function () { if (x.status >= 200 && x.status < 300) { cache[q] = x.responseText; } me(x.status, x.statusText, { text: x.responseText }, x.getAllResponseHeaders()); };
            x.onerror = function () { me(0, 'error'); };
            x.send(method === 'POST' ? o.data : null);
          }, 350);
        },
        abort: function () { if (pendingDone) { clearTimeout(timer); pendingDone = null; } }
      };
    });
  }
  (function wait() {
    if (window.jQuery && window.jQuery.ajaxTransport) { setup(window.jQuery); return; }
    if (++tries < 400) { setTimeout(wait, 25); }
  })();
})();
JS;
    return $js;
}
