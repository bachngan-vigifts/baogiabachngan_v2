# Giao hàng phải có chứng từ xuất kho

## Phạm vi và nguyên nhân

Ảnh màn hình DH_20261020_005 khớp `trial-ui/app.js` của CRM. Repo có bảng lưu bản sao `vigifts_appsheet_actions`/`vigifts_appsheet_bots`, không có export cấu hình Action/Bot đang hoạt động của AppSheet. Không khẳng định đã kiểm tra hoặc sửa app AppSheet production.

Trạng thái tổng được tính từ `salesOrderLines.deliveredQty`, trong khi Xuất kho được tính độc lập từ phiếu có người/ngày xác nhận, nguồn và bút toán kho hợp lệ. Dữ liệu cũ có thể đã đủ số giao nhưng thiếu chứng từ xuất. `refreshOrderStatus()` trước đây chưa kiểm tra phụ thuộc này; tiến trình vẫn tick Giao hàng theo trạng thái tổng kể cả khi thiếu xuất.

## Luồng thống nhất

- Các nút Đã giao trên danh sách, chi tiết đơn và màn hình kho dùng `deliveryButtons()` → handler click chung `[data-ship]` → `PUT /deliveries/:id/status`. Server khóa đơn, kiểm tra `assertCrmDispatch`, ghi chuyến/số giao rồi gọi `refreshOrderStatus` trong cùng transaction.
- `refreshOrderStatus` kiểm tra `assertCrmOrderCompletion` trước mọi tác dụng khi hoàn thành đơn: trạng thái, yêu cầu hoá đơn, đóng phiếu và hạn thanh toán. Lỗi `STOCK_NOT_PACKED` rollback cùng giao dịch.
- Nút Xong / Hoàn thành tất cả của Manager dùng `/orders/:id/progress`, khóa cùng đơn và dùng cùng điều kiện hoàn thành. Đây chỉ là tiến trình theo dõi, không phải nút giao hàng hoặc phiếu xuất.
- POS quầy và POS/GHN có luồng trừ kho riêng; không tự áp điều kiện phiếu xuất CRM cho POS.
- Chọn **bắt buộc xác nhận xuất trước**, thay vì tự chọn kho/trừ kho khi bấm Đã giao. Kho/Manager xác nhận `/packing/:id/confirm`: nguồn kho ghi ledger trong transaction; nguồn NCC giao thẳng cần xác nhận nguồn, không trừ kho CRM. Tiến trình đọc lại chứng từ nên Xuất kho tự hoàn thành khi đủ từng dòng. Không ghi thêm mark để giả lập xuất.
- Giao từng phần vẫn hợp lệ khi phần giao đã có đủ xuất; chỉ hoàn thành cả đơn khi toàn bộ hàng có SKU đã được xuất đúng nguồn. Không xuất/trừ lại hàng đã có bằng chứng.

## Dữ liệu cũ và đơn trong ảnh

`reconciliationRequired` bật nếu đơn/dấu tay đã ghi giao nhưng thiếu xuất thực tế. UI hiển thị Cần đối soát xuất kho, giữ nguyên số lượng đã ghi giao và không tick Giao hàng hoàn thành. GET không sửa dữ liệu hay trừ kho.

Manager dùng `GET /api/staff/warehouse-workflow-audit` và đối chiếu đúng `orderNo`/ID, SKU, từng dòng, phiếu, kho/nguồn, người/ngày xác nhận và ledger. Chỉ xác nhận phiếu còn chờ nếu thực tế đã xuất và chưa có debit tương ứng. Phiếu nháp/thiếu chứng từ hoặc phiếu cũ tự đóng không có người xác nhận cần quy trình đối soát riêng; không tự backfill `packedBy`, không tạo debit từ nhãn Đã giao. Patch này chưa truy cập DB production, chưa sửa riêng DH_20261020_005.

## Nếu còn app AppSheet ghi cùng dữ liệu

Chưa có tên cột/Action/Bot thực tế nên các bước dưới là thiết lập cần áp vào cấu hình đã export, không phải biểu thức đã cài production:

1. Liệt kê Actions/Bots ở mọi View có ghi trạng thái đơn/chuyến, số đã giao hoặc tiến trình; bỏ quyền ghi trực tiếp các cột dẫn xuất này ở form.
2. Tất cả nút hoàn thành gọi cùng một backend command có xác thực, kiểm tra quyền/phụ thuộc và transaction; không để mỗi View tự set trạng thái. Không nhúng secret API vào biểu thức phía client.
3. `Only if` của nút dựa trên đủ xuất đúng từng dòng cho phần giao; App Formula trạng thái tổng chỉ cho hoàn thành khi **đủ giao AND đủ xuất**. Điều kiện ở UI chỉ hỗ trợ hiển thị, server vẫn phải kiểm tra lại.
4. Bot phản ứng khi chứng từ xuất được xác nhận chỉ yêu cầu backend tính lại; không tạo thêm phiếu xuất/trừ kho hoặc tự set Đã giao. Bot không được trigger lại chính cột mà nó ghi.
5. Grouped Actions/Bots AppSheet không thay thế transaction và không bảo đảm chống bấm lặp khi offline; ledger cần request key duy nhất và xử lý ở backend. Chưa có integration AppSheet → API mới được thêm trong patch này.

## Kiểm thử

`order-progress`, `warehouse-lifecycle`, `delivery-export-ui`: chặn hoàn thành thiếu xuất; rollback số giao/trạng thái; dữ liệu cũ và dấu tay không giả lập xuất; cảnh báo UI biến mất khi có đủ chứng từ. Chạy thêm packing, POS counter và GHN sync để kiểm tra luồng nguồn riêng.

## Ưu tiên GHN cho POS Ship COD và đơn web

- POS có `carrier=GHN` và mã vận đơn: không dùng nút đổi trạng thái giao tay (`GHN_STATUS_MANAGED`); webhook/pull GHN cập nhật qua `applyGhnStatus`. Huỷ vẫn theo quy trình huỷ vận đơn/thu hồi hiện có. POS giao ngoài GHN và bán tại quầy giữ luồng riêng.
- GHN đã lấy hàng → đang giao và xuất POS một lần; `delivered` → hoàn thành, số giao và COD một lần. GHN hoàn/huỷ → chuyến thất bại; không tự cộng tồn hoặc hoàn tiền trước khi nhận hàng hoàn thật.
- Đơn web: trạng thái GHN đang vận chuyển ưu tiên hơn Woo `completed`; GHN `delivered` → `completed`; GHN huỷ/hoàn/lost/damage → `cancelled` theo mapping web hiện hành. Trạng thái không nhận diện giữ trạng thái cũ.
- Không cho hoàn thành đơn web bằng tay khi đã có mã GHN. Payload website không có mã/metadata GHN không được xoá liên kết vận đơn hiện hữu. Website gửi trạng thái cũ không kéo lùi GHN đã giao thành công; sự kiện delivered lặp còn sửa được nhãn website bị lệch mà không tạo vận đơn.
- Đây là phạm vi các luồng GHN đã tích hợp (POS Lock/Minh Long, website). Không bổ sung tài khoản hay polling GHN cho chuyến CRM nhập mã tự do; chuyến CRM đó vẫn cần chứng từ xuất và tích hợp hãng tương ứng. Không tạo/retry vận đơn hay gọi GHN thật trong kiểm thử.
