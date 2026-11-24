# Menu thao tác dòng POS

Tham khảo hướng dẫn chính thức KiotViet: https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-tra-cuu-san-pham/tra-cuu-san-pham/ (mục xem chi tiết ngay trên dòng bán hàng). Không sao chép tài nguyên thương hiệu.

Trước: ký tự ⋮ mở một hộp chỉ có nút xóa; hộp nằm trong vùng cuộn giỏ, không có xử lý đóng ngoài/Escape hay đổi giữa các dòng. Test bổ sung chạy với UI main 2779ff6 và fixture đúng thương hiệu thất bại tại kiểm tra nút thao tác dòng.

Sau: nút SVG 32px, trạng thái mở màu xanh; menu có biểu tượng và ba thao tác xem chi tiết/tồn kho, chiết khấu, xóa dòng. Native auto popover nằm trên vùng cuộn, căn phải theo nút, lật lên khi sát đáy, đóng khi bấm ngoài/Escape/cuộn/resize. Điều hướng bằng bàn phím; dọn listener khi đóng hoặc dòng bị gỡ.

Xem tồn đọc đúng một SKU từ endpoint `/pos/catalog` hiện có với registerId/pricePolicyId hiện tại. Máy chủ giữ nguyên kiểm quyền. Không thay giá, số lượng, nghiệp vụ thu tiền hay tồn; phản hồi muộn sau đổi quầy/giỏ bị bỏ. Yêu cầu thất bại hiển thị lỗi và cho thử lại.

Kiểm chứng local: `scripts/testing/pos-reference.mjs`, Chromium tại 2214, 1812, 1440, 1280, 1024 và 390px. Test kiểm tra vị trí, top layer, bấm ngoài, Escape/Enter, chuyển giữa hai menu, xóa đúng dòng, lật ở mép dưới, lỗi đọc tồn rồi thử lại, và giữ các kiểm tra giỏ/chiết khấu/thanh toán/chuyển chế độ cũ. Fixture Minh Long khai đúng brand, không nới quyền POS. Ảnh desktop.png chỉ chứa dữ liệu local.

Không cần migration. Rollback: revert PR và deploy lại UI theo workflow hiện có. Chưa kiểm thử Safari/thiết bị thật hay phiên CRM production có đăng nhập; Popover API cần trình duyệt hiện đại. Không dùng dữ liệu hoặc ghi chứng từ production để test.
