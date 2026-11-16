<?php
/**
 * Plugin Name: Lock slower heartbeat
 * Description: WordPress "heartbeat" sends a request every 15-60 s from every open admin tab. Slow it to 60 s while editing a post/product (autosave and edit locks keep working) and 120 s on all other screens and on the front end. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }
if (defined('LNL_HEARTBEAT_OFF') && LNL_HEARTBEAT_OFF) { return; }
add_filter('heartbeat_settings', function ($settings) {
    $editing = is_admin() && isset($GLOBALS['pagenow']) && in_array($GLOBALS['pagenow'], array('post.php', 'post-new.php'), true);
    $settings['interval'] = $editing ? 60 : 120;
    return $settings;
}, 99);
