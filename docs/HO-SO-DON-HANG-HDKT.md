# In đơn đặt hàng và hồ sơ HĐKT

## Đơn đặt hàng (trang đơn → **In / Tải đơn hàng**)
- Mẫu theo đơn đặt hàng của Minh Long:
  - Đầu trang: tên công ty và "Phòng Kinh Doanh", tiêu đề **ĐƠN ĐẶT HÀNG**.
  - Thông tin đơn: Số ĐH, Số CT (số báo giá), tên và mã khách hàng, ngày đặt, MST, địa chỉ giao, liên hệ.
  - Bảng hàng: STT, Mã hàng, Chủng loại, ĐVT, SL đặt, SL giao, Ngày giao, Ghi chú. Có thể bật thêm Đơn giá và Thành tiền.
  - Dòng Tổng cộng, phần Ghi chú, ngày lập và 4 chữ ký: Người đặt, Người tiếp nhận, Người phụ trách, Người soạn.
- Bấm vào chữ trên phiếu để sửa trước khi in. Phần sửa chỉ áp dụng cho bản in này, không ghi lại vào đơn.
- **In / Lưu PDF**: in khổ A4 ngang qua trình duyệt.
- **Tải Excel**: file `.xlsx` cùng bố cục.
- Mã nguồn: `trial-ui/order-print.js`.

## Hồ sơ HĐKT (trang đơn → ô HĐKT → **Xem / sửa / tải hồ sơ HĐKT**, hoặc nút **Hồ sơ** ở danh sách HĐKT)
- Dùng lại nguyên mẫu Word của web báo giá cũ. Pháp nhân **VG** dùng bộ mẫu VIGIFTS; **BN** và **QTV** dùng bộ mẫu Bách Ngân.
  - `mau-hop-dong-*-hdkt.docx`: hợp đồng kinh tế
  - `mau-hop-dong-*-tam-ung.docx`: đề nghị tạm ứng
  - `mau-hop-dong-*-bien-ban.docx`: biên bản bàn giao và nghiệm thu
- Bộ dựng chép từ web cũ (`contract-document.js`): mẫu `.docx` có các trường `<<[Trường]>>`, dòng sản phẩm nhân theo đơn. Mô tả từng dòng lấy "Bộ gồm / In ấn / Đóng gói" từ báo giá. Các file được nén bằng `fflate.min.js`.
- **Xem trước**: dùng `docx-preview.min.js` và `jszip.min.js` (lưu sẵn trên web, không gọi CDN), hiển thị trong khung riêng.
- **Thông tin điền mẫu** (dùng chung cho 3 hồ sơ): người đại diện, chức vụ, ngày ký, % tạm ứng, số ngày thanh toán, thời gian giao, địa điểm giao, phương thức thanh toán.
- **Sửa trực tiếp**: bấm vào đoạn văn hoặc ô bảng để gõ (`contract-word-edit.js` của web cũ). Mỗi đoạn sửa lưu theo mã băm của đoạn gốc.
  - Khi đổi thông tin điền mẫu, cần **Dựng lại** những hồ sơ đã sửa trực tiếp.
- **Tỉ lệ cọc và số ngày thanh toán** luôn lấy theo HĐKT đã lập (khớp kỳ công nợ). Điều khoản thanh toán: cọc 100% → "thanh toán 100% giá trị hợp đồng trước khi giao hàng"; cọc 0% → "thanh toán 100% giá trị hợp đồng sau N ngày kể từ ngày giao hàng" (N = 0 → ngay sau khi giao hàng); cọc X% → X% ngay sau khi ký, phần còn lại trong vòng N ngày kể từ ngày giao hàng. Áp dụng cho cả mẫu Bách Ngân và VIGIFTS (đề nghị tạm ứng VIGIFTS không còn cố định 30%). MST Bách Ngân: 1801686576. Nhãn "VAT (8%)" theo thuế suất thật của các dòng.
- **Lưu chỉnh sửa**: ghi `{ details, edits: { HDKT, TAM_UNG, BBNT } }` vào cột `sales_contracts.data` qua `PUT /contracts/:id`. Không cần migration.
- **Tải**:
  - **Tải bộ 3 file (.zip)**: file `HDKT_<số HĐKT>.zip` gồm `HDKT.docx`, `TAM_UNG.docx`, `BBNT.docx`.
  - Có thêm nút tải riêng file Word đang xem, và nút in hồ sơ đang xem.

## Lịch sử bán theo mã hàng
- Mỗi dòng (có mã hàng) của đơn đặt hàng **đã xác nhận** được ghi vào bảng `product_sales_history`. Mỗi mã chỉ giữ **10 lần bán gần nhất** (`SALES_HISTORY_PER_SKU`).
- Khi huỷ đơn, các dòng của đơn đó bị xoá khỏi lịch sử.
- Migration `0020_product_sales_history.sql` lấy lại lịch sử từ các đơn đã xác nhận có sẵn. Phân quyền ở `0021_supabase_access_product_sales_history.sql`.
- Xem: nút **Lịch sử bán** ở từng dòng báo giá (cạnh *Xem tồn kho*) và ở trang Sản phẩm.
  - Hiện giá bán gần nhất, thấp nhất, cao nhất, trung bình.
  - Từng lần bán: ngày, khách hàng, NV phụ trách, đơn hàng, số lượng, đơn giá (sau CK, chưa VAT), VAT.
- API: `GET /products/:sku/sales-history`.
