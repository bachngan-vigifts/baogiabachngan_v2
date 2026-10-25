/**
 * LNL - GHN auto create waybill when WooCommerce order is moved to waiting pickup.
 * Creates one GHN order only when address can be mapped confidently.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!defined('LNL_GHN_TOKEN')) {
    define('LNL_GHN_TOKEN', (string) getenv('LNL_GHN_TOKEN'));
}
if (!defined('LNL_GHN_SHOP_ID')) {
    define('LNL_GHN_SHOP_ID', (int) getenv('LNL_GHN_SHOP_ID'));
}
if (!defined('LNL_GHN_AUTO_CREATE_ENABLED')) {
    define('LNL_GHN_AUTO_CREATE_ENABLED', true);
}

add_action('woocommerce_order_status_lnl-awaiting-pickup', 'lnl_ghn_auto_create_order_on_processing', 20, 2);
// Processing is the live "Đang chờ lấy hàng" status on this site.
add_action('woocommerce_order_status_processing', 'lnl_ghn_auto_create_order_on_processing', 20, 2);

function lnl_ghn_auto_create_order_on_processing($order_id, $order = null) {
    if (!$order instanceof WC_Order) {
        $order = wc_get_order($order_id);
    }

    if (!$order instanceof WC_Order) {
        return;
    }

    if (!LNL_GHN_AUTO_CREATE_ENABLED) {
        return;
    }

    if ($order->get_meta('_lnl_ghn_order_code')) {
        return;
    }

    $lock_key = 'lnl_ghn_creating_' . $order->get_id();
    if (get_transient($lock_key)) {
        return;
    }
    set_transient($lock_key, 1, 5 * MINUTE_IN_SECONDS);

    try {
        $result = lnl_ghn_create_order_from_wc_order($order);

        if (!empty($result['order_code'])) {
            $order->update_meta_data('_lnl_ghn_order_code', sanitize_text_field($result['order_code']));
            if (!empty($result['sort_code'])) {
                $order->update_meta_data('_lnl_ghn_sort_code', sanitize_text_field($result['sort_code']));
            }
            if (!empty($result['total_fee'])) {
                $order->update_meta_data('_lnl_ghn_total_fee', (int) $result['total_fee']);
            }
            $order->save();

            $note = 'GHN: Đã tạo vận đơn tự động. Mã vận đơn: ' . $result['order_code'];
            if (!empty($result['total_fee'])) {
                $note .= '. Phí GHN: ' . number_format((int) $result['total_fee'], 0, ',', '.') . 'đ';
            }
            $order->add_order_note($note);
        }
    } catch (Exception $e) {
        $order->add_order_note('GHN: Chưa tạo vận đơn tự động - ' . $e->getMessage());
    }

    delete_transient($lock_key);
}

function lnl_ghn_create_order_from_wc_order(WC_Order $order) {
    if (!function_exists('lnl_crm_ghn_confirm')) {
        throw new RuntimeException('Dịch vụ GHN dùng chung chưa được nạp; không tạo vận đơn.');
    }
    $result = lnl_crm_ghn_confirm($order);
    if (is_wp_error($result)) { throw new RuntimeException($result->get_error_message()); }
    return $result;
}

function lnl_ghn_get_order_address(WC_Order $order) {
    $parts = array_filter(array(
        $order->get_shipping_address_1(),
        $order->get_shipping_address_2(),
        $order->get_shipping_city(),
        $order->get_shipping_state(),
    ));

    if (!$parts) {
        $parts = array_filter(array(
            $order->get_billing_address_1(),
            $order->get_billing_address_2(),
            $order->get_billing_city(),
            $order->get_billing_state(),
        ));
    }

    return trim(wp_strip_all_tags(implode(', ', $parts)));
}

function lnl_ghn_get_order_phone(WC_Order $order) {
    $phone = $order->get_shipping_phone();
    if (!$phone) {
        $phone = $order->get_billing_phone();
    }

    $phone = preg_replace('/[^0-9+]/', '', (string) $phone);
    return $phone;
}


function lnl_ghn_get_order_ghn_location(WC_Order $order) {
    $district_id = (int) $order->get_meta('_lnl_ghn_district_id');
    $ward_code = (string) $order->get_meta('_lnl_ghn_ward_code');

    if ($district_id > 0 && $ward_code !== '') {
        return array(
            'district_id' => $district_id,
            'ward_code' => $ward_code,
        );
    }

    return array();
}

function lnl_ghn_get_order_package(WC_Order $order) {
    $unit = get_option('woocommerce_weight_unit', 'kg');
    $weight = 0;
    $max_length = 0;
    $max_width = 0;
    $height = 0;

    foreach ($order->get_items('line_item') as $item) {
        if (!$item instanceof WC_Order_Item_Product) {
            continue;
        }

        $product = $item->get_product();
        $qty = max(1, (int) $item->get_quantity());

        if ($product) {
            $product_weight = (float) $product->get_weight();
            if ($product_weight > 0) {
                if ($unit === 'kg') {
                    $product_weight *= 1000;
                } elseif ($unit === 'lbs') {
                    $product_weight *= 453.592;
                } elseif ($unit === 'oz') {
                    $product_weight *= 28.3495;
                }
                $weight += $product_weight * $qty;
            }

            $max_length = max($max_length, (float) $product->get_length());
            $max_width = max($max_width, (float) $product->get_width());
            $height += max(0, (float) $product->get_height()) * $qty;
        }
    }

    return array(
        'weight' => max(1000, (int) ceil($weight)),
        'length' => max(30, (int) ceil($max_length)),
        'width' => max(20, (int) ceil($max_width)),
        'height' => max(10, (int) ceil($height)),
    );
}

function lnl_ghn_map_address($address) {
    $normalized = lnl_ghn_normalize_text($address);
    $province = lnl_ghn_find_province($normalized);
    if (!$province) {
        return array();
    }

    $districts = lnl_ghn_get_districts((int) $province['ProvinceID']);
    $matched_district = null;

    foreach ($districts as $district) {
        if (lnl_ghn_name_matches($normalized, $district['DistrictName'] ?? '', $district['NameExtension'] ?? array())) {
            $matched_district = $district;
            break;
        }
    }

    if ($matched_district) {
        $ward = lnl_ghn_find_ward_in_district($normalized, (int) $matched_district['DistrictID']);
        if ($ward) {
            return array(
                'district_id' => (int) $matched_district['DistrictID'],
                'ward_code' => (string) $ward['WardCode'],
            );
        }
    }

    $ward_matches = array();
    foreach ($districts as $district) {
        $ward = lnl_ghn_find_ward_in_district($normalized, (int) $district['DistrictID']);
        if ($ward) {
            $ward_matches[] = array($district, $ward);
        }
    }

    if (count($ward_matches) === 1) {
        return array(
            'district_id' => (int) $ward_matches[0][0]['DistrictID'],
            'ward_code' => (string) $ward_matches[0][1]['WardCode'],
        );
    }

    return array();
}

function lnl_ghn_find_province($normalized_address) {
    foreach (lnl_ghn_get_provinces() as $province) {
        if (lnl_ghn_name_matches($normalized_address, $province['ProvinceName'] ?? '', $province['NameExtension'] ?? array())) {
            return $province;
        }
    }

    return null;
}

function lnl_ghn_find_ward_in_district($normalized_address, $district_id) {
    foreach (lnl_ghn_get_wards($district_id) as $ward) {
        if (lnl_ghn_name_matches($normalized_address, $ward['WardName'] ?? '', $ward['NameExtension'] ?? array())) {
            return $ward;
        }
    }

    return null;
}

function lnl_ghn_name_matches($normalized_address, $name, $extensions) {
    $candidates = array_merge(array($name), is_array($extensions) ? $extensions : array());
    foreach ($candidates as $candidate) {
        $candidate = lnl_ghn_normalize_text($candidate);
        $candidate = preg_replace('/\b(tinh|thanh pho|tp|quan|huyen|thi xa|tx|phuong|xa|thi tran|tt|p)\b/', ' ', $candidate);
        $candidate = trim(preg_replace('/\s+/', ' ', $candidate));

        if (mb_strlen($candidate) >= 3 && strpos($normalized_address, $candidate) !== false) {
            return true;
        }
    }

    return false;
}

function lnl_ghn_get_provinces() {
    $cache = get_transient('lnl_ghn_provinces_v2026');
    if (is_array($cache)) {
        return $cache;
    }

    $response = lnl_ghn_api_request('/master-data/province', null, false);
    $data = $response['data'] ?? array();
    set_transient('lnl_ghn_provinces_v2026', $data, DAY_IN_SECONDS);
    return $data;
}

function lnl_ghn_get_districts($province_id) {
    $key = 'lnl_ghn_districts_v2026_' . $province_id;
    $cache = get_transient($key);
    if (is_array($cache)) {
        return $cache;
    }

    $response = lnl_ghn_api_request('/master-data/district', array('province_id' => $province_id), false);
    $data = $response['data'] ?? array();
    set_transient($key, $data, DAY_IN_SECONDS);
    return $data;
}

function lnl_ghn_get_wards($district_id) {
    $key = 'lnl_ghn_wards_v2026_' . $district_id;
    $cache = get_transient($key);
    if (is_array($cache)) {
        return $cache;
    }

    $response = lnl_ghn_api_request('/master-data/ward?district_id=' . (int) $district_id, null, false);
    $data = $response['data'] ?? array();
    set_transient($key, $data, DAY_IN_SECONDS);
    return $data;
}

function lnl_ghn_api_request($path, $payload = null, $include_shop_id = false) {
    $url = 'https://online-gateway.ghn.vn/shiip/public-api' . $path;
    $args = array(
        'timeout' => 20,
        'headers' => array(
            'Token' => LNL_GHN_TOKEN,
            'Content-Type' => 'application/json',
        ),
    );

    if ($include_shop_id) {
        $args['headers']['ShopId'] = (string) LNL_GHN_SHOP_ID;
    }

    if (is_array($payload)) {
        $args['method'] = 'POST';
        $args['body'] = wp_json_encode($payload);
    } else {
        $args['method'] = 'GET';
    }

    $response = wp_remote_request($url, $args);
    if (is_wp_error($response)) {
        throw new Exception($response->get_error_message());
    }

    $body = wp_remote_retrieve_body($response);
    $data = json_decode($body, true);
    if (!is_array($data)) {
        throw new Exception('GHN trả dữ liệu không hợp lệ');
    }

    return $data;
}

function lnl_ghn_normalize_text($text) {
    $text = strtolower((string) $text);
    $text = remove_accents($text);
    $text = preg_replace('/[^a-z0-9\s]/', ' ', $text);
    return trim(preg_replace('/\s+/', ' ', $text));
}

add_filter('cron_schedules', 'lnl_ghn_add_status_sync_schedule');
add_action('init', 'lnl_ghn_schedule_status_sync');
add_action('lnl_ghn_sync_order_statuses_event', 'lnl_ghn_sync_recent_order_statuses');

function lnl_ghn_add_status_sync_schedule($schedules) {
    if (!isset($schedules['lnl_ghn_every_15_minutes'])) {
        $schedules['lnl_ghn_every_15_minutes'] = array(
            'interval' => 15 * MINUTE_IN_SECONDS,
            'display' => 'LNL GHN mỗi 15 phút',
        );
    }

    return $schedules;
}

function lnl_ghn_schedule_status_sync() {
    if (!wp_next_scheduled('lnl_ghn_sync_order_statuses_event')) {
        wp_schedule_event(time() + 5 * MINUTE_IN_SECONDS, 'lnl_ghn_every_15_minutes', 'lnl_ghn_sync_order_statuses_event');
    }
}

function lnl_ghn_sync_recent_order_statuses() {
    if (!function_exists('wc_get_orders')) {
        return;
    }

    $orders = wc_get_orders(array(
        'limit' => 30,
        'status' => array('processing', 'on-hold', 'lnl-awaiting-pickup', 'lnl-awaiting-del', 'lnl-delivered', 'lnl-delivery-failed', 'lnl-returning', 'lnl-returned'),
        'meta_key' => '_lnl_ghn_order_code',
        'meta_compare' => 'EXISTS',
        'orderby' => 'date',
        'order' => 'DESC',
        'return' => 'objects',
    ));

    foreach ($orders as $order) {
        if ($order instanceof WC_Order) {
            lnl_ghn_sync_single_order_status($order);
        }
    }
}

function lnl_ghn_sync_single_order_status(WC_Order $order) {
    $order_code = (string) $order->get_meta('_lnl_ghn_order_code');
    if ($order_code === '') {
        return;
    }

    try {
        $response = lnl_ghn_api_request('/v2/shipping-order/detail', array('order_code' => $order_code), true);
    } catch (Exception $e) {
        return;
    }

    if ((int) ($response['code'] ?? 0) !== 200 || empty($response['data']) || !is_array($response['data'])) {
        return;
    }

    $data = $response['data'];
    $ghn_status = strtolower((string) ($data['status'] ?? ''));

    if ($ghn_status === '') {
        return;
    }

    $last_status = (string) $order->get_meta('_lnl_ghn_last_status');
    if ($last_status !== $ghn_status) {
        $order->update_meta_data('_lnl_ghn_last_status', $ghn_status);
        $order->save();
        $order->add_order_note('GHN: Cập nhật trạng thái ' . $ghn_status . ' cho mã vận đơn ' . $order_code . '.');
    }

    $target_status = lnl_ghn_map_status_to_wc_status($ghn_status, $data);
    if (!$target_status || $order->has_status($target_status)) {
        return;
    }

    $order->update_status($target_status, 'Tự đồng bộ từ GHN. Mã vận đơn ' . $order_code . ', trạng thái GHN: ' . $ghn_status . '.');
}

function lnl_ghn_map_status_to_wc_status($ghn_status, $data) {
    $waiting_pickup = array(
        'ready_to_pick',
        'picking',
        'money_collect_picking',
    );

    $in_delivery = array(
        'picked',
        'storing',
        'transporting',
        'sorting',
        'delivering',
    );

    $failed_delivery = array(
        'delivery_fail',
        'delivery_failed',
        'return_fail',
        'exception',
        'damage',
        'lost',
    );

    $returning = array(
        'waiting_to_return',
        'return',
        'return_transporting',
        'return_sorting',
        'returning',
    );

    if (in_array($ghn_status, $waiting_pickup, true)) {
        return 'lnl-awaiting-pickup';
    }

    if (in_array($ghn_status, $failed_delivery, true)) {
        return 'lnl-delivery-failed';
    }

    if (in_array($ghn_status, $in_delivery, true)) {
        return 'lnl-awaiting-del';
    }

    if (in_array($ghn_status, $returning, true)) {
        return 'lnl-returning';
    }

    if ($ghn_status === 'delivered') {
        return lnl_ghn_cod_is_confirmed($data) ? 'completed' : 'lnl-delivered';
    }

    if ($ghn_status === 'returned') {
        return 'lnl-returned';
    }

    if ($ghn_status === 'cancel') {
        return 'cancelled';
    }

    return '';
}


add_action('wp_ajax_lnl_ghn_backfill_today_orders', 'lnl_ghn_backfill_today_orders');

function lnl_ghn_backfill_today_orders() {
    if (!current_user_can('manage_woocommerce')) {
        wp_send_json_error(array('message' => 'forbidden'), 403);
    }

    if (!function_exists('wc_get_orders')) {
        wp_send_json_error(array('message' => 'WooCommerce unavailable'), 500);
    }

    $tz = function_exists('wp_timezone') ? wp_timezone() : new DateTimeZone('Asia/Ho_Chi_Minh');
    $start = new DateTime('today', $tz);

    $order_ids_raw = isset($_POST['order_ids']) ? sanitize_text_field(wp_unslash($_POST['order_ids'])) : '';
    if ($order_ids_raw !== '') {
        $orders = array();
        foreach (array_filter(array_map('absint', explode(',', $order_ids_raw))) as $manual_order_id) {
            $manual_order = wc_get_order($manual_order_id);
            if ($manual_order instanceof WC_Order) {
                $orders[] = $manual_order;
            }
        }
    } else {
        $orders = wc_get_orders(array(
            'limit' => 50,
            'status' => array('processing', 'lnl-awaiting-pickup'),
            'date_created' => '>=' . $start->getTimestamp(),
            'orderby' => 'date',
            'order' => 'ASC',
            'return' => 'objects',
        ));
    }

    $results = array();

    foreach ($orders as $order) {
        if (!$order instanceof WC_Order) {
            continue;
        }

        $haystack = strtolower((string) $order->get_customer_note() . ' ' . $order->get_billing_first_name() . ' ' . $order->get_shipping_first_name() . ' ' . $order->get_shipping_address_1());
        if (strpos($haystack, 'test') !== false || strpos($haystack, 'claw') !== false) {
            $results[] = array('order_id' => $order->get_id(), 'status' => 'skipped_test');
            continue;
        }

        if ($order->get_meta('_lnl_ghn_order_code')) {
            $results[] = array('order_id' => $order->get_id(), 'status' => 'already_has_ghn', 'order_code' => $order->get_meta('_lnl_ghn_order_code'));
            continue;
        }

        lnl_ghn_auto_create_order_on_processing($order->get_id(), $order);
        $order = wc_get_order($order->get_id());
        $order_code = $order instanceof WC_Order ? (string) $order->get_meta('_lnl_ghn_order_code') : '';

        $results[] = array(
            'order_id' => $order instanceof WC_Order ? $order->get_id() : 0,
            'status' => $order_code ? 'created' : 'not_created',
            'order_code' => $order_code,
        );
    }

    wp_send_json_success(array('count' => count($results), 'results' => $results));
}


function lnl_ghn_cod_is_confirmed($data) {
    if (!is_array($data)) {
        return false;
    }

    $candidate_keys = array(
        'cod_transfer_date',
        'cod_transferred_date',
        'cod_transfered_date',
        'cod_confirm_date',
        'cod_paid_date',
        'cod_payment_date',
        'cod_collect_date',
    );

    foreach ($candidate_keys as $key) {
        if (!empty($data[$key])) {
            return true;
        }
    }

    foreach ($data as $key => $value) {
        $key = strtolower((string) $key);
        if (strpos($key, 'cod') !== false && preg_match('/transfer|paid|payment|confirm|doi_soat|doisoat|collect/', $key) && !empty($value)) {
            return true;
        }

        if (is_array($value) && lnl_ghn_cod_is_confirmed($value)) {
            return true;
        }
    }

    return false;
}
