<?php
/**
 * LNL: prevent the native form handler from adding a product before
 * the dedicated lnl_add_to_cart AJAX handler adds the same product.
 * Scope: this one POST endpoint only. Normal add-to-cart and Buy Now stay intact.
 */
add_action( 'init', static function () {
    if ( 'POST' !== ( $_SERVER['REQUEST_METHOD'] ?? '' ) ) {
        return;
    }
    if ( ! isset( $_GET['wc-ajax'] ) || ! is_string( $_GET['wc-ajax'] )
        || 'lnl_add_to_cart' !== $_GET['wc-ajax'] ) {
        return;
    }
    if ( ! isset( $_POST['product_id'] ) || ! is_scalar( $_POST['product_id'] )
        || ! ctype_digit( (string) $_POST['product_id'] )
        || (int) $_POST['product_id'] < 1 ) {
        return;
    }
    unset( $_REQUEST['add-to-cart'], $_POST['add-to-cart'], $_GET['add-to-cart'] );
}, -100 );
