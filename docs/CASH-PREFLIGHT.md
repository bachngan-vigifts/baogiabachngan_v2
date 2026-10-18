# Sổ quỹ một két chung — phương án đã duyệt

Kiểm tra ngày 18/10/2026, khoảng 18:28 giờ Việt Nam. Chỉ SELECT trên Supabase `taceqfnsorewelsbdckg`; không ghi dữ liệu và không chạy migration Sổ quỹ.

Người dùng đã duyệt phương án và cho phép huỷ phiếu sau kết ca: giữ báo cáo, ghi audit và tra soát. Nội dung dưới đây lưu kết quả kiểm tra trước triển khai.

## Hiện trạng đã xác minh

Đã đọc `docs/BAN-HANG.md` (Sổ thu / chi, Công nợ, Huỷ phiếu thu), `src/app/cashbook-routes.ts`, migration `0071_accounting_tools.sql`, quyền `page.cashbook` / `payments.void`, `src/app/audit-routes.ts`, phần audit tự động và kho file private dùng cho ảnh kho.

| Bảng production | Số dòng | Ý nghĩa |
|---|---:|---|
| work_cash_requests | 0 | Thu/chi thủ công cũ; chưa có API/giao diện dùng |
| work_shifts | 0 | Ca cũ của module work; chưa có API/giao diện dùng |
| customer_payments | 19 | Phiếu thu khách gắn đơn hàng; không phải thu khác thủ công |
| supplier_payments | 0 | Phiếu chi NCC |

Production chưa có `pos_shifts`. Code POS trong workspace đã có `pos_shifts`, `pos_registers`, `pos_shift_templates`, kiểm đếm đầu ca, yêu cầu QR và liên kết ca vào đơn/phiếu thu; chưa merge/deploy. Sổ quỹ sẽ dùng chung ca này, không tạo một bảng ca nữa. Hai bảng work cũ giữ nguyên, không nhập dữ liệu hay sửa module lương/chấm công.

Truy vấn information_schema cho thấy `customer_payments` production chưa có `voided_at`, `voided_by`, `void_reason` của migration 0071. Cần kiểm tra/áp dụng migration nền còn thiếu trước khi đưa API mới lên. Không tự chạy vì lần này chỉ được đọc DB.

`#/cashbook` hiện là báo cáo thu khách + chi NCC, gồm cả chuyển khoản, không phải số dư két. Giữ trang đó và thêm `#/cash` cho két cửa hàng. Không tự đưa 19 phiếu thu cũ vào két mới; số đầu kỳ do Manager nhập phải phản ánh thời điểm bắt đầu vận hành, tránh cộng tiền lịch sử hai lần.

## Mô hình đề xuất

Một dòng cấu hình két cửa hàng; các quầy POS cùng trỏ đến két đó. Đề xuất **một ca chịu trách nhiệm két đang mở tại một thời điểm**, dùng chung cho POS và Sổ quỹ, có khoá giao dịch và unique index. Đây là ca bàn giao két theo người giữ ca, không phải tài khoản quỹ của từng người. Không để hai ca cùng nhận số dư ca trước và cùng đếm một két.

Giữ kiểu tiền `double precision` đang dùng trong repo; server và CHECK bắt buộc số nguyên VNĐ, hữu hạn, trong giới hạn an toàn. Phiếu có số tiền dương, chiều thu/chi riêng. Mặc định ngưỡng duyệt 1.000.000 VNĐ lưu tại cấu hình, không hard-code trong xử lý nghiệp vụ.

### Ba bảng mới (chưa tạo)

| Bảng | Cột dự kiến |
|---|---|
| cash_drawers | id, name, approval_threshold, opening_amount, opening_reason, opening_set_at, opening_set_by, updated_at, updated_by. Một két dùng chung; đầu kỳ chỉ Manager thiết lập một lần, bắt buộc lý do; không được sửa ngược sau vận hành. |
| cash_entries | id, entry_no, drawer_id, shift_id, kind (`other_income`, `cash_in`, `petty_expense`, `advance`, `cash_out`, `adjustment`), direction (`in`/`out`), amount, reason, photo_file_key, status (`pending`/`posted`/`voided`), approval_threshold_snapshot, created_by, created_at, approved_by, approved_at, voided_by, voided_at, void_reason, reconciliation_id (tuỳ chọn), request_key unique. Ảnh chỉ lưu khoá file; một ảnh/phiếu. |
| cash_reconciliations | id, reconciliation_no unique (`TS-xxxx`), drawer_id, shift_id unique, closed_by, expected_cash, counted_cash, difference, reason_code, reason_note, explanation, explained_by, explained_at, status (`pending`/`explained`/`closed`), close_reason, resolved_by, resolved_at, created_at, updated_at. Một tra soát kết ca/ca; đóng không tự tạo điều chỉnh tiền. |

