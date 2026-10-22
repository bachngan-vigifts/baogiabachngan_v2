# Sổ kho an toàn và kế hoạch nguồn hàng từ báo giá — 22/10/2026

## Hành vi

- `postMoves` luôn mở transaction/savepoint, đồng bộ với chốt đầu kỳ bằng advisory lock; tạo và khoá số dư theo SKU/kho trước khi kiểm tổng delta và kiểm idempotency. Mọi loại phát sinh và reverse cùng đi qua kiểm tra mở kho và chống âm; lỗi rollback toàn bộ batch.
- Duyệt đơn CRM thông thường vẫn ghi bán theo kho đã chọn. Khi sinh đơn/HĐKT kèm kế hoạch nguồn, kế hoạch được lưu bằng các phiếu đóng gói nháp hiện có: duyệt trước, xuất từng phần khi xác nhận đóng gói. Không dùng migration hay trường đánh dấu mới. Phiếu nháp không được gửi khi đơn chưa duyệt/chưa có lịch giao.
- Kho xin hàng là kho nguồn điều chuyển về kho bán. Đơn mua/xin lấy trước phải nhận về kho bán trước khi xác nhận xuất phần tương ứng. Lập yêu cầu là hành động riêng có xác nhận; mở form không tạo phiếu. Đóng form sau khi đã bấm lưu yêu cầu không huỷ yêu cầu đó.
- Kế hoạch kiểm tổng số lượng theo mã hàng, kể cả báo giá lặp cùng SKU. Mỗi nhóm nguồn có một phiếu nháp, nên phần có sẵn có thể đi trước phần chờ. Đổi kho khi đang có kế hoạch phải huỷ/lập lại phiếu; sửa số lượng tiếp tục chịu kiểm tra số lượng đã phân bổ hiện có.
- Chốt có thể chọn riêng kho bằng bộ lọc kho hiện có (`warehouseId`); không chọn giữ hành vi chốt cả phạm vi. Kho mới sạch có thể mở riêng mà không reset kho khác đã phát sinh.
- Chốt/reset không được thực hiện khi đã có phát sinh ngoài opening. Sapo âm bị chặn trước khi ghi; tối đa 10 mã trong lỗi. Kho không tạo được dòng opening khác 0 bị từ chối; không coi kho đó đã mở.
- Compare/card/status/stock-warehouses lọc kho riêng; Manager thấy đầy đủ. Thẻ kho đọc đủ lịch sử trong cùng snapshot, không cắt 1000 dòng.
- Nhận NCC bắt buộc chọn tên kho thật đang hoạt động, không dùng địa chỉ giao của đơn mua làm fallback.

## Thông báo người dùng

- `WAREHOUSE_NOT_OPENED` (409): Kho "<tên>" chưa chốt tồn đầu kỳ. Manager vào Sổ kho để chốt trước.
- `STOCK_SHORT` (409): Tồn kho không đủ: <SKU> (còn ..., cần ...). Hướng dẫn dùng điều chỉnh/điều chuyển trước khi thực hiện hoặc huỷ chứng từ.
- `WAREHOUSE_OPENING_USED` (409): nêu kho và loại phát sinh đã có; “Dùng phiếu điều chỉnh để sửa lệch”. Nút Chốt lại vẫn hiện và hiển thị lỗi server.
- `OPENING_NEGATIVE_STOCK` (409): liệt kê tối đa 10 mã Sapo đang âm.
- `WAREHOUSE_OPENING_EMPTY` (409): kho không có dòng đầu kỳ khác 0, chưa được coi đã chốt; cần marker/migration được duyệt nếu muốn hỗ trợ mở kho rỗng.
- `STOCK_NOT_PACKED` (409): kho chưa xác nhận xuất đủ cho chuyến giao; xác nhận đóng gói từng phần trước khi giao. Áp dụng cho đơn CRM có kế hoạch chưa ghi bán toàn bộ ở lúc duyệt, cộng dồn các chuyến đã/đang giao để không dùng một phần xuất cho hai chuyến.
- `STOCK_PLAN_INVALID` (400): tổng nguồn hàng không bằng số lượng đơn. `STOCK_PLAN_IN_USE` (409): cần huỷ/lập lại phiếu kế hoạch trước khi đổi kho.
- Nhận NCC vào kho không hợp lệ: 400, không lưu phiếu.
- Giữ `POS_STOCK_SHORT` khi bán quầy thiếu tồn và `TRANSFER_SHORT` khi điều chuyển thiếu tồn. Guard trước chốt dùng cùng `WAREHOUSE_NOT_OPENED` cho mọi luồng.

