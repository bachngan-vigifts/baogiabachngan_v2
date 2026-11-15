<?php
/**
 * Plugin Name: Lock block PHP probes
 * Description: Bots scan for hidden PHP files (random names like /xty.php). WordPress used to load fully and render a 404 page for each one. Answer them with a tiny 404 before plugins and theme load. Real PHP files are not touched. Delete this file to roll back.
 */
if (!defined('ABSPATH') || PHP_SAPI === 'cli') { return; }
if (defined('LNL_BLOCK_PHP_PROBE_OFF') && LNL_BLOCK_PHP_PROBE_OFF) { return; }
(function () {
    $uri = isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '';
    $path = parse_url($uri, PHP_URL_PATH);
    if (!is_string($path) || $path === '' || !preg_match('~\.php$~i', $path)) { return; }
    $path = rawurldecode($path);
    $base = basename($path);
    if ($base === 'index.php') { return; }
    $root = isset($_SERVER['DOCUMENT_ROOT']) && $_SERVER['DOCUMENT_ROOT'] !== '' ? rtrim((string) $_SERVER['DOCUMENT_ROOT'], '/') : rtrim(ABSPATH, '/');
    if (strpos($path, '..') === false && is_file($root . $path)) { return; }
    if (strpos($path, '..') === false && is_file(rtrim(ABSPATH, '/') . $path)) { return; }
    if (!headers_sent()) {
        header('HTTP/1.1 404 Not Found', true, 404);
        header('Content-Type: text/plain; charset=utf-8');
        header('Cache-Control: public, max-age=3600');
        header('X-Lnl-Probe: 1');
    }
    echo 'Not Found';
    exit;
})();
