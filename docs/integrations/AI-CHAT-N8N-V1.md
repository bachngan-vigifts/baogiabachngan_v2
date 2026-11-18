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
