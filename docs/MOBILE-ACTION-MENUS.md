# Menu thao tác trên điện thoại

Ở màn hình ≤850px, các nhóm nút nghiệp vụ dùng một nút **⋮** ở đầu trang/từng dòng hoặc **⋮ Thao tác** ở form. Bấm mở bảng thao tác có cuộn, đóng bằng ×, Escape hoặc chạm bên ngoài. Chữ nội dung 14px, nhãn/nút trên trang 13px, chú thích 12px, tiêu đề 19px; giữ font tiếng Việt hiện có. Ô nhập 16px tránh Safari tự zoom khi gõ. Trên desktop giữ bố cục nút ban đầu.

## Phạm vi và cách thêm màn hình

- Staff CRM, POS, cổng NCC, trang khách: dùng `mobile-actions-init.js`, `mobile-actions.js`, `mobile-actions.css`. Đăng ký/đặt lại mật khẩu dùng cùng thang chữ.
- Các nhóm `page-head`, `editor-actions`, `row-actions`, `head-actions`, `toolbar`, `modal-foot`, footer drawer, nhóm `*-actions`/`*-tools`/`*-footer`, ô action trong bảng được nhận diện tự động, kể cả khi tải lại dữ liệu hoặc tạo form sau đó. Thành phần mới có thể dùng `data-mobile-actions="Tên nhóm"`; `data-mobile-actions="off"` giữ nguyên các điều khiển nhập liệu/điều hướng.
- Bộ lọc, checkbox, ô số lượng, phân trang, các bước nhập liệu và dock lưu đơn không chuyển vào menu. Các nhóm chỉ gồm một nút nghiệp vụ vẫn có thể dùng cùng menu; nút đóng form vẫn truy cập được theo bố cục hiện có.
- Bảng đơn hàng/sổ quỹ ở chế độ thẻ bỏ minimum width desktop để không cắt nội dung trên điện thoại.

## Giữ nguyên hành vi

Menu chứa chính nút/link/file input đang có, giữ trong cây DOM của form/row gốc. Không sao chép sự kiện, không đổi endpoint/quyền/chứng từ. Native popover đưa menu lên trên modal mà vẫn giữ `button.form`, HTML validation, submitter và sự kiện ủy quyền. Nút `hidden`/disabled giữ nguyên trạng thái. Đổi trang/đóng dialog/đổi breakpoint đóng menu. Thiết bị thiếu Popover API giữ các nút ban đầu.

Hai chỗ chọn “button đầu tiên” đã đổi sang chọn nút nghiệp vụ cụ thể: lưu số hóa đơn và xin giao trước. Không để nút mở menu bị chọn làm nút lưu.

## Kiểm thử

```sh
PLAYWRIGHT_MODULE=/tmp/pos-browser/node_modules/playwright/index.mjs node scripts/testing/mobile-actions.mjs
PLAYWRIGHT_MODULE=/tmp/pos-browser/node_modules/playwright/index.mjs node scripts/testing/pos-mobile-scroll.mjs
PLAYWRIGHT_MODULE=/tmp/pos-browser/node_modules/playwright/index.mjs node scripts/testing/session-resume.mjs
```

Browser mock dùng DOM thật, 50 nhóm nút, ≥20 footer form, module mua NCC/POS thật; chạy 360/390/430/1280px. Kiểm nút ẩn/disabled, action thêm động, không click nhầm row, form bắt buộc/submitter, tải file mẫu thật, menu dài cuộn trong màn hình, đổi desktop/mobile không nhân đôi nút. POS kiểm thêm touch scroll tới khách/giỏ, giới hạn danh mục và phân trang ở 375/390/768/844px; desktop vẫn tải thêm được. Khởi động app thật kiểm giữ phiên/401/503 ở 390/1280px. Mọi API giả và kết nối ngoài localhost bị chặn.

Typecheck và các test UI hiện có chạy riêng. Chưa kiểm trên Safari/iPhone vật lý; chưa merge/triển khai production.