FK, index theo két/ca/ngày/trạng thái và CHECK tiền/trạng thái; RLS bật cho cả ba bảng, thu hồi truy cập trực tiếp từ PUBLIC/anon/authenticated. API server kiểm quyền.

### Cột bổ sung vào POS dùng chung

- `pos_registers.cash_drawer_id`: mọi quầy của cửa hàng dùng cùng két.
- `pos_shifts.cash_drawer_id`, `previous_shift_id`, `difference_reason_code`, `difference_reason_note`.
- Tái sử dụng `opening_cash`, `counted_cash`, `expected_cash`, `cash_difference`, `report_snapshot`, `closed_at`; unique ca đang mở theo két và unique ca kế tiếp của một lần bàn giao.
- `customer_payments` dùng lại `shift_id`, `payment_source`, `delivery_id`, `request_key` đã thêm trong POS. Không tạo phiếu thu thứ hai cho tiền bán hàng/COD.
- Phiếu điều chỉnh két chỉ Manager tạo, gắn ca két đang mở và mã tra soát nếu dùng để xử lý lệch. Phiếu lớn của chính Manager cũng không tự duyệt: cần Manager khác.

## Các phép tính phải tách rõ

**Số dư theo sổ toàn két** = đầu kỳ + thu tiền mặt khách/COD thực nhận + phiếu thủ công đã ghi (theo chiều). Bỏ chuyển khoản, phiếu chờ và phiếu huỷ. Không cộng các khoản đầu ca kế thừa vì chỉ là bàn giao, không phải tiền mới.

**Đầu ca mới** = tiền thực đếm của ca trước đã kết; ca đầu = đầu kỳ. Server tự lấy, không cho nhân viên nhập thay tuỳ ý.

**Tiền theo sổ trong ca** = đầu ca kế thừa + thu tiền mặt bán hàng/COD + thu/rút két − chi/tạm ứng/nộp két. Phiếu điều chỉnh sổ không có giao nhận tiền thực được tách riêng, tránh tính lại khoản lệch cũ sau khi ca mới đã kế thừa tiền đếm. Kết ca bị chặn nếu còn phiếu chờ duyệt; có danh sách để xử lý. Chênh lệch khác 0 cần mã lý do; `other` cần ghi chú. Ghi snapshot + tạo tra soát trong cùng giao dịch, bấm lặp không sinh trùng.

Hai số trên có thể khác vì ca trước bị lệch: giao diện phải ghi rõ số toàn két và số dự kiến của ca; không tự bù chênh lệch bằng phiếu điều chỉnh. Báo cáo ca đã kết giữ cố định; tra soát và audit ghi diễn biến tiếp theo.

**Huỷ phiếu sau kết ca — đã duyệt:** Manager/Kế toán vẫn được huỷ có lý do; giữ nguyên snapshot ca đã kết, ghi audit và đưa vấn đề vào tra soát liên quan. Không tự sửa số đếm hay đầu ca sau. Các chứng từ sau ca cần hiển thị rõ thời điểm huỷ. Quyết định đã chọn: cho huỷ sau kết ca, giữ báo cáo và tra soát.

## Danh sách file dự kiến

### Thêm