## Kiểm thử

Kết quả đã chạy:

| Lệnh / phạm vi | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| `npm test` sau đồng bộ main | 807 | 0 | 31 |
| Hồi quy sau vá dispatch: `sales.test.ts`, `warehouse-sales.test.ts` | 19 | 0 | 0 |
| Hồi quy sau mở kho được chọn: `inventory.test.ts`, `stock-guards.test.ts` | 20 | 0 | 1 |

Full suite có 838 test, chạy trước hai bổ sung cuối (guard dispatch và chọn riêng kho khi chốt). Sau các bổ sung đã chạy lại toàn bộ các file bị ảnh hưởng như bảng trên; không cộng số đếm các lượt vì có test trùng nhau. `npm run typecheck` và `npm run ui:build` đều exit 0. CI GitHub của commit đầu d3679e3 đã thành công; commit chốt cần lượt CI mới, trạng thái mới nhất trong Validation của PR #242.

30 skip của full suite là các kiểm thử đối chiếu repo legacy không có trong môi trường; 1 skip mới là cạnh tranh hai connection PostgreSQL thật. Không coi các ca skip là đã kiểm chứng.

### Test mới


tests/app/stock-guards.test.ts

- postMoves: mọi loại ngoài opening bị chặn trước chốt, kể cả batch có opening hoặc kho đã mở
- điều chỉnh âm: kiểm tổng delta cùng mã, rollback cả dòng dương và số dư mới
- postMoves/reverseRef: idempotency, nhiều chứng từ cùng mã, reverse thiếu tồn rollback
- nhận NCC: kho chưa mở / kho lạ / kho trống không lưu phiếu, không dùng địa chỉ đơn làm fallback
- huỷ phiếu nhận: hàng đã đi tiếp bị chặn; đủ tồn huỷ được và không cộng/trừ lại khi replay
- đóng gói CRM đủ tồn: ghi đúng một lần; điều chỉnh dương vẫn hoạt động
- điều chuyển done: cả kho đi và đến phải mở, phiếu và hai kho rollback
- POS bán quầy chưa chốt: lỗi rõ WAREHOUSE_NOT_OPENED và không tạo đơn/thu tiền
- hai lần xuất cuối cùng trên harness PGlite nối tiếp: chỉ một thành công
- hai kết nối PostgreSQL đồng thời tranh tồn cuối (FOR UPDATE thực)

tests/app/quote-sourcing-ui.test.ts

- nguồn hàng UI: lập kế hoạch 2+1, chỉ xin hàng khi bấm, giữ tham chiếu và không gửi trùng
- nguồn hàng UI: đặt NCC nháp đúng nguồn báo giá; xin giao trước giữ clientKey
- nguồn hàng UI: mất kết nối sau gửi không cho bấm lặp mù; đóng form không tạo yêu cầu

Bổ sung trong inventory.test.ts: mở kho mới được chọn không reset kho khác đã có phát sinh, vẫn kiểm tra phạm vi; chốt với Sapo âm/kho rỗng rollback; kho chưa mở nhưng có lịch sử không được chốt; đã có điều chỉnh không được reset; thẻ kho 1006 dòng có dòng mới nhất và tồn đúng.

Bổ sung trong warehouse-sales.test.ts: kho riêng ẩn cả bốn API, Manager thấy đủ; kế hoạch 50+20 duyệt trước/xuất từng phần/huỷ hoàn đúng, chặn giao trước khi xuất đủ và không dùng một phần xuất cho hai chuyến; kế hoạch sai tổng rollback; HĐKT lưu kế hoạch và duyệt không trừ toàn bộ.

Bổ sung trong order-create-ui.test.ts: gửi stockPlan và warehouseId cùng đơn, giữ ghi chú riêng.

Stock-guards có hai trường hợp đóng gói và hai trường hợp duyệt đơn (chưa chốt / vượt tồn) chạy bằng vòng lặp. Test Promise.all trên PGlite chỉ xác nhận các transaction được tuần tự hoá. Test hai connection PostgreSQL thực được SKIP: PGlite harness chỉ một connection và Docker socket không được cấp quyền. Không tuyên bố đã kiểm chứng cạnh tranh FOR UPDATE trên hai connection thật.

### Fixture cũ thay đổi — không nới quy tắc

