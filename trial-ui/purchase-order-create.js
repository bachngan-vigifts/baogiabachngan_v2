import { sendOnce } from './request-keys.js';
/**
 * Lập đơn mua NCC (POST /purchase-orders) có mã thao tác chống tạo trùng.
 * Cùng nội dung → cùng mã cho tới khi máy chủ xác nhận (kể cả đóng/mở lại form, tải lại trang): mất phản hồi rồi gửi lại thì
 * máy chủ trả đúng bộ đơn đã tạo. Lưu xong thì lần lập sau (dù y hệt) là mã mới → đơn mới.
 * Máy chủ so băm nội dung: cùng mã khác nội dung → 409 INTENT_MISMATCH.
 */
export function createPurchaseOrders(api, orders, storage) {
  return sendOnce('purchase-orders', orders, clientKey => api('/purchase-orders', 'POST', { clientKey, orders }), storage);
}
