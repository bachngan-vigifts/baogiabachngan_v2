# Nhập hàng NCC: CRM → n8n → OpenClaw UI Sapo → callback

Phạm vi PR: CRM, migration và contract. Không sửa workflow, không thao tác Sapo, không gửi production webhook. Chỉ mock trong test. Không merge/deploy trước khi Anh Thái xác nhận.

## Triển khai phối hợp

1. Phía n8n chuẩn bị nhận **schema_version 1** dưới đây, hai action riêng biệt, claim trước mọi thao tác UI và callback đúng schema. Consumer cũ (`source: quote_web`, `items[].quantity`) không tương thích; phải chuyển đồng bộ trước khi mở gửi phiếu mới. Không tự thay workflow trong PR này.
2. Áp dụng migration `migrations/postgres/20261023220000_supplier_receipt_outbox.sql`, rồi triển khai API/UI sau khi được duyệt. Migration chỉ thêm cột/bảng/index; không gán ID cho dữ liệu cũ, không đẩy phiếu cũ và không thay tồn kho. CLI Supabase trong sandbox bị chặn ghi thư mục cấu hình home; migration SQL được lưu theo thư mục migration PostgreSQL hiện hành của repo, kiểm chứng bằng PGlite.
3. Cấu hình `SAPO_GOODS_RECEIPT_WEBHOOK_URL` trỏ webhook HTTPS của n8n (host `n8nthai.moarchvn.com`, đường dẫn `/webhook/...`). Entrypoint hiện có giá trị mặc định `https://n8nthai.moarchvn.com/webhook/sapo-goods-receipt-from-quote-web`.
4. n8n/Claw dùng credential hiện có cho vùng `sapo-sync` (`Authorization: Bearer` theo cấu hình server); không đặt token trong payload/URL/link Sapo. Không cần API Sapo.
5. Thiết lập lịch phía n8n gọi endpoint dispatch để quét job queued (ví dụ mỗi phút). API tự thử giao ngay sau commit qua `waitUntil`; lịch bảo đảm job còn lại sau restart được giao. Nếu chưa cấu hình lịch, job vẫn bền vững nhưng chưa có retry nền tự động.

## Outbox và lease

`POST /purchase-orders/:id/receipts` ghi phiếu nhận, dòng, biến động kho CRM theo hành vi hiện hành và job vào cùng transaction. Không thêm bất kỳ nghiệp vụ tồn kho mới. Callback/claim/reconcile không ghi tồn CRM hoặc Sapo.

Job duy nhất theo receipt ID, có payload snapshot và SHA-256, số lần gửi, lỗi gần nhất. Thiếu SKU/giá/CK/VAT/NCC giữ `needs_review`, không gọi webhook; kho không hợp lệ bị từ chối trước khi ghi nhận. Giá 0, CK 0, VAT 0 hợp lệ; null không tự đổi thành 0. Chỉ gửi số lượng đạt > 0. Giá/thuế lấy dòng đơn mua, ưu tiên confirmed_purchase_discount kể cả bằng 0.

State: queued → callback_pending khi HTTP nhận việc → processing khi Claw claim → done sau callback đã xác minh. Claim có thể xảy ra trước HTTP trả về. Lỗi gửi/callback → failed; xung đột hoặc lease thực thi hết hạn → needs_review. HTTP 2xx không ghi `done`. Callback có thể tới trước HTTP trả về; dispatcher không ghi đè done/processing/needs_review hoặc failed do callback đến trước HTTP response.

Lease giao HTTP 60 giây và lease thực thi 15 phút độc lập. Cả hai claim bằng transaction/row lock. Claw nhận HTTP webhook phải gọi claim, chỉ execution nhận 200 mới được thao tác UI. Execution nhận 409 phải dừng, không được tạo phiếu. Nếu lease thực thi hết hạn, không tự claim lại để tạo; chuyển đối soát. Callback phải gửi `lease_token` nếu execution đã claim; callback cũ không được vượt yêu cầu đối soát mới.

Trước mọi thao tác tạo, Claw phải tìm phiếu đã có bằng tham chiếu CRM, kể cả lần gửi lại sau timeout. Nếu không rõ đã lưu Sapo chưa, không bấm tạo tiếp. CRM không thể bảo đảm tính duy nhất trên Sapo nếu consumer bỏ qua claim/tra cứu.

## Payload tạo phiếu

```json
{
  "schema_version": 1,
  "action": "create_purchase_receipt",
  "source": "crm_supplier_receipt",
  "idempotency_key": "<crm_receipt_id>",
  "crm_order": {"id":"<crm_order_id>","code":"DMH_...","note":"..."},
  "crm_receipt": {"id":"<crm_receipt_id>","code":"PNH_...","received_date":"2026-10-22","note":"..."},
  "supplier": {"id":"<CRM supplier id>","name":"...","tax_code":"..."},
  "warehouse": {"name":"KHO VIGIFTS"},
  "employee": {"id":"<CRM employee id>","name":"..."},
  "items": [{"crm_line_id":"...","sku":"...","name":"...","unit":"Cái","good_quantity":1,"unit_price":100000,"purchase_discount_percent":25,"vat_percent":8,"note":"..."}]
}
```