- audit-fixes.test.ts: setup mở Kho 1 với LY1=100 trước khi mô phỏng xuất/huỷ. Test huỷ đơn đổi kỳ vọng số dư cuối từ 0 sang 100 để hoàn đúng đầu kỳ; giữ nguyên kiểm tra reverse +4 và trạng thái chứng từ.
- order-progress.test.ts: setup mở Kho Cần Thơ LY1=100 trước khi xác nhận đóng gói. Test tiến trình có thêm dòng opening khi kiểm thẻ kho, vẫn kiểm nguyên dòng issue -10.
- packing.test.ts: combinedFixture mở kho COMBINED=10 trước các test lịch giao + phiếu và xác nhận kho.
- purchasing.test.ts: setup có kho nhận kiểm thử và opening; các lời gọi nhận hàng truyền kho thật rõ ràng. Các test từ chối theo quyền/số lượng vẫn giữ nguyên kỳ vọng. Không dùng địa chỉ giao của đơn mua làm kho nhận nữa.
- tasks.test.ts: riêng test việc nhận NCC tự hoàn tất mở kho và truyền kho nhận trước khi nhận đủ hàng; không thay luật tự hoàn thành việc.
- inventory.test.ts: nhận NCC với tên kho không có thật đổi kỳ vọng 201 thành 400; bổ sung reset sau nhận NCC phải 409.
- warehouse-sales.test.ts: test lịch sử kiểu Sapo trước đây xuất 8 từ đầu kỳ 6, dựa vào tồn -2. Fixture mới đầu kỳ 10, còn 2 sau xuất, về 10 sau reverse; tổng nhập 18. Giữ kiểm lọc/phân trang/tồn luỹ kế/link chứng từ.

Các test dùng chung fixture đã sửa:


audit-fixes.test.ts

- đơn nháp: Kế toán xem được nhưng không huỷ / gửi duyệt đơn của người khác; người phụ trách thì được
- huỷ đơn: phiếu đóng gói / chuyến giao còn mở huỷ theo, hàng đã đóng ghi đảo về kho; đơn huỷ không giao, không ghi thu được
- Kế toán: thu tiền không ghi ngày tương lai, không thu vượt; hoá đơn chỉ nhập cho đơn đã duyệt; công nợ lọc còn nợ / đã thu đủ
- giữ hàng: báo giá đã lập đơn không giữ thêm (đơn đang giữ)

order-progress.test.ts

- tiến trình: hàm thuần – bước theo đơn có / không in, bước hiện tại, lối tắt
- tiến trình: duyệt → kho xác nhận đóng gói → việc In mẫu → việc Sản xuất → Manager hoàn thành nhanh / bỏ đánh dấu
- tiến trình: đơn không in chỉ có Duyệt → Xuất kho → Giao hàng; Manager bấm "Xong" một bước = xong cả các bước trước

packing.test.ts

- yêu cầu đóng gói: chia nguồn hàng → mỗi nguồn một phiếu (gợi ý thùng + cân nặng); gửi kho → việc nhóm Kho; kho xác nhận kèm 1–3 ảnh
- yêu cầu đóng gói - giao hàng: đơn có phí in → giao về xưởng in; nhà xe / xưởng mới gõ trong ô tự vào danh sách
- đơn đã giao xong → phiếu đóng gói còn treo tự hoàn tất (đã gửi kho → đã đóng, nháp → huỷ); lọc Đã đóng / Chưa đóng
- gộp lịch giao + phiếu: một lần lưu, một nguồn gửi kho ngay, đúng quyền và không tạo lại khi bấm lặp
- gộp lịch giao + phiếu: nhiều nguồn giữ nháp, lỗi ngày/xưởng/số lượng không để lại lịch hoặc phiếu dở
- lịch giao dùng chung: cộng mã lặp để chặn vượt số lượng; lịch đã có vẫn lập/gửi phiếu mà không tạo chuyến mới
- người nhận đơn khác người mua: API lịch giao và đóng gói dùng đúng cặp, không ghép SĐT người mua

purchasing.test.ts

