# Bách Ngân – Báo giá & CRM (v2)

Viết lại từ `bachngan-vigifts/bach-ngan-bao-gia` theo kiến trúc module. Giữ nền tảng:
Cloudflare Workers + vinext, D1 (+ Neon, R2), Drizzle, shadcn/ui.

## Chạy

Test đối chiếu với code bản cũ (`tests/legacy/`) cần repo cũ đã `npm ci`: đặt `LEGACY_REPO=/đường/dẫn/bach-ngan-bao-gia` (hoặc để thư mục đó nằm cạnh dự án này). Không có thì các test này tự bỏ qua.

```bash
npm install
npm run typecheck     # TypeScript strict
npm test              # toàn bộ test (node:test + tsx)
npm run db:generate   # sinh migration khi đổi schema
npm run docs:data-model
npm run docs:ncc      # ma trận nút bấm của trang NCC (sinh từ máy trạng thái)
```

## Cấu trúc

```
src/
  core/            hạ tầng dùng chung (db, lỗi, tiền tệ...) – không biết gì về nghiệp vụ
  db/schema.ts     điểm tập hợp schema cho drizzle-kit
  modules/<tên>/   mỗi module tự chứa: schema.ts · domain/ (hàm thuần) · repo/ (truy vấn Drizzle) · api/ (route) · ui/ · *.test.ts
migrations/        SQL do drizzle-kit sinh; riêng 0001 (trigger) viết tay. KHÔNG xoá cả thư mục để sinh lại – thêm migration mới
tests/             test xuyên module (schema, tương thích bản cũ, kiến trúc)
docs/              ROADMAP.md · DATA-MODEL.md (tự sinh)
```

## Quy tắc để dự án không rối lại

1. Module chỉ import theo chiều `nghiệp vụ → staff → core`; `tests/architecture.test.ts` chặn vi phạm và vòng phụ thuộc.
2. Logic nghiệp vụ (tính giá, đánh số, phân quyền) viết thành hàm thuần trong `domain/`, test không cần DB.
3. Mọi thay đổi bảng đi qua `src/modules/*/schema.ts` + `npm run db:generate`; không `CREATE TABLE` lúc chạy.
4. Mọi route khai báo khu vực truy cập (`Area`); tài khoản NCC chỉ vào `self` và `supplier-portal`. Báo giá: chủ không đổi (trigger DB), người phụ trách (`assignee_id`) được ưu tiên – đã giao thì chỉ manager đổi.
5. Cột `text(..., { enum })` ở bảng mới phải có `enumCheck(...)` (Drizzle không tự tạo ràng buộc DB); test chặn nếu thiếu.
6. Đổi bảng cũ phải qua `tests/db/legacy-compat.test.ts` (không mất cột, không đổi kiểu).
7. Không đưa dữ liệu thật (SĐT, email, snapshot) vào repo.
8. Hàm thuần trong `domain/` được đối chiếu với bản cũ bằng test ngẫu nhiên (`*.legacy-diff.test.ts`) trước khi coi là port xong.
