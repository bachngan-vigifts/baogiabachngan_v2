/** Presentation policy only; server permissions and action handlers stay unchanged. */
export const mobileRisk = text => /h[uủ]ỷ|hủy|xoá|xóa|chốt (tồn|kỳ)|điều chỉnh|hoàn tiền|đồng bộ sapo/i.test(text);
export const mobileCommit = text => /lưu|gửi|xác nhận|nhận hàng|nhận theo phiếu|thu tiền|thanh toán|duyệt|đã giao|đang giao|hoàn thành|đóng phiếu/i.test(text);
export function actionKind(node){
 // Explicitly read-only navigation may contain status text such as ‘chờ duyệt’.
 if(node.matches('[data-mobile-navigation]'))return 'inline';
 if(node.classList.contains('mobile-desktop-only'))return 'desktop';
 const text=(node.getAttribute('aria-label')||node.textContent||node.title||'').trim();
 if(node.matches('label')||node.querySelector('input,select,textarea'))return 'inline';
 // Phân trang luôn nằm tại chỗ: gom vào ⋮ thì mỗi lần sang trang phải bấm hai lần.
 if(/^(‹\s*)?(trang )?(trước|tiếp|sau)(\s*›)?$/i.test(text)||/^[‹›«»]$/.test(text))return 'inline';
 if(node.closest('dialog')&&/^(huỷ|hủy|đóng|quay lại)$/i.test(text))return 'inline';
 // Giao diện điện thoại có đủ nút như PC: nút rủi ro (huỷ/xoá/điều chỉnh…) không ẩn nữa, chỉ gom vào menu ⋮ "Thao tác" (thao tác vẫn hỏi xác nhận như PC).
 if(/^(xo[áa]|xóa|bỏ) (bộ )?lọc$/i.test(text.normalize('NFC')))return 'inline';
 if(mobileRisk(text))return node.closest('dialog,#view-order,.sup-drawer,[data-mobile-confirmation-page]')?'inline':'secondary';
 if(mobileCommit(text)||node.matches('[data-mobile-primary],[data-mobile-inline],.btn-add,.btn.primary'))return 'inline';
 if(/gọi|báo giá|hồ sơ|đóng|quay lại|xuất (excel|file)|tải file mẫu|thêm sản phẩm/i.test(text))return 'inline';
 return 'secondary';
}
