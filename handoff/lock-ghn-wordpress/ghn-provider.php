<?php
/** REST-safe provider extracted from snippets 71/125; no hooks or embedded credentials. */
if (!defined('ABSPATH')) { return; }
if (!function_exists('lnl_crm_ghn_config')) {
function lnl_crm_ghn_config() {
    $token = defined('LNL_GHN_TOKEN') ? (string) LNL_GHN_TOKEN : (string) getenv('LNL_GHN_TOKEN');
    $shop = defined('LNL_GHN_SHOP_ID') ? (int) LNL_GHN_SHOP_ID : (int) getenv('LNL_GHN_SHOP_ID');
    if (!$token || $token === 'REDACTED_RUNTIME_SECRET' || $shop <= 0) {
        return lnl_crm_ghn_error('ghn_handler_unavailable', 'Chưa cấu hình dịch vụ GHN trong WordPress runtime.', 503);
    }
    return array('token' => $token, 'shop' => $shop);
}
function lnl_crm_ghn_http($path, $payload, $method) {
    $config = lnl_crm_ghn_config();
    if (is_wp_error($config)) { return $config; }
    $url = 'https://online-gateway.ghn.vn/shiip/public-api' . $path;
    $args = array('timeout' => 20, 'method' => $method, 'headers' => array(
        'Token' => $config['token'], 'ShopId' => (string) $config['shop'], 'Content-Type' => 'application/json'));
    if ($method === 'GET') { $url .= '?' . http_build_query($payload, '', '&', PHP_QUERY_RFC3986); }
    else { $args['body'] = wp_json_encode($payload); }
    $response = wp_remote_request($url, $args);
    if (is_wp_error($response)) {
        return lnl_crm_ghn_error('ghn_reconcile_failed', 'Không nhận được kết quả GHN; cần đối soát trước khi gửi lại.', 502);
    }
    $body = json_decode(wp_remote_retrieve_body($response), true);
    if (!is_array($body)) {
        return lnl_crm_ghn_error($path === '/v2/shipping-order/create' ? 'ghn_response_missing_order_code' : 'ghn_reconcile_failed', 'GHN trả dữ liệu không hợp lệ; cần đối soát.', 502);
    }
    return array('http' => (int) wp_remote_retrieve_response_code($response), 'body' => $body);
}
function lnl_crm_ghn_lookup($client_code) {
    // Official GET contract; only the documented 400/not-found combination permits creation.
    $response = lnl_crm_ghn_http('/v2/shipping-order/detail-by-client-code', array('client_order_code' => $client_code), 'GET');
    if (is_wp_error($response)) { return $response; }
    $body = $response['body']; $data = $body['data'] ?? null;
    if ($response['http'] === 400 && ($body['code'] ?? null) === 400 && empty($data)
        && trim((string) ($body['message'] ?? '')) === 'Đơn hàng không tồn tại') { return null; }
    $config = lnl_crm_ghn_config();
    if ($response['http'] !== 200 || ($body['code'] ?? null) !== 200 || !is_array($data)
        || !lnl_crm_ghn_valid_code($data['order_code'] ?? null)
        || (string) ($data['client_order_code'] ?? '') !== $client_code
        || is_wp_error($config) || (int) ($data['shop_id'] ?? 0) !== $config['shop']) {
        return lnl_crm_ghn_error('ghn_reconcile_failed', 'Chưa xác minh được vận đơn đúng mã đơn và shop GHN. Không tạo mới.', 502);
    }
    return $data;
}
function lnl_crm_ghn_locations($path, $payload) {
    $response = lnl_crm_ghn_http($path, $payload, 'GET');
    if (is_wp_error($response)) { return $response; }
    if ($response['http'] !== 200 || ($response['body']['code'] ?? null) !== 200 || !is_array($response['body']['data'] ?? null)) {
        return lnl_crm_ghn_error('ghn_reconcile_failed', 'Chưa đối chiếu được danh mục địa chỉ GHN.', 502);
    }
    return $response['body']['data'];
}
function lnl_crm_ghn_prepare($order, $input, $client_code) {
    $fields = array('addressLine','provinceId','provinceName','districtId','districtName','wardCode','wardName');
    if ($input) {
        foreach ($fields as $field) {
            if (!isset($input[$field]) || trim((string) $input[$field]) === '') {
                return lnl_crm_ghn_error('address_invalid', 'Vui lòng nhập đủ địa chỉ, Tỉnh/Thành, Quận/Huyện và Phường/Xã.');
            }
        }
        $order->set_shipping_address_1(sanitize_text_field($input['addressLine']));
        $order->set_shipping_address_2(sanitize_text_field($input['wardName']));
        $order->set_shipping_city(sanitize_text_field($input['districtName']));
        $order->set_shipping_state(sanitize_text_field($input['provinceName']));
        foreach (array('province_id'=>'provinceId','province_name'=>'provinceName','district_id'=>'districtId','district_name'=>'districtName','ward_code'=>'wardCode','ward_name'=>'wardName') as $meta=>$field) {
            $value = sanitize_text_field((string) $input[$field]);
            $order->update_meta_data('_lnl_ghn_shipping_' . $meta, $value);
            $order->update_meta_data('_lnl_ghn_' . $meta, $value);
        }
    }
    $meta = function ($field) use ($order) {
        $value = (string) $order->get_meta('_lnl_ghn_shipping_' . $field);
        return $value !== '' ? $value : (string) $order->get_meta('_lnl_ghn_' . $field);
    };
    $province = (int) $meta('province_id'); $district = (int) $meta('district_id'); $ward = $meta('ward_code');
    if ($province <= 0 || $district <= 0 || $ward === '') { return lnl_crm_ghn_error('address_invalid', 'Thiếu mã Tỉnh/Thành, Quận/Huyện hoặc Phường/Xã GHN.'); }
    $districts = lnl_crm_ghn_locations('/master-data/district', array('province_id'=>$province));
    if (is_wp_error($districts)) { return $districts; }
    $wards = lnl_crm_ghn_locations('/master-data/ward', array('district_id'=>$district));
    if (is_wp_error($wards)) { return $wards; }
    $valid_district = false; $valid_ward = false;
    foreach ($districts as $row) { if ((int) ($row['DistrictID'] ?? 0) === $district && (!isset($row['ProvinceID']) || (int) $row['ProvinceID'] === $province)) { $valid_district = true; } }
    foreach ($wards as $row) { if ((string) ($row['WardCode'] ?? '') === $ward && (!isset($row['DistrictID']) || (int) $row['DistrictID'] === $district)) { $valid_ward = true; } }
    if (!$valid_district || !$valid_ward) { return lnl_crm_ghn_error('address_invalid', 'Quận/Huyện hoặc Phường/Xã không thuộc địa bàn đã chọn.'); }

    // Address, COD, item prices, dimensions and weights retain the exported handler's formulas.
    $parts = array_filter(array($order->get_shipping_address_1(), $order->get_shipping_address_2(), $order->get_shipping_city(), $order->get_shipping_state()));
    if (!$parts) { $parts = array_filter(array($order->get_billing_address_1(), $order->get_billing_address_2(), $order->get_billing_city(), $order->get_billing_state())); }
    $address = trim(wp_strip_all_tags(implode(', ', $parts)));
    $phone = preg_replace('/[^0-9+]/', '', (string) ($order->get_shipping_phone() ?: $order->get_billing_phone()));
    $name = trim($order->get_shipping_first_name() . ' ' . $order->get_shipping_last_name());
    if (!$name) { $name = trim($order->get_billing_first_name() . ' ' . $order->get_billing_last_name()); }
    if (!$name || !$phone || !$address) { return lnl_crm_ghn_error('address_invalid', 'Thiếu tên, số điện thoại hoặc địa chỉ người nhận.'); }
    $unit = get_option('woocommerce_weight_unit', 'kg');
    $weight = 0; $length = 0; $width = 0; $height = 0;
    $items = $order->get_items('line_item');
    foreach ($items as $item) {
        if (!$item instanceof WC_Order_Item_Product) { continue; }
        $product = $item->get_product(); $qty = max(1, (int) $item->get_quantity());
        if ($product) {
            $product_weight = (float) $product->get_weight();
            if ($product_weight > 0) {
                if ($unit === 'kg') { $product_weight *= 1000; }
                elseif ($unit === 'lbs') { $product_weight *= 453.592; }
                elseif ($unit === 'oz') { $product_weight *= 28.3495; }
                $weight += $product_weight * $qty;
            }
            $length = max($length, (float) $product->get_length());
            $width = max($width, (float) $product->get_width());
            $height += max(0, (float) $product->get_height()) * $qty;
        }
    }
    $package = array('weight'=>max(1000,(int)ceil($weight)), 'length'=>max(30,(int)ceil($length)), 'width'=>max(20,(int)ceil($width)), 'height'=>max(10,(int)ceil($height)));
    $lines = array();
    foreach ($items as $item) {
        if (!$item instanceof WC_Order_Item_Product) { continue; }
        $product = $item->get_product(); $qty = max(1,(int)$item->get_quantity());
        $lines[] = array('name'=>mb_substr($item->get_name(),0,120), 'code'=>$product?(string)$product->get_sku():'', 'quantity'=>$qty,
            'price'=>max(0,(int)round((float)$order->get_line_subtotal($item,false,false)/$qty)),
            'length'=>$package['length'],'width'=>$package['width'],'height'=>$package['height'], 'weight'=>max(1,(int)ceil($package['weight']/max(1,count($items)))));
    }
    return array('payment_type_id'=>2,'required_note'=>'CHOXEMHANGKHONGTHU','note'=>'Đơn WooCommerce #'.$order->get_order_number(),
        'client_order_code'=>$client_code,'to_name'=>$name,'to_phone'=>$phone,'to_address'=>$address,'to_ward_code'=>$ward,'to_district_id'=>$district,
        'cod_amount'=>strtolower((string)$order->get_payment_method())==='cod'?(int)round((float)$order->get_total()):0,
        'content'=>'LocknLockOnline - đơn #'.$order->get_order_number(),'weight'=>$package['weight'],'length'=>$package['length'],'width'=>$package['width'],'height'=>$package['height'],
        'insurance_value'=>min((int)round((float)$order->get_total()),5000000),'service_type_id'=>2,'items'=>$lines);
}
function lnl_crm_ghn_create($payload) {
    $response = lnl_crm_ghn_http('/v2/shipping-order/create', $payload, 'POST');
    if (is_wp_error($response)) { return $response; }
    $body = $response['body'];
    if ($response['http'] >= 400 && $response['http'] < 500 && (int) ($body['code'] ?? 0) !== 200) {
        $detail = $body['code_message_value'] ?? null;
        $message = is_string($detail) && trim($detail) !== '' ? $detail : (is_string($body['message'] ?? null) ? $body['message'] : 'GHN từ chối tạo vận đơn.');
        return lnl_crm_ghn_error('ghn_rejected', $message);
    }
    if ($response['http'] !== 200 || ($body['code'] ?? null) !== 200) {
        return lnl_crm_ghn_error('ghn_reconcile_failed', 'Chưa rõ kết quả tạo GHN; cần đối soát trước khi gửi lại.', 502);
    }
    $data = $body['data'] ?? array();
    if (!is_array($data) || !lnl_crm_ghn_valid_code($data['order_code'] ?? null)) {
        return lnl_crm_ghn_error('ghn_response_missing_order_code', 'GHN không trả mã vận đơn; cần đối soát trước khi gửi lại.', 502);
    }
    return $data;
}
}