- `src/modules/sales/cash-schema.ts` — ba bảng mới.
- `src/modules/sales/domain/cash.ts` và `cash.test.ts` — tiền, dấu thu/chi, ngưỡng, lý do và trạng thái.
- `src/modules/sales/api/cash-store.ts` — giao dịch, số dư tổng hợp server, khoá két, duyệt/huỷ, bàn giao ca, tra soát.
- `src/app/cash-routes.ts` — API có kiểm quyền cho trang Sổ quỹ.
- `trial-ui/cash.js`, `trial-ui/cash.css` — DOM API, tab Sổ quỹ/Tra soát và form gọn theo hai mockup.
- `tests/app/cash.test.ts`, `tests/app/cash-ui.test.ts` — tích hợp quyền, tiền, ca, ảnh private, tra soát, Excel và XSS.
- `docs/CASH.md` — hướng dẫn và triển khai.

### Sửa

- `src/modules/sales/pos-schema.ts` — cột két/bàn giao vào ca hiện có.
- `src/modules/sales/api/pos-routes.ts`, `pos-store.ts` — dùng chung quy tắc mở/kết ca, số dư và COD với Sổ quỹ.
- `src/modules/sales/api/routes.ts` — đồng bộ quyền huỷ phiếu thu và chống huỷ làm lệch ca; kiểm tra các đường thu tiền hiện có để không thu tiền mặt vào ca không mở.
- `src/modules/staff/domain/permissions.ts` — quyền trang Sổ quỹ, xem toàn bộ cho Manager/Kế toán; dùng `payments.void` cho huỷ, duyệt/điều chỉnh chỉ Manager.
- `src/db/schema.ts` — export schema mới.
- `src/app/router.ts`, `navigation-counts.ts`, `pulse-routes.ts` — route, số đỏ tra soát và cập nhật dữ liệu.
- `src/app/audit-routes.ts` — liên kết tra soát/phiếu/ca với lịch sử. Nghiệp vụ tiền ghi audit trong giao dịch để không mất dấu khi router audit best-effort gặp lỗi.
- `trial-ui/app.js`, `index.html`, `auto-refresh.js`, `pos.js`, `pos-print.js` — menu, view, kết ca dùng chung và K80 có thu/chi/tra soát.
- `docs/BAN-HANG.md`, `docs/POS.md` — mô tả đúng sự khác nhau giữa Sổ thu/chi cũ và một két mới.
- `tests/app/pos.test.ts`, `pos-ui.test.ts`, `tests/db/migration.test.ts` — cập nhật ca dùng chung và kiểm schema.
- `migrations/postgres/meta/_journal.json` và snapshot tương ứng — sinh từ schema sau khi duyệt.

`src/app/cashbook-routes.ts` giữ API báo cáo cũ; chỉ sửa nếu cần bổ sung tham chiếu sang Sổ quỹ, không thay công thức đối soát ngân hàng cũ.

### Migration dự kiến, chưa tạo

Sau khi được duyệt, sinh hai migration mới bằng CLI (timestamp thực tế): `cash_drawer` và `supabase_access_cash_drawer`. Migration schema gồm ba bảng/cột/chỉ mục và cấu hình ngưỡng; migration access gồm REVOKE và cấp quyền trang đúng chức vụ. Chạy sau migration nền 0071 và migration POS. Không sửa lương, Sapo, cron hay phiên đăng nhập Sapo.

## Kiểm thử sẽ thực hiện sau triển khai

- Không ca: không tạo phiếu; đúng ca mới xem được; Manager/Kế toán xem đầy đủ.
- Ngưỡng lấy cấu hình; phiếu lớn chưa duyệt không vào két; người tạo không tự duyệt.
- Thu/chi nguyên VNĐ, lý do bắt buộc, ảnh tối đa một, bucket private, ký URL sau kiểm quyền.
- Bỏ chuyển khoản, COD chưa thu, phiếu huỷ và pending khỏi tiền két; phiếu bán hàng không bị ghi thu hai lần.
- Đầu ca lấy thực đếm trước; kế thừa không tạo một khoản thu giả.
- Chặn kết ca pending; lý do/ghi chú đúng; kết ca và tra soát idempotent, kể cả đồng thời.
- Nhân viên giải trình, Manager đóng có lý do; tra soát không tự sửa sổ; điều chỉnh có liên kết.
- Huỷ có lý do và audit; quy tắc ca đã kết theo lựa chọn được duyệt.
- Typecheck, toàn bộ test và build UI. Kết quả thực hiện được ghi tại PR #161 và #162; đây là bộ tiêu chí kiểm thử đã thống nhất.
