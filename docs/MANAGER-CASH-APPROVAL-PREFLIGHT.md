# Manager tự duyệt phiếu Sổ quỹ

Yêu cầu ngày 19/10/2026: Manager được tự duyệt phiếu mình tạo. Nhân viên được chỉ định duyệt vẫn không được tự duyệt.

## Thay đổi đã chuẩn bị

- API `src/app/cash-routes.ts`: kiểm vai trò thật ở server; trả `canSelfApprove` cho Manager; giữ ngưỡng duyệt, kiểm quyền truy cập két và audit. Audit ghi thêm `selfApproved`.
- `trial-ui/cash.js`: hiện nút Duyệt cho phiếu của chính mình chỉ khi server cho tự duyệt.
- `tests/app/cash.test.ts`, `tests/app/cash-ui.test.ts`: kiểm Manager tự duyệt, bấm lặp chỉ ghi một lần, nhân viên được chỉ định vẫn bị chặn.
- Cập nhật chính sách trong `docs/CASH.md`, `docs/POS.md`, `docs/PHAN-QUYEN.md`, `docs/CASH-PREFLIGHT.md`.

## Migration đã được duyệt ngày 19/10/2026

Migration `migrations/postgres/20261019020235_manager_cash_self_approval.sql` được tạo bằng Supabase CLI sau khi anh duyệt. Database trước thay đổi có `chk_cash_approval_actor`, cấm `approved_by = created_by` cho mọi vai trò. Cần bỏ đúng constraint này và bỏ khai báo tương ứng trong `src/modules/sales/cash-schema.ts`:

```sql
ALTER TABLE public.cash_entries DROP CONSTRAINT IF EXISTS chk_cash_approval_actor;
```

Không thêm bảng/cột, không sửa migration cũ, không thay RLS/grants hoặc số dư. Không tự duyệt phiếu đang chờ trên production. Nhân viên được chỉ định vẫn bị API chặn tự duyệt; truy cập trực tiếp của anon/authenticated vẫn bị thu hồi theo migration Sổ quỹ hiện có.

Phải chạy migration mới trước khi dùng API mới, vì constraint cũ sẽ làm thao tác tự duyệt của Manager bị rollback. Sau triển khai kiểm tra constraint đã bỏ, RLS/grants vẫn nguyên và test các vai trò. Việc duyệt phiếu vẫn do Manager bấm trong giao diện.

Đã áp dụng migration lên Supabase `taceqfnsorewelsbdckg` ngày 19/10/2026 sau khi anh duyệt. Xác minh: CHECK tự duyệt đã bỏ, bốn CHECK tiền/trạng thái/chiều phiếu/lý do huỷ vẫn còn; RLS bật; anon/authenticated vẫn không có SELECT/INSERT/UPDATE trực tiếp. Không duyệt phiếu thật khi kiểm tra.
