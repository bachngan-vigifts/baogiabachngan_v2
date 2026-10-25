<?php
/** Shared create/reconcile/save boundary for REST and the existing checkout/status handlers. */
if (!defined('ABSPATH')) { return; }
if (!function_exists('lnl_crm_ghn_confirm')) {
function lnl_crm_ghn_valid_code($value) {
    return is_string($value) && preg_match('/^[a-z0-9][a-z0-9_-]{0,99}$/iD', $value) === 1;
}
function lnl_crm_ghn_error($code, $message, $status = 409) {
    $message = wp_strip_all_tags((string) $message);
    $message = preg_replace('/\bBearer\s+[^\s,;]+/i', 'Bearer [ẩn]', $message);
    $message = preg_replace('/\b(token|cookie|authorization|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/i', '$1=[ẩn]', $message);
    $secret = defined('LNL_GHN_TOKEN') ? (string) LNL_GHN_TOKEN : (string) getenv('LNL_GHN_TOKEN');
    if ($secret !== '') { $message = str_replace($secret, '[ẩn]', $message); }
    preg_match('/^.{0,500}/us', trim($message), $match);
    return new WP_Error($code, $match[0] ?? 'Không xử lý được GHN; cần đối soát.', array('status'=>$status));
}
function lnl_crm_ghn_reload($id) {
    $order = wc_get_order($id);
    if (!$order instanceof WC_Order) { throw new RuntimeException('order_unavailable'); }
    $order->get_data_store()->read($order);
    $order->read_meta_data(true);
    return $order;
}
function lnl_crm_ghn_saved($order) {
    return array('order_code'=>(string)$order->get_meta('_lnl_ghn_order_code'), 'sort_code'=>(string)$order->get_meta('_lnl_ghn_sort_code'),
        'total_fee'=>(float)$order->get_meta('_lnl_ghn_total_fee'), 'status'=>(string)$order->get_meta('_lnl_ghn_last_status'));
}
function lnl_crm_ghn_display_code($order) {
    if (!$order instanceof WC_Order) { return; }
    $code = $order->get_meta('_lnl_ghn_order_code');
    if (lnl_crm_ghn_valid_code($code)) {
        echo '<p class="lnl-ghn-tracking"><strong>Mã vận đơn GHN:</strong> ' . esc_html($code) . '</p>';
    }
}
function lnl_crm_ghn_persist($id, $client_code, $data) {
    $order = lnl_crm_ghn_reload($id); $code = $data['order_code'] ?? '';
    $old = $order->get_meta('_lnl_ghn_order_code');
    if (!lnl_crm_ghn_valid_code($code) || ($old !== '' && $old !== $code)) {
        return lnl_crm_ghn_error('ghn_reconcile_failed', 'Mã vận đơn không khớp liên kết WooCommerce hiện tại. Không ghi đè.', 502);
    }
    $order->update_meta_data('_lnl_crm_ghn_client_order_code', $client_code);
    $order->update_meta_data('_lnl_ghn_order_code', $code);
    $order->update_meta_data('_lnl_ghn_sort_code', sanitize_text_field((string) ($data['sort_code'] ?? $order->get_meta('_lnl_ghn_sort_code'))));
    $order->update_meta_data('_lnl_ghn_total_fee', (int) ($data['total_fee'] ?? $order->get_meta('_lnl_ghn_total_fee')));
    $order->update_meta_data('_lnl_ghn_last_status', sanitize_text_field((string) ($data['status'] ?? 'ready_to_pick')));
    try {
        $order->save();
        $fresh = lnl_crm_ghn_reload($id);
        if ((string) $fresh->get_meta('_lnl_ghn_order_code') !== $code || (string) $fresh->get_meta('_lnl_crm_ghn_client_order_code') !== $client_code) {
            throw new RuntimeException('metadata_readback_mismatch');
        }
        return lnl_crm_ghn_saved($fresh);
    } catch (Throwable $e) {
        return lnl_crm_ghn_error('ghn_metadata_persist_failed', 'GHN đã có vận đơn nhưng WooCommerce chưa lưu/xác minh được mã. Lần sau chỉ đối soát và lưu lại mã cũ.', 502);
    }
}
function lnl_crm_ghn_confirm($order, $input = array()) {
    global $wpdb;
    static $running = array();
    $id = $order->get_id();
    $lock = 'lnl_crm_ghn_' . get_current_blog_id() . '_' . $id;
    if (isset($running[$lock])) { return lnl_crm_ghn_error('ghn_reconcile_failed', 'Đơn đang được xử lý trong yêu cầu này. Không gửi tạo lại.'); }
    // Connection-scoped MySQL advisory lock: atomic, no expiring transient and no schema change.
    try { $locked = $wpdb && (int) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 0)', $lock)) === 1; }
    catch (Throwable $e) { $locked = false; }
    if (!$locked) { return lnl_crm_ghn_error('ghn_reconcile_failed', 'Đơn đang được xử lý hoặc chưa lấy được khóa GHN. Không gửi tạo lại.'); }
    $running[$lock] = true;
    try {
        $order = lnl_crm_ghn_reload($id);
        $code = $order->get_meta('_lnl_ghn_order_code');
        if ($code !== '') {
            return lnl_crm_ghn_valid_code($code) ? lnl_crm_ghn_saved($order) : lnl_crm_ghn_error('ghn_reconcile_failed', 'Mã GHN đang lưu cần đối soát; không tạo mới.');
        }
        if (!function_exists('lnl_crm_ghn_lookup') || !function_exists('lnl_crm_ghn_prepare') || !function_exists('lnl_crm_ghn_create')) {
            return lnl_crm_ghn_error('ghn_handler_unavailable', 'Website chưa nạp dịch vụ GHN trong REST.', 503);
        }
        $client = $order->get_meta('_lnl_crm_ghn_client_order_code');
        if (!is_string($client)) { return lnl_crm_ghn_error('ghn_reconcile_failed', 'Mã đối soát WooCommerce không hợp lệ. Không tạo mới.'); }
        if ($client === '') { $client = (string) $order->get_order_number(); }
        if ($client === '') { return lnl_crm_ghn_error('ghn_reconcile_failed', 'Thiếu mã đơn riêng để đối soát GHN.'); }
        $found = lnl_crm_ghn_lookup($client);
        if (is_wp_error($found)) { return $found; }
        if ($found !== null) { return lnl_crm_ghn_persist($id, $client, $found); }
        // A durable intent survives timeout, worker death and a failed metadata save after creation.
        if ($order->get_meta('_lnl_crm_ghn_create_attempted') !== '') {
            return lnl_crm_ghn_error('ghn_reconcile_failed', 'Đã từng gửi tạo GHN nhưng chưa đối soát thấy mã. Chỉ đối soát, không tạo lần hai.', 502);
        }
        if (in_array($order->get_status(), array('completed','cancelled','refunded','failed'), true)) {
            return new WP_Error('bad_status', 'Trạng thái đơn không cho phép chốt.', array('status'=>409));
        }
        $payload = lnl_crm_ghn_prepare($order, $input, $client);
        if (is_wp_error($payload)) { return $payload; }
        $order->update_meta_data('_lnl_crm_ghn_client_order_code', $client);
        $order->update_meta_data('_lnl_crm_ghn_create_attempted', $client);
        $order->save();
        $fresh = lnl_crm_ghn_reload($id);
        if ((string) $fresh->get_meta('_lnl_crm_ghn_create_attempted') !== $client || (string) $fresh->get_meta('_lnl_crm_ghn_client_order_code') !== $client) {
            return lnl_crm_ghn_error('ghn_metadata_persist_failed', 'Chưa lưu/xác minh được dữ liệu đơn trước khi tạo GHN. Chưa gửi tạo vận đơn.', 502);
        }
        $verified = lnl_crm_ghn_prepare($fresh, array(), $client);
        if (is_wp_error($verified)) { return $verified; }
        if ($verified !== $payload) { return lnl_crm_ghn_error('ghn_metadata_persist_failed', 'Dữ liệu đơn vừa thay đổi. Chưa gửi tạo GHN; cần đối soát.', 502); }
        if ((int) $wpdb->get_var($wpdb->prepare('SELECT IS_USED_LOCK(%s) = CONNECTION_ID()', $lock)) !== 1) {
            return lnl_crm_ghn_error('ghn_reconcile_failed', 'Kết nối đã mất khóa đơn. Chưa gửi tạo GHN; cần đối soát.', 502);
        }
        $result = lnl_crm_ghn_create($payload);
        if (is_wp_error($result)) {
            $found = lnl_crm_ghn_lookup($client);
            if (is_wp_error($found)) { return $found; }
            if ($found !== null) { return lnl_crm_ghn_persist($id, $client, $found); }
            if ($result->get_error_code() === 'ghn_rejected') {
                // Only a definitive carrier rejection permits a later corrected request, after another lookup.
                $fresh = lnl_crm_ghn_reload($id);
                $fresh->delete_meta_data('_lnl_crm_ghn_create_attempted'); $fresh->save();
            }
            return $result;
        }
        return lnl_crm_ghn_persist($id, $client, $result);
    } catch (Throwable $e) {
        return lnl_crm_ghn_error('ghn_metadata_persist_failed', 'Website chưa lưu/xác minh được dữ liệu đơn. Giữ nguyên thông tin và đối soát trước khi gửi lại.', 502);
    } finally {
        unset($running[$lock]);
        try { $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock)); } catch (Throwable $e) { /* Connection closure also releases the lock. */ }
    }
}
function lnl_crm_ghn_cancel($order) {
    global $wpdb;
    $id = $order->get_id(); $lock = 'lnl_crm_ghn_' . get_current_blog_id() . '_' . $id;
    try { $locked = $wpdb && (int) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 0)', $lock)) === 1; }
    catch (Throwable $e) { $locked = false; }
    if (!$locked) { return lnl_crm_ghn_error('ghn_reconcile_failed', 'Đơn đang được xử lý GHN. Chưa huỷ; cần đối soát.'); }
    try {
        $order = lnl_crm_ghn_reload($id);
        if ($order->get_status() === 'completed') { return new WP_Error('delivered','Đơn đã hoàn thành, không thể huỷ.',array('status'=>409)); }
        $code = $order->get_meta('_lnl_ghn_order_code');
        if ($code === '' && $order->get_meta('_lnl_crm_ghn_create_attempted') !== '') {
            return lnl_crm_ghn_error('ghn_reconcile_failed', 'Đã gửi tạo GHN nhưng chưa có mã đã xác minh. Đối soát trước khi huỷ.');
        }
        if ($code !== '') {
            if (!lnl_crm_ghn_valid_code($code)) { return lnl_crm_ghn_error('ghn_reconcile_failed','Mã GHN đang lưu cần đối soát; chưa huỷ.'); }
            $client = $order->get_meta('_lnl_crm_ghn_client_order_code');
            if ($client === '') { $client = (string) $order->get_order_number(); }
            if (!is_string($client)) { return lnl_crm_ghn_error('ghn_reconcile_failed','Mã đối soát không hợp lệ; chưa huỷ.'); }
            $found = lnl_crm_ghn_lookup($client);
            if (is_wp_error($found)) { return $found; }
            if ($found === null || $found['order_code'] !== $code) { return lnl_crm_ghn_error('ghn_reconcile_failed','Chưa xác minh được đúng mã GHN cần huỷ.'); }
            if (($found['status'] ?? '') !== 'cancel') {
                $response = lnl_crm_ghn_http('/v2/switch-status/cancel',array('order_codes'=>array($code)),'POST');
                if (is_wp_error($response)) { return $response; }
                $body = $response['body']; $accepted = false;
                if ($response['http'] === 200 && ($body['code'] ?? null) === 200 && is_array($body['data'] ?? null)) {
                    foreach ($body['data'] as $row) {
                        if (($row['order_code'] ?? '') === $code && ($row['result'] ?? null) === true) { $accepted = true; }
                        elseif (($row['order_code'] ?? '') === $code && ($row['result'] ?? null) === false) { return lnl_crm_ghn_error('ghn_rejected',is_string($row['message']??null)?$row['message']:'GHN từ chối huỷ vận đơn.'); }
                    }
                }
                if (!$accepted) { return lnl_crm_ghn_error('ghn_reconcile_failed','Chưa xác nhận GHN đã huỷ đúng mã vận đơn. WooCommerce chưa đổi trạng thái.',502); }
            }
        }
        if ((int) $wpdb->get_var($wpdb->prepare('SELECT IS_USED_LOCK(%s) = CONNECTION_ID()', $lock)) !== 1) { return lnl_crm_ghn_error('ghn_reconcile_failed','Đã mất khóa đơn; đối soát trạng thái trước khi tiếp tục.'); }
        $order->update_meta_data('_lnl_ghn_last_status','cancel');
        $order->update_status('cancelled','CRM Bán hàng: đã xác minh huỷ đơn và vận đơn GHN.');
        return lnl_crm_ghn_reload($id);
    } catch (Throwable $e) {
        return lnl_crm_ghn_error('ghn_metadata_persist_failed','Chưa lưu/xác minh được trạng thái huỷ WooCommerce. Đối soát trước khi gửi lại.',502);
    } finally {
        try { $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock)); } catch (Throwable $e) { /* Fail closed until connection release. */ }
    }
}
add_action('woocommerce_order_details_after_order_table', 'lnl_crm_ghn_display_code');
add_action('woocommerce_admin_order_data_after_shipping_address', 'lnl_crm_ghn_display_code');
}