- lập đơn mua: từ báo giá + HĐKT, chia 2 NCC, chống mua trùng, sửa nháp đúng người
- duyệt → xác nhận thay NCC → nhận từng đợt → Sapo → thanh toán nhiều lần
- việc tự sinh + sơ đồ: chờ duyệt → chờ xác nhận → nhận hàng (kho) → nhập Sapo (kho) → trả NCC (kế toán)
- giao diện đơn mua: không chèn HTML thô
- email NCC: hỏi tồn (ai xem đơn cũng gửi, không kèm giá) / gửi đơn (Manager – Kế toán, đơn đã duyệt); ghi lịch sử
- gửi email đơn đặt hàng từ máy chủ (Resend): kèm PDF, người nhận theo đơn, quyền, lỗi dịch vụ, chưa cấu hình
- lưu giá nhập khi chưa duyệt: chỉ Manager, đơn vẫn nháp, ô giá trống = chưa có giá, chống ghi đè bản cũ
- địa chỉ giao hàng bắt buộc: tạo nhiều NCC nguyên tử và sửa nháp không xoá địa chỉ
- đơn mua của nhân viên là nháp, chỉ vào hàng chờ duyệt khi bấm "Gửi duyệt"; Manager lập thì vào thẳng
- badge đơn mua: đếm toàn bộ tìm kiếm trên server, độc lập trạng thái/giới hạn, đúng quyền và tiến độ
- số đỏ menu: việc chưa hoàn tất, phạm vi đơn, cập nhật ngay khi hoàn tất và không đếm trùng
- nhập đơn mua từ file NCC: mỗi số đơn một đơn "đã duyệt + NCC đã xác nhận", số đã giao thành phiếu nhận không cần Sapo, nhập lại không trùng
- Sale Admin/Kế toán: đủ sáu thao tác đơn mua trên API, giữ chặn Sale/Kho/NCC và audit người bấm
- purchase source pages include all quotes without duplicates, retain search and reject invalid offsets
- tên hàng trên đơn mua NCC luôn là tên đầy đủ trong danh mục (dòng báo giá gõ gọn "Bộ trà 0.5" không làm thiếu tên)

## Rủi ro và triển khai

- Không sửa schema/migration/quyền/Sapo sync/cron/giá/COD/lương. Không sửa hoặc xoá dữ liệu CRM live.
- Tồn âm lịch sử không tự sửa. Truy vấn read-only trước đó có 15 số dư âm; cần đối chiếu và điều chỉnh hợp lệ theo nghiệp vụ. Một phát sinh dương vẫn bị từ chối nếu sau phát sinh số dư còn âm; cần điều chỉnh đủ để đưa số dư về không âm.
- Kho chưa mở nhưng đã có phát sinh sẽ bị chặn cả phát sinh mới lẫn chốt/reset. Cần xử lý dữ liệu lịch sử riêng có phê duyệt, không lách guard bằng migration tự phát.
- Kho rỗng không thể mở bằng mô hình “có dòng opening” hiện tại. Không thêm marker khi chưa được duyệt; báo lỗi và dừng thao tác đó.
- API nguồn hàng cần triển khai trước hoặc cùng UI; UI mới chặn tạo nếu không tải được nguồn hàng. Yêu cầu điều chuyển/đơn mua đã bấm lưu là chứng từ thật dù người dùng đóng form sinh đơn.
- Đơn kế hoạch chưa giữ/trừ toàn bộ tồn khi duyệt; tồn có thể được đơn khác dùng trước. Xác nhận từng phiếu kiểm lại và có thể báo thiếu, không cho âm kho.
- Thẻ kho lấy đủ lịch sử để đúng luỹ kế; mã có lịch sử rất lớn sẽ tăng thời gian tải. Chưa thêm phân trang/server cursor trong thay đổi này.
- Đã kiểm component trong Chromium với dữ liệu giả 300 = 182 có sẵn + 118 xin kho, lưu một lần và giữ link; desktop và màn hình 390px không tràn ngang. Không gọi CRM thật. Có kiểm DOM giả lập, syntax/bundle và build; chưa kiểm toàn bộ form qua phiên đăng nhập live.

## File thay đổi

- `src/app/router.ts`
- `src/modules/inventory/api/ledger.ts`
- `src/modules/inventory/api/routes.ts`
- `src/modules/inventory/api/transfer-routes.ts`
- `src/modules/sales/api/packing-routes.ts`
- `src/modules/sales/api/pos-delivery-stock.ts`
- `src/modules/sales/api/pos-order-flow-store.ts`
- `src/modules/sales/api/pos-stock.ts`
- `src/modules/sales/api/pos-store.ts`
- `src/modules/sales/api/routes.ts`
- `src/modules/suppliers/api/purchase-routes.ts`
- `tests/app/audit-fixes.test.ts`
- `tests/app/inventory.test.ts`
- `tests/app/order-create-ui.test.ts`
- `tests/app/order-progress.test.ts`
- `tests/app/packing.test.ts`
- `tests/app/purchasing.test.ts`
- `tests/app/tasks.test.ts`
- `tests/app/warehouse-sales.test.ts`
- `trial-ui/app.js`
- `trial-ui/index.html`
- `trial-ui/inventory.js`
- `trial-ui/order-create.js`
- `trial-ui/style.css`
- `src/modules/sales/api/quote-sourcing-routes.ts`
- `tests/app/quote-sourcing-ui.test.ts`
- `tests/app/stock-guards.test.ts`
- `trial-ui/quote-sourcing.js`
