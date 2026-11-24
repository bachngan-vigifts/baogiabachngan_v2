# #801 — Việc 2 B: Manager điều chỉnh đơn NCC đã duyệt

Phụ thuộc B1 #812 và B2 #813; giữ nháp khi các phần trước còn chờ điều phối. Không merge, deploy, chạy migration hay dùng dữ liệu production.

## Bằng chứng trước/sau

Trên main c37c9683, test đầu tiên trong `tests/app/purchase-amend.test.ts` gửi POST `/purchase-orders/a1/amend` nhận 404 thay vì 200 (`/tmp/amend-before.log`). Sau sửa, cùng test giữ ID dòng, giữ số lẻ 123456.5 và chuyển sang chờ NCC xác nhận lại.

GET/POST `/purchase-orders/:id/amend` chỉ Manager đang hoạt động. POST bắt buộc revision và lý do; khoá nguồn chung rồi khoá đơn, kiểm lại chứng từ trong transaction. Giữ PUT nháp hiện có. Không đổi NCC. Không thay công thức tiền: dùng computeOrderTotals/buildSchedules hiện có.

Đơn chưa có chứng từ: giữ ID dòng/nguồn còn dùng, chỉ xoá dòng không tham chiếu, kiểm ngân sách nguồn toàn cục. Chỉnh thương mại xoá xác nhận NCC, tăng revision và ghi audit before/after đầy đủ cùng transaction. Portal hiện “Đã điều chỉnh – chờ NCC xác nhận lại”; xác nhận từ màn hình NCC cũ bị 409.

Có lịch sử phiếu nhận, thanh toán/cọc (kể cả đã huỷ), trả hàng/hoàn tiền, file ký, giao NCC, early allocation, job, hoá đơn/chia sẻ điều chuyển hoặc mốc chứng từ: chỉ sửa ghi chú. Không hạ SL đặt dưới SL đã nhận, không ghi lại tiền/tồn cũ. Không tự gửi email/push hoặc gọi dịch vụ ngoài.

Audit chứa snapshot đầy đủ, supplierOrderEvents chỉ giữ tóm tắt + auditId/revision. Người thiếu quyền giá không đọc được lý do tài chính trong event. Toàn bộ snapshot không bị cắt ở 8 KB.

## Kiểm tra đã chạy

- `node --import tsx --test --test-concurrency=2 tests/app/purchase-amend.test.ts tests/architecture.test.ts`: đạt. Chín kịch bản amend gồm quyền/validation, nhận8 đặt10, lịch sử chứng từ, nguồn, xác nhận NCC cũ, audit rollback/snapshot lớn, không đổi giá trị hiệu lực, lịch trả/concurrent revision, quyền audit.
- Hồi quy `purchase-draft-lines`, `purchase-discount-review`, `purchase-order-intent`, `supplier-workspace-live`, `supplier-workspace-review`: 5/5 file đạt.
- `npx tsc --noEmit`, `npm run ui:build`: mã thoát 0.
- `scripts/testing/purchase-amend.mjs`: full CRM + API fixture/PGlite, Chromium 390px/1280px; mất ACK sau commit → giữ form/giá lẻ; retry revision cũ → 409 và đúng một audit; đơn có nhận hàng chỉ ghi chú. Không JS error/overflow. Mọi request ngoài localhost bị chặn. Ảnh ở `/tmp/codex3-amend/` (không commit dữ liệu ảnh).

## Triển khai và rollback

Không có migration mới. Sau khi B1/B2 và phụ thuộc POS được điều phối thông qua: deploy API rồi UI theo workflow sẵn có. Migration B1 phải chạy/qua assert trước API theo quy trình #779; phần này không tự chạy.

Rollback riêng commit Việc2 rồi deploy API/UI cũ, giữ audit đã ghi. Không đảo dữ liệu đơn/tiền/tồn tự động. Khi rollback endpoint amend biến mất và PUT nháp vẫn như cũ.

## Giới hạn còn lại

Chỉ PGlite và Chromium cục bộ, chưa Safari/thiết bị thật/PostgreSQL nhiều kết nối hoặc production. Các ca concurrent fixture kiểm revision/transaction nhưng không thay thế thử tranh chấp trên PostgreSQL. Lịch trả cũ bất thường hoặc tổng mới dưới khoản hẹn cố định bị 409 yêu cầu cập nhật kế hoạch rõ ràng; UI ban đầu không chỉnh kế hoạch trả trong dialog này. B1 còn chờ nguồn kho nhận có cấu trúc; B2 chờ #811 theo điều phối. Không coi các PR phụ thuộc đã xanh toàn bộ chỉ vì bộ test của phần này đạt.
