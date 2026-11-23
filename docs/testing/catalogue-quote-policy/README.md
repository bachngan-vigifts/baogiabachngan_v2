# Chính sách giá riêng cho báo giá catalogue

Sau khi chọn sản phẩm, vào **Tạo báo giá → Chính sách giá của báo giá này → Điều chỉnh chính sách giá**.

- **Giá niêm yết:** giá chào = giá niêm yết × (1 − CK/100) + phí in + ship + gói quà + cà phê.
- **Giá vốn:** giá chào = (giá vốn + các phí trên) ÷ (1 − biên lợi nhuận/100). Nhập giá vốn riêng từng SP; thiếu vốn thì dùng công thức giá niêm yết, có cảnh báo ngay cạnh kết quả. Nhánh vốn không trừ CK thêm.
- Mọi phí nhập theo **đồng/một sản phẩm**, cùng cơ sở VAT với giá nguồn; không tự thêm VAT lần nữa. Tổng phí lô cần chia theo số lượng trước khi nhập. Catalogue là tập phương án sản phẩm, không tự coi tổng số lượng các phương án là một đơn bán.
- Ví dụ vốn 104.000, tổng phí 16.000, biên 20% → giá 150.000 đồng. Lợi nhuận 30.000/150.000 = 20%, khác cách cộng 20% trên vốn.
- Giới hạn CK 0–100%, biên 0–95%, từng phí tối đa 100 triệu, giá cuối một SP tối đa 10 tỷ. Kiểm tra ở cả giao diện và API.

Popup cho xem trước giá từng SP rồi mới áp dụng. Chính sách bật sẽ thay giá tự nhập của SP bằng công thức; chọn **Dùng giá từng sản phẩm** để trở lại giá trước đó. Giá bộ 10 nhân 10 sau tính toán; SP Liên hệ giữ nguyên. Khi tính lại, hỏi xác nhận đặt lại chữ đã sửa trên trang sản phẩm để tránh giá chữ cũ che giá mới; giữ nội dung bìa/trang kết.

Chỉ lưu trong `settings.quotePolicy` của JSON báo giá hiện có. Không sửa thư viện/giá CRM, không cần migration; triển khai API hỗ trợ trường mới trước UI. Báo giá cũ giữ nguyên giá, báo giá mới không thừa hưởng chính sách báo giá trước. Gộp giữ chính sách của từng trang nguồn; chỉnh nguồn rồi gộp lại nếu cần đổi giá.

Giá vốn do người lập nhập trong popup, không tự mở quyền đọc giá vốn CRM. Bản báo giá hiện là tài liệu dùng chung cho nhân viên có quyền catalogue, nên các thông tin nội bộ này cũng thuộc phạm vi đó. PDF/PowerPoint chỉ xuất giá chào, không xuất vốn, biên và các trường chi phí nội bộ.

Kiểm thử: `tests/app/catalogue-quote-policy.test.ts` kiểm tra công thức, giá thiếu vốn, Contact, bundle10, bật/tắt, độc lập báo giá, lưu/mở/cập nhật API, input sai/giá vượt ngưỡng, canvas/PPT 4/6/8 SP và gộp nguồn. Hồi quy catalogue-quotes, catalogue-price-visibility, catalogue-merge, catalogue-crm-products. Chromium kiểm tra popup 1280 và 390 px, nhập/sửa/xem giá/áp dụng, không tràn ngang; toàn bộ dùng dữ liệu minh hoạ.
