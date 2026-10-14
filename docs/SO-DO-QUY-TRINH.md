# Sơ đồ quy trình (`#/flow`)

Trang dạng sơ đồ: các cột giai đoạn **Khách hàng → Kinh doanh → Mua hàng → Kho hàng → Giao hàng → Kế toán**. Mỗi khối là một bước, trên khối có số việc đang chờ. Bấm vào khối sẽ mở bảng chi tiết, gồm:
- các chỉ số (bấm để mở trang danh sách);
- việc cần xử lý, mỗi việc kèm nút thao tác nhanh;
- nút nhanh của khối (tạo báo giá, thêm khách, ghi chăm sóc…).

## Ba phần, mỗi phần một file

| File | Vai trò | Sửa khi |
|---|---|---|
| `trial-ui/flow-config.js` | **Chỉ dữ liệu.** `STAGES` (cột), `NODES` (khối: cột, hàng, biểu tượng, mô tả, trang, nút nhanh), `EDGES` (mũi tên + nhãn, `alt` = nhánh phụ màu cam), `ITEM_ACTIONS` (nút trên từng việc: nhãn, câu xác nhận, API gọi), `ICONS`. | Đổi tên, vị trí khối, mũi tên, nút. |
| `trial-ui/flow-map.js` | **Phần vẽ.** Dựng khối theo cấu hình, vẽ mũi tên SVG, mở bảng chi tiết, chạy thao tác. Không chứa nghiệp vụ. | Hiếm khi. |
| `src/app/flow-routes.ts` | **API chỉ đọc** `GET /flow`. Mỗi khối là một hàm trong `NODES` (khoá trùng `id` ở `flow-config.js`), trả `{ metrics, items }` hoặc `null` khi vai trò đó không thấy khối. | Đổi cách đếm, thêm khối. |

Kiểu chữ: `trial-ui/flow-map.css`. App nối nút nhanh `open: 'new-quote' | 'new-customer' | 'new-care'` với hộp thoại có sẵn tại `flowView()` trong `trial-ui/app.js`.

## Quyền xem: dùng lại đúng scope của từng trang

- **Báo giá:** `quotationPredicate`.
- **Đơn / HĐKT / hoá đơn / công nợ:** `orderScopeFor` (Manager và kế toán thấy tất cả).
- **Giao hàng:** kho thấy tất cả, còn lại theo `orderScopeFor`.
- **Đóng gói:** Manager và kho thấy tất cả.
- **Hỏi tồn:** Manager thấy tất cả, nhân viên chỉ thấy khách mình phụ trách.
- **Chăm sóc:** hẹn của chính mình (Manager thấy tất cả).
- **Kho** chỉ thấy các khối Mua hàng / Đóng gói / Giao hàng.

Nút trên từng việc chỉ hiện khi máy chủ trả tên thao tác. Ví dụ `approve-quote` chỉ trả cho Manager. Khi bấm, API gốc vẫn kiểm tra quyền lại.

API không gọi các handler có ghi dữ liệu: `GET /packing` tự đóng phiếu, `GET /tasks` tự sinh việc.

## Thêm một khối mới

1. Viết hàm `async 'id-moi'(ctx) { … return { metrics, items } }` trong `NODES` của `src/app/flow-routes.ts`. Dùng scope có sẵn của module.
2. Thêm `{ id: 'id-moi', stage, row, title, icon, page, desc, actions }` vào `NODES` của `trial-ui/flow-config.js`, và thêm mũi tên vào `EDGES` nếu cần.
3. Nếu cần nút trên từng việc: thêm vào `ITEM_ACTIONS`, và cho máy chủ trả tên nút trong `item.actions`.
4. `tests/app/flow.test.ts` tự kiểm tra mọi khối API đều có trong cấu hình giao diện.

Không có migration.