Không gửi giá sau CK thay cho `unit_price`. Không gửi hàng hỏng. Payload đã commit bất biến khi retry; chỉ sửa dữ liệu thiếu qua quy trình kiểm tra nghiệp vụ, không tự tái dựng giá sau khi đã gửi.

## Endpoint và callback

Các đường dẫn dưới đây nằm sau prefix API nhân viên hiện hành `/api/staff` (qua Edge tương ứng).

- `POST /integrations/sapo/goods-receipt-jobs/dispatch` — `sapo-sync`; body `{}` giao tối đa 20 job queued; `{ "crm_receipt_id":"..." }` giao một job queued/failed. Không trả payload/credential trong response.
- `POST /integrations/sapo/goods-receipt-jobs/claim` — `sapo-sync`; body `{ "crm_receipt_id":"..." }`; trả `{ "lease_token":"...", "lease_until":"...", "payload":{...} }`. 409 nếu đang có execution/needs_review/done/đã huỷ. Lease token là credential thực thi ngắn hạn, không đưa vào báo cáo công khai.
- `POST /integrations/sapo/goods-receipt-result` — `sapo-sync`; schema bên dưới. 400 sai schema/link, 404 không có receipt, 409 xung đột; callback giống đầy đủ bộ dữ liệu đã lưu trả 200 và không đổi mốc xác minh. Không chỉ so mã phiếu.
- `POST /supplier-receipts/:id/retry-sapo` — Manager; failed/callback_pending chưa có lease/done được xếp lại hàng đợi với cùng idempotency key; không tạo receipt CRM.
- `POST /supplier-receipts/:id/reconcile-sapo` — Manager; xem phần đối soát.
- `PUT /supplier-receipts/:id/sapo` — không cho đánh dấu done thủ công nữa; phiếu đã xác minh phải qua đối soát khi sửa liên kết.
- `GET /purchase-orders/:id` — thêm liên kết Sapo trên từng receipt và trạng thái job (không trả payload giá trong job). UI hiển thị link mở Sapo; done cũ chưa có verifiedAt hiển thị “Đã ghi thủ công · cần đối soát”.

```json
{
  "schema_version":1,
  "action":"goods_receipt_result",
  "idempotency_key":"<crm_receipt_id>",
  "ok":true,
  "crm_order_id":"...",
  "crm_receipt_id":"...",
  "sapo_purchase_order_id":"59291546",
  "sapo_receipt_id":"58865407",
  "sapo_receipt_code":"PCN10826",
  "sapo_receipt_url":"https://bachngankiengiang.mysapogo.com/admin/purchase_orders/59291546",
  "lease_token":"<từ claim nếu đã claim>",
  "message":"Đã xác minh completed, đúng NCC/kho/SKU/số lượng trên UI Sapo",
  "error":null
}
```

Success bắt buộc đủ ID số, code, link đúng host và purchase order ID. Kết quả ghi receipt + job + lịch sử trước/sau cùng transaction. Sapo ID ở từng receipt là nguồn liên kết chính; không dùng một trường ID trên đơn mua để đại diện nhiều đợt nhận. Một Sapo receipt ID chỉ gắn một receipt CRM.

Lỗi: `ok:false`, cùng version/action/key/order/receipt, message/error mô tả trong execution n8n. CRM lưu thông báo tổng quát thay vì lưu chuỗi lỗi bên ngoài có thể chứa token. Có thể gửi callback thành công sau callback lỗi; không chạy lại bước tạo nếu Sapo đã lưu.

## Đối soát phiếu cũ

Manager gửi `reason` (3–500 ký tự) và `expected` gồm đầy đủ các trường API receipt hiện tại:
`sapoPurchaseOrderId, sapoReceiptId, sapoReceiptCode, sapoReceiptUrl, sapoVerifiedAt, sapoStatus, sapoUpdatedAt`.

CRM kiểm tra đúng bản hiện tại, không có lease đang chạy, lưu lý do/before và tạo thế hệ đối soát `reconciliationId`. Job chuyển action **reconcile_existing**, payload có `crm_order_id, crm_receipt_id, crm_receipt_code, expected, reason, reconciliation_id`, cùng schema_version/source/idempotency_key và các khối crm_order/crm_receipt/supplier/warehouse/employee/items đọc từ bản ghi hiện hữu để đối chiếu. Action này **chỉ được tra cứu, không tạo phiếu Sapo**.

Claw claim và xác minh phiếu trên UI Sapo, trả callback chuẩn kèm `reconciliation_id`. Callback chỉ được thay liên kết nếu bản CRM vẫn trùng expected và đúng thế hệ đối soát. 409 cũ không tự bị bỏ qua. Phiếu thiếu ID nhưng done thủ công không nhận callback tạo thông thường.

Test/mock: DMH_20261022_004 / PNH_20261022_004, CRM order `ea306b3a-da8d-4e31-aa36-7a0f1a8112c1`, receipt `4986310e-4ab7-40b6-bd02-90ed7db14391`, Sapo PO `59291546`, receipt `58865407`, code `PCN10826`. Không gửi webhook hoặc sửa dữ liệu thật để kiểm thử trường hợp này.
