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

## Lịch sử sản phẩm (thẻ sản phẩm)
- Mọi biến động của một mã hàng được ghi vào bảng `product_movements`. Mỗi mã chỉ giữ **20 giao dịch gần nhất** (`PRODUCT_HISTORY_LIMIT`).
- Các loại giao dịch:
  - **Bán**: dòng đơn đặt hàng khi đơn được xác nhận. Huỷ đơn thì xoá các dòng của đơn đó.
  - **Xuất kho giao hàng**: khi phiếu giao chuyển sang *Đã giao*.
  - **Nhập hàng**, **Chuyển kho**, **Cân bằng kho**: lấy từ chứng từ Sapo khi đồng bộ.
  - **Khách trả hàng** (`/order_returns.json`) và **Trả hàng NCC** (`/purchase_returns.json`): cũng lấy từ Sapo. Hai endpoint này chưa kiểm chứng trên tài khoản thật; nếu Sapo báo lỗi thì chỉ hiện cảnh báo đồng bộ.
- Đồng bộ lại cùng chứng từ thì cập nhật dòng cũ (khoá `ref_key`), không ghi trùng.
- Migration `0020_product_movements.sql` tạo bảng và lấy lại lịch sử từ đơn đã xác nhận, phiếu đã giao và chứng từ Sapo có sẵn. Phân quyền ở `0021_supabase_access_product_movements.sql`.
- Xem: bấm tên sản phẩm ở trang **Sản phẩm**, hoặc nút **Tồn kho · Lịch sử** ở từng dòng báo giá. Thẻ sản phẩm gồm:
  - tồn các kho;
  - thống kê giá bán (gần nhất, thấp nhất, cao nhất, trung bình);
  - bảng 20 giao dịch, lọc được theo loại.
- API: `GET /products/:sku/history`.
