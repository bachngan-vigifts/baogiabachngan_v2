# Chat cùng AI – hợp đồng n8n v1

CRM gửi `POST` đến secret `AI_CHAT_WEBHOOK_URL`, header `Authorization: Bearer <AI_CHAT_WEBHOOK_TOKEN>`.

Payload chính:

```json
{
  "schema_version": 1,
  "action": "answer_public_crm_question",
  "question": { "id": "uuid", "text": "...", "topic": "CRM", "author": { "id": "...", "name": "...", "positionId": "sale" } },
  "visibility": "all_employees",
  "rules": ["..."],
  "callback": { "url": "https://crm.minhlongonline.com/api/staff/integrations/ai-chat/<id>/result", "token": "one-time uuid" }
}
```

n8n chuyển nguyên câu hỏi và quy tắc cho OpenClaw. Khi có kết quả, n8n gọi đúng một lần:

```http
POST <callback.url>
Authorization: Bearer <callback.token>
Content-Type: application/json

{"status":"answered","answer":"Nội dung trả lời tiếng Việt"}
```

Trường hợp cần người kiểm tra: `{"status":"needs_review","error":"Lý do"}`. Lỗi dứt điểm: `{"status":"failed","error":"Lý do"}`. Token callback bị xóa sau kết quả hợp lệ, không được ghi log hoặc đưa vào tin nhắn.

Secrets Edge Function cần cấu hình:

- `AI_CHAT_WEBHOOK_URL`
- `AI_CHAT_WEBHOOK_TOKEN` (ít nhất 32 ký tự)
- `AI_CHAT_CALLBACK_ORIGIN=https://crm.minhlongonline.com`

## Kiểm tra trước triển khai

Chạy migration `migrations/postgres/20261118040000_ai_chat_public_questions.sql`
trước khi deploy API/UI. Gate `scripts/sql/assert-ai-chat-public.sql` được nối vào
workflow deploy ở transaction READ ONLY: kiểm tra cột, khóa, index, trạng thái,
RLS và không cấp quyền trực tiếp cho PUBLIC/anon/authenticated. Thiếu schema sẽ
chặn deploy; gate không tự chạy migration hoặc sửa dữ liệu. Migration chưa được
áp dụng lên production trong bản sửa PR #719.

Callback dùng cập nhật có điều kiện theo ID + hash token + trạng thái còn chờ;
hai phản hồi đồng thời chỉ một phản hồi được ghi. Callback sai/nội dung không
hợp lệ không tiêu thụ token; kết quả đến muộn sau lỗi webhook vẫn được chấp nhận
khi token còn hiệu lực. Không tự gửi lại khi chưa biết n8n đã nhận câu hỏi hay chưa.

Kiểm thử local (không gọi webhook/CRM production):

```sh
npm run typecheck
npm run ui:build
node --import tsx tests/app/ai-chat.test.ts
node --import tsx tests/db/ai-chat-public.test.ts
node --import tsx --test tests/architecture.test.ts tests/app/mobile-nav-order.test.ts tests/db/november-migration-gates.test.ts tests/app/sapo-sync.test.ts
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx scripts/testing/ai-chat-smoke.mjs
```

Browser fixture dùng CRM/router + PGlite thật với dữ liệu tổng hợp, kiểm tra
Manager/Nhân viên ở 390/1440px: menu Công việc, gửi câu hỏi, nhận callback, hiển
thị câu trả lời được escape, hữu ích và tìm kiếm; chặn request ngoài local. Ảnh
và kết quả ở `/workspace/artifacts/pr719-ai-chat`. Chưa xác minh tích hợp n8n thật.
