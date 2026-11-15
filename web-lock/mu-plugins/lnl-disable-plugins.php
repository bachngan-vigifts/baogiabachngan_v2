<?php
/**
 * Plugin Name: Lock disable plugins
 * Description: Keeps Query Monitor and Jetpack from loading (as requested by the site owner) without touching the database or the plugin folders. Delete this file to load them again.
 */
if (!defined('ABSPATH')) { exit; }
if (defined('LNL_DISABLE_PLUGINS_OFF') && LNL_DISABLE_PLUGINS_OFF) { return; }

add_filter('option_active_plugins', function ($plugins) {
    if (!is_array($plugins)) { return $plugins; }
    $off = array('query-monitor/query-monitor.php', 'jetpack/jetpack.php');
    return array_values(array_diff($plugins, $off));
});
