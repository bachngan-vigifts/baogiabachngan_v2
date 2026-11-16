<?php
/**
 * Plugin Name: Lock ajax timing log
 * Description: For admin-ajax.php and wc-ajax requests, log the action name, how long the request took, whether the visitor was logged in, and peak memory. One line per request to wp-content/lnl-logs/ajax-timing.log (web access denied, max 3 MB). No customer data. Delete this file to stop.
 */
if (!defined('ABSPATH')) { exit; }
if (defined('LNL_AJAX_TIMING_OFF') && LNL_AJAX_TIMING_OFF) { return; }
$lnl_at_uri = isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '';
$lnl_at_wc = isset($_GET['wc-ajax']) ? (string) $_GET['wc-ajax'] : '';
if (strpos($lnl_at_uri, '/wp-admin/admin-ajax.php') === false && $lnl_at_wc === '') { return; }
register_shutdown_function(function () use ($lnl_at_wc) {
    $action = $lnl_at_wc !== '' ? 'wc-ajax:' . $lnl_at_wc : (isset($_REQUEST['action']) && is_string($_REQUEST['action']) ? $_REQUEST['action'] : '(none)');
    $action = substr(preg_replace('/[^a-zA-Z0-9_:\-]/', '', $action), 0, 80);
    $line = gmdate('c') . "\t" . $action . "\t" . (int) round((microtime(true) - $_SERVER['REQUEST_TIME_FLOAT']) * 1000) . "\t" . (function_exists('is_user_logged_in') && is_user_logged_in() ? 'login' : 'guest') . "\t" . (int) round(memory_get_peak_usage(true) / 1048576) . "MB\t" . http_response_code() . "\n";
    $dir = WP_CONTENT_DIR . '/lnl-logs';
    if (!is_dir($dir)) { @mkdir($dir, 0755); @file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n"); @file_put_contents($dir . '/index.php', ''); }
    $f = $dir . '/ajax-timing.log';
    if (@filesize($f) > 3000000) { return; }
    @file_put_contents($f, $line, FILE_APPEND | LOCK_EX);
});
