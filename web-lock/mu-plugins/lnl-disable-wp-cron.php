<?php
/**
 * Plugin Name: Lock real cron
 * Description: Stop WordPress from launching wp-cron on visitor requests (the server was calling itself hundreds of times per hour, ~30% timed out). Scheduled tasks now run from the hosting cron job every 5 minutes (added together with this file). Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }
if (!defined('DISABLE_WP_CRON')) { define('DISABLE_WP_CRON', true); }
