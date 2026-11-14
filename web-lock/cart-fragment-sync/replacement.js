/* Replace the existing lnlCartRefreshing ajaxComplete snippet; do not load both. */
jQuery(function ($) {
    'use strict';
    var timer;
    $(document).on('ajaxComplete.lnlCartSync', function (event, xhr, settings) {
        if (!settings || typeof settings.data !== 'string' ||
            !/(^|&)action=flatsome_ajax_cart_item_alter_quantity(&|$)/.test(settings.data) ||
            !xhr || xhr.status < 200 || xhr.status >= 300) {
            return;
        }
        // Coalesce completed quantity changes; WooCommerce owns fragments,
        // DOM replacement, browser storage and wc_fragments_refreshed.
        clearTimeout(timer);
        timer = setTimeout(function () {
            $(document.body).trigger('wc_fragment_refresh');
        }, 250);
    });
});
