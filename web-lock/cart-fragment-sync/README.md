# Hợp nhất cập nhật fragments giỏ hàng

Trạng thái: bản thử, chưa triển khai. Không tự nạp file JS này bằng workflow hiện có.

## Bằng chứng và phạm vi

Ngày 14/11/2026, HTML công khai trang giỏ hàng nạp wc-cart-fragments-js và một đoạn inline có biến lnlCartRefreshing. Đoạn đó bắt ajaxComplete của action=flatsome_ajax_cart_item_alter_quantity, tự POST get_refreshed_fragments, replace fragments, rồi trigger cả wc_fragments_refreshed và updated_wc_div. WooCommerce cũng refresh fragments khi nhận updated_wc_div.

replacement.js thay toàn bộ đoạn inline đó bằng một listener chỉ yêu cầu wc_fragment_refresh. WooCommerce chịu trách nhiệm request, thay DOM, cập nhật storage và thông báo hoàn tất. Các phản hồi thay đổi số lượng liên tiếp trong 250 ms được gom thành một yêu cầu refresh.

Đây là hợp nhất đồng bộ mini-cart, không thay endpoint cập nhật số lượng, không gom request thay đổi số lượng của Flatsome, không thay tính giá/thuế/vận chuyển. Chưa xác nhận main cart sử dụng action này; cần bắt Network của cả main cart và mini-cart. Không cam kết sửa toàn bộ độ trễ hoặc chỉ còn một request tổng cộng.

## Cài thử

1. Tìm nơi xuất đoạn lnlCartRefreshing trong theme con, MU plugin hoặc Code Snippets. Mã gốc này chưa có trong repo; workflow cPanel đã kiểm tra chỉ đọc cấu hình, không triển khai JS.
2. Sao lưu đoạn gốc cùng trạng thái bật/tắt. Thay toàn bộ script cũ bằng replacement.js ở cùng vị trí, sau jQuery và wc-cart-fragments. Không nạp hai đoạn song song; không sửa theme cha hoặc WooCommerce core.
3. Chỉ triển khai sau khi xác định mã gốc và kiểm tra không còn cơ chế khác refresh cùng action. Nếu Flatsome đã trả đủ fragments, có thể bỏ hẳn bridge sau khi kiểm thử.
4. Xóa cache trang/tài nguyên liên quan theo cấu hình thực tế.

## Kiểm thử

Đã kiểm logic JS bằng Node VM: bỏ qua request không liên quan, HTTP lỗi, action gần giống; gom phản hồi trong cửa sổ chờ; phát đúng wc_fragment_refresh; lần cập nhật tiếp theo vẫn hoạt động. Chưa chạy trên WordPress staging/live.

Trên staging: thử tăng/giảm từng lần và bấm nhanh trên main cart lẫn mini-cart; sửa số lượng bằng bàn phím; thử hai dòng hàng, voucher, hết hàng và lỗi mạng. Kiểm tổng tiền, phí vận chuyển, số lượng, header badge và mini-cart sau reload/chuyển trang. Theo dõi Network để đảm bảo không có chuỗi refresh bổ sung do updated_wc_div từ đoạn cũ. So sánh thời gian request và tổng thời gian giao diện ổn định trước/sau; không dùng thời gian tool tự động hóa làm thời gian máy chủ.

Giới hạn: timer gom các phản hồi đã hoàn thành, không khóa mọi refresh toàn trang hoặc bảo đảm chỉ một request đang chạy. Không loại bỏ global event handlers của WooCommerce/Flatsome.

## Hoàn tác

Khôi phục nguyên đoạn gốc và gỡ bản thay thế tại cùng vị trí; xóa cache liên quan, thử lại một giỏ mới. Không thay sản phẩm, đơn hàng, khách hàng hay dữ liệu cấu hình thanh toán.
