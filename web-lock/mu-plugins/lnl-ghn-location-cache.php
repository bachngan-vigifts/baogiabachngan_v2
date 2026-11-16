<?php
/**
 * Plugin Name: Lock GHN location cache
 * Description: The checkout asks GHN for the province / district / ward lists on every visit (about 3 s per call). These lists almost never change, so keep each successful answer for 12 hours and serve it directly. Only these three ajax actions are touched; errors are never cached. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }
if (defined('LNL_GHN_CACHE_OFF') && LNL_GHN_CACHE_OFF) { return; }

function lnl_ghn_cache_key() {
    $p = array();
    foreach ($_REQUEST as $k => $v) {
        if (!is_string($k) || !is_scalar($v)) { continue; }
        if (preg_match('/nonce|security|^_|^action$|^lang$/i', $k)) { continue; }
        $p[$k] = (string) $v;
    }
    ksort($p);
    return 'lnl_ghnloc_' . md5((string) $_REQUEST['action'] . '|' . wp_json_encode($p));
}

foreach (array('lnl_ghn_checkout_provinces', 'lnl_ghn_checkout_districts', 'lnl_ghn_checkout_wards') as $lnl_ghn_action) {
    $lnl_ghn_cb = function () {
        $key = lnl_ghn_cache_key();
        $hit = get_transient($key);
        if (is_string($hit) && $hit !== '') {
            if (!headers_sent()) { header('Content-Type: application/json; charset=' . get_option('blog_charset')); header('X-Lnl-Ghn-Cache: hit'); }
            echo $hit;
            exit;
        }
        ob_start(function ($buf) use ($key) {
            $t = ltrim((string) $buf);
            if ($t !== '' && strlen($t) < 500000 && ($t[0] === '{' || $t[0] === '[')) {
                $j = json_decode($t, true);
                $ok = is_array($j) && !(isset($j['success']) && $j['success'] === false) && !isset($j['error']) && count($j) > 0;
                if ($ok) { set_transient($key, $t, 12 * HOUR_IN_SECONDS); }
            }
            return $buf;
        });
    };
    add_action('wp_ajax_' . $lnl_ghn_action, $lnl_ghn_cb, 0);
    add_action('wp_ajax_nopriv_' . $lnl_ghn_action, $lnl_ghn_cb, 0);
}
