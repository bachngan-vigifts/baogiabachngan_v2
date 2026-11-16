<?php
/**
 * Plugin Name: Lock checkout timing log
 * Description: Measure where time goes when a customer presses "Place order": total request time, each callback on the order hooks, each email send and each outgoing HTTP call (host only). Writes one line per checkout to wp-content/lnl-logs/ (web access denied). Stores NO customer data (no names, phones, addresses, emails, order numbers). Delete this file to stop.
 */
if (!defined('ABSPATH')) { exit; }
if (defined('LNL_CHECKOUT_TIMING_OFF') && LNL_CHECKOUT_TIMING_OFF) { return; }

$GLOBALS['lnl_ct'] = array('on' => false, 'hooks' => array(), 'mail' => array(), 'http' => array(), 'marks' => array(), 'order' => false);

function lnl_ct_ms($t) { return (int) round((microtime(true) - $t) * 1000); }
function lnl_ct_mark($k) { $GLOBALS['lnl_ct']['marks'][$k] = lnl_ct_ms($_SERVER['REQUEST_TIME_FLOAT']); }
function lnl_ct_name($cb) {
    if (is_string($cb)) { return $cb; }
    if (is_array($cb) && isset($cb[0], $cb[1])) { return (is_object($cb[0]) ? get_class($cb[0]) : (string) $cb[0]) . '::' . $cb[1]; }
    if ($cb instanceof Closure) { try { $r = new ReflectionFunction($cb); return 'closure@' . basename(dirname($r->getFileName())) . '/' . basename($r->getFileName()) . ':' . $r->getStartLine(); } catch (Exception $e) { return 'closure'; } }
    return is_object($cb) ? get_class($cb) : 'other';
}
function lnl_ct_wrap($hook) {
    global $wp_filter;
    if (empty($wp_filter[$hook]) || !is_object($wp_filter[$hook])) { return; }
    foreach ($wp_filter[$hook]->callbacks as $prio => &$list) {
        foreach ($list as $id => &$item) {
            if (!empty($item['lnl_ct'])) { continue; }
            $orig = $item['function'];
            $name = $hook . ' ' . lnl_ct_name($orig);
            $item['function'] = function () use ($orig, $name) {
                $t = microtime(true);
                $ret = call_user_func_array($orig, func_get_args());
                $GLOBALS['lnl_ct']['hooks'][] = array($name, lnl_ct_ms($t));
                return $ret;
            };
            $item['lnl_ct'] = 1;
        }
        unset($item);
    }
    unset($list);
}

$lnl_ct_is_checkout = isset($_GET['wc-ajax']) && $_GET['wc-ajax'] === 'checkout';
$lnl_ct_is_bg = (defined('DOING_CRON') && DOING_CRON) || (isset($_REQUEST['action']) && is_string($_REQUEST['action']) && strpos($_REQUEST['action'], 'emailer') !== false);
if (!$lnl_ct_is_checkout && !$lnl_ct_is_bg) { return; }
$GLOBALS['lnl_ct']['on'] = true;
$GLOBALS['lnl_ct']['kind'] = $lnl_ct_is_checkout ? 'checkout' : 'nen';

add_action('woocommerce_checkout_process', function () {
    lnl_ct_mark('kiem_tra');
    foreach (array('woocommerce_checkout_create_order', 'woocommerce_checkout_update_order_meta', 'woocommerce_checkout_order_created', 'woocommerce_new_order', 'woocommerce_checkout_order_processed', 'woocommerce_order_status_changed', 'woocommerce_order_status_pending_to_processing', 'woocommerce_order_status_pending_to_on-hold', 'woocommerce_payment_complete', 'woocommerce_reduce_order_stock', 'woocommerce_checkout_order_review', 'woocommerce_after_checkout_validation') as $h) { lnl_ct_wrap($h); }
}, -99999);
add_action('woocommerce_checkout_order_created', function () { lnl_ct_mark('da_luu_don'); $GLOBALS['lnl_ct']['order'] = true; }, -99999);
add_action('woocommerce_checkout_order_processed', function () { lnl_ct_mark('xu_ly_sau_don_bat_dau'); }, -99999);
add_action('woocommerce_checkout_order_processed', function () { lnl_ct_mark('xu_ly_sau_don_xong'); }, 99999);

add_filter('wp_mail', function ($a) { $GLOBALS['lnl_ct']['mail_t'] = microtime(true); return $a; }, -99999);
$lnl_ct_mail_end = function ($x = null) { if (!empty($GLOBALS['lnl_ct']['mail_t'])) { $GLOBALS['lnl_ct']['mail'][] = lnl_ct_ms($GLOBALS['lnl_ct']['mail_t']) . (is_wp_error($x) ? '!' : ''); $GLOBALS['lnl_ct']['mail_t'] = 0; } };
add_action('wp_mail_succeeded', $lnl_ct_mail_end); add_action('wp_mail_failed', $lnl_ct_mail_end);

add_filter('pre_http_request', function ($pre, $args, $url) { $GLOBALS['lnl_ct']['http_t'][md5($url)] = microtime(true); return $pre; }, -99999, 3);
add_action('http_api_debug', function ($resp, $ctx, $class, $args, $url) {
    $k = md5($url); if (empty($GLOBALS['lnl_ct']['http_t'][$k])) { return; }
    $host = (string) parse_url($url, PHP_URL_HOST);
    $GLOBALS['lnl_ct']['http'][] = array($host, lnl_ct_ms($GLOBALS['lnl_ct']['http_t'][$k]), empty($args['blocking']) ? 'khong_cho' : 'cho');
}, 10, 5);

register_shutdown_function(function () {
    $c = $GLOBALS['lnl_ct'];
    if (empty($c['on']) || ($c['kind'] === 'nen' && empty($c['mail']) && empty($c['http']))) { return; }
    usort($c['hooks'], function ($a, $b) { return $b[1] - $a[1]; });
    $hooks = array(); foreach (array_slice($c['hooks'], 0, 25) as $h) { if ($h[1] >= 20) { $hooks[] = $h; } }
    $line = array('t' => gmdate('c'), 'loai' => $c['kind'], 'tao_don' => $c['order'], 'tong_ms' => lnl_ct_ms($_SERVER['REQUEST_TIME_FLOAT']), 'moc' => $c['marks'], 'cham_nhat' => $hooks, 'email_ms' => $c['mail'], 'http' => array_slice($c['http'], 0, 20));
    $dir = WP_CONTENT_DIR . '/lnl-logs';
    if (!is_dir($dir)) { @mkdir($dir, 0755); @file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n"); @file_put_contents($dir . '/index.php', ''); }
    $f = $dir . '/checkout-timing.log';
    if (@filesize($f) > 2000000) { return; }
    @file_put_contents($f, wp_json_encode($line) . "\n", FILE_APPEND | LOCK_EX);
});
