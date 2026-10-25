# Nhập hàng NCC: CRM → n8n → OpenClaw UI Sapo → callback

Phạm vi source: CRM, contract/điều phối consumer và lịch dispatch. Consumer mới cần nối adapter OpenClaw live trước rollout; chưa sửa workflow live, chưa thao tác Sapo hoặc gửi production webhook. Không tự merge/deploy.

## Triển khai phối hợp

1. Phía n8n chuẩn bị nhận **schema_version 1** dưới đây, hai action riêng biệt, claim trước mọi thao tác UI và callback đúng schema. Consumer cũ (`source: quote_web`, `items[].quantity`) không tương thích; phải chuyển đồng bộ trước khi mở gửi phiếu mới. Không tự thay workflow trong PR này.
2. Áp dụng migration `migrations/postgres/20261023220000_supplier_receipt_outbox.sql`, rồi triển khai API/UI sau khi được duyệt. Migration chỉ thêm cột/bảng/index; không gán ID cho dữ liệu cũ, không đẩy phiếu cũ và không thay tồn kho. CLI Supabase trong sandbox bị chặn ghi thư mục cấu hình home; migration SQL được lưu theo thư mục migration PostgreSQL hiện hành của repo, kiểm chứng bằng PGlite.
3. Cấu hình `SAPO_GOODS_RECEIPT_WEBHOOK_URL` trỏ webhook HTTPS của n8n (host `n8nthai.moarchvn.com`, đường dẫn `/webhook/...`). Entrypoint hiện có giá trị mặc định `https://n8nthai.moarchvn.com/webhook/sapo-goods-receipt-from-quote-web`.
4. n8n/Claw dùng credential hiện có cho vùng `sapo-sync` (`Authorization: Bearer` theo cấu hình server); không đặt token trong payload/URL/link Sapo. Không cần API Sapo.
5. Cài lịch `supabase/supplier-receipt-cron.sql` (tái dùng `sapo_sync_call` và Vault từ `sapo-cron.sql`) **sau review**; hoặc một lịch n8n gọi dispatch mỗi phút. Chọn một nguồn lịch. API thử giao ngay sau commit qua `waitUntil`; lịch khôi phục job sau restart. Script được commit, chưa thực thi production. Batch tối đa 4 job song song, mỗi HTTP timeout 45 giây; failed/no-claim hoặc callback_pending/no-claim chỉ thử lại sau 5 phút. Không tự chạy lại tác vụ Sapo đã claim.

## Outbox và lease

`POST /purchase-orders/:id/receipts` ghi phiếu nhận, dòng, biến động kho CRM theo hành vi hiện hành và job vào cùng transaction. Không thêm bất kỳ nghiệp vụ tồn kho mới. Callback/claim/reconcile không ghi tồn CRM hoặc Sapo.

Job duy nhất theo receipt ID, có payload snapshot và SHA-256, số lần gửi, lỗi gần nhất. Thiếu SKU/giá/CK/VAT/NCC giữ `needs_review`, không gọi webhook; kho không hợp lệ bị từ chối trước khi ghi nhận. Giá 0, CK 0, VAT 0 hợp lệ; null không tự đổi thành 0. Chỉ gửi số lượng đạt > 0. Giá/thuế lấy dòng đơn mua, ưu tiên confirmed_purchase_discount kể cả bằng 0.

State: queued → callback_pending khi HTTP nhận việc → processing khi Claw claim → done sau callback đã xác minh. Claim có thể xảy ra trước HTTP trả về. Lỗi gửi HTTP → failed (chưa được claim mới được giao lại); callback lỗi, xung đột hoặc lease thực thi hết hạn → needs_review. HTTP 2xx không ghi `done`. Callback có thể tới trước HTTP trả về; dispatcher không ghi đè done/processing/needs_review hoặc failed do callback đến trước HTTP response.

Lease giao HTTP 60 giây và lease thực thi 15 phút độc lập. Cả hai claim bằng transaction/row lock. Claw nhận HTTP webhook phải gọi claim, chỉ execution nhận 200 mới được thao tác UI. Execution nhận 409 phải dừng, không được tạo phiếu. Nếu lease thực thi hết hạn, không tự claim lại để tạo; chuyển đối soát. Mọi callback thay đổi dữ liệu bắt buộc gửi `lease_token` từ claim hiện tại; callback chưa claim/sai token bị 409. Chỉ replay thành công đã xác minh giống toàn bộ liên kết là no-op. Callback lỗi giữ token cũ để nhận kết quả xác minh muộn, chặn tự tạo lại và chặn huỷ phiếu CRM khi chưa rõ kết quả Sapo; chỉ yêu cầu đối soát mới được thay thế lease sau khi hết hạn.

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

Không gửi giá sau CK thay cho `unit_price`. Không gửi hàng hỏng. Payload đã commit bất biến khi retry; không tự tái dựng giá sau khi đã gửi.

Ngoại lệ tương thích ĐVT: `items[].unit` được trim, thiếu/rỗng thì lấy `products.unit` theo **SKU chính xác**, vẫn trống thì dùng `Cái`. Áp dụng lúc tạo job nhận hàng/đối soát và trước dispatch/claim job cũ chưa chạy. Việc chuẩn hoá và cập nhật SHA-256 nằm trong transaction khoá job, trước khi trao lease. Không sửa payload worker đang xử lý; không tái đọc giá, CK, VAT, số lượng hay ghi tồn. Receipt ID và idempotency key giữ nguyên. Nếu CRM đã lưu bất kỳ liên kết Sapo nào, job tạo mới không được dispatch/claim/retry; Manager phải yêu cầu đối soát. Với phiếu chưa có liên kết CRM, n8n/Claw vẫn phải tra cứu Sapo trước khi tạo (CRM không có API Sapo để thay bước này).

Giao diện giữ nút gửi lại trước khi chờ xác nhận, dùng `data-receipt-retry` và `data-receipt-reconcile` (nút submit đối soát). Nút không tìm thấy không làm mất thông báo lỗi backend; chỉ phục hồi trạng thái nếu nút còn trong DOM. HTTP 200 với `sent:false, skipped:false` cũng hiển thị lỗi giao việc. Không tự retry production để kiểm thử.

## Endpoint và callback

Các đường dẫn dưới đây nằm sau prefix API nhân viên hiện hành `/api/staff` (qua Edge tương ứng).

- `POST /integrations/sapo/goods-receipt-jobs/dispatch` — `sapo-sync`; body `{}` quét tối đa 4 job queued/failed/callback_pending/processing đến hạn; processing hết lease chuyển needs_review, không dispatch. `{ "crm_receipt_id":"..." }` giao một job queued/failed chưa có lease. Không trả payload/credential trong response.
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
  "lease_token":"<bắt buộc từ claim hiện tại>",
  "message":"Đã xác minh completed, đúng NCC/kho/SKU/số lượng trên UI Sapo",
  "error":null
}
```

Success bắt buộc đủ ID số, code, link đúng host và purchase order ID. Kết quả ghi receipt + job + lịch sử trước/sau cùng transaction. Sapo ID ở từng receipt là nguồn liên kết chính; không dùng một trường ID trên đơn mua để đại diện nhiều đợt nhận. Một Sapo receipt ID chỉ gắn một receipt CRM.

Lỗi: `ok:false`, cùng version/action/key/order/receipt, message/error mô tả trong execution n8n. CRM lưu thông báo tổng quát thay vì lưu chuỗi lỗi bên ngoài có thể chứa token. Job chuyển needs_review và giữ lease token; có thể gửi callback thành công cùng token sau callback lỗi nếu chưa có thế hệ đối soát mới. Không chạy lại bước tạo.

## Đối soát phiếu cũ

Manager gửi `reason` (3–500 ký tự) và `expected` gồm đầy đủ các trường API receipt hiện tại:
`sapoPurchaseOrderId, sapoReceiptId, sapoReceiptCode, sapoReceiptUrl, sapoVerifiedAt, sapoStatus, sapoUpdatedAt`.

CRM kiểm tra đúng bản hiện tại, không có lease đang chạy, lưu lý do/before và tạo thế hệ đối soát `reconciliationId`. Job chuyển action **reconcile_existing**, payload có `crm_order_id, crm_receipt_id, crm_receipt_code, expected, reason, reconciliation_id`, cùng schema_version/source/idempotency_key. Các khối crm_order/crm_receipt/supplier/warehouse/employee/items giữ snapshot lúc nhận nếu job đã có; chỉ phiếu legacy chưa có job mới đọc bản ghi hiện hữu. Không lấy giá/CK/VAT hiện tại thay snapshot đã gửi. Action này **chỉ được tra cứu, không tạo phiếu Sapo**.

Claw claim và xác minh phiếu trên UI Sapo, trả callback chuẩn kèm `reconciliation_id`. Callback chỉ được thay liên kết nếu bản CRM vẫn trùng expected và đúng thế hệ đối soát. 409 cũ không tự bị bỏ qua. Phiếu thiếu ID nhưng done thủ công không nhận callback tạo thông thường.

Test/mock: DMH_20261022_004 / PNH_20261022_004, CRM order `ea306b3a-da8d-4e31-aa36-7a0f1a8112c1`, receipt `4986310e-4ab7-40b6-bd02-90ed7db14391`, Sapo PO `59291546`, receipt `58865407`, code `PCN10826`. Không gửi webhook hoặc sửa dữ liệu thật để kiểm thử trường hợp này.


## Điều tra 25/10/2026 và giới hạn xác minh

- Working tree sạch trước thao tác; đã `git switch main` + **`git pull origin main`**, base `3051dcffeed8d57ccaa27be1cd3998833e7840c0`; nhánh `fix/supplier-receipt-sapo-workflow`. Checkout source: `/workspace/baogiabachngan_v2`, remote GitHub `bachngan-vigifts/baogiabachngan_v2`. Các nhánh cũ được giữ nguyên.
- `.github/workflows/deploy-api.yml` chỉ triển khai `supabase/functions/baogia-v2-api` từ main. Lần deploy API thành công gần nhất quan sát qua GitHub API: commit `d00ed916461d0254cf0ae8257246bbe745c1318a`, run [40168922466](https://github.com/bachngan-vigifts/baogiabachngan_v2/actions/runs/40168922466). Outbox ở base main mới nhất không khác commit đó. Đây là bằng chứng pipeline deploy, chưa đọc fingerprint runtime production.
- Máy này không có `/home/node/.openclaw/workspace/work/sites/`; ba script người dùng nêu không có trong main. Đã kiểm tra filesystem, remote/history, repo khác, environment/credential mechanism và API n8n; xem [báo cáo điều tra chi tiết](SUPPLIER-RECEIPT-LIVE-DISCOVERY.md). API n8n bị Cloudflare1010 chặn; chưa có nguồn runtime Claw truy cập được. Không chỉnh archive/handoff.
- HTTP 503 của PNH_20261025_001 / DMH_20261016_059 chứng minh endpoint từ chối giao việc; không chứng minh Sapo chưa được tạo. Chưa đọc execution/Sapo của phiếu thật, chưa retry hoặc sửa phiếu thật.
- Lỗi code đã tái hiện: dispatch batch chỉ nhặt queued, bỏ failed sau 503; callback chưa claim vẫn ghi done; callback lỗi giải phóng lease làm mất dấu execution chưa rõ kết quả; đối soát tái đọc giá hiện tại. Các trường hợp này có test PGlite.

## Nối consumer vào OpenClaw live (chưa thực hiện)

`scripts/sapo_goods_receipt_from_quote_web.js` là **module điều phối mới, chưa phải browser adapter live**. Không có URL/Sapo API hoặc selector phỏng đoán. `runSupplierReceipt({crm,sapo,notification})` nhận dependency:

- `crm.claim({crm_receipt_id})`: POST claim được bảo vệ sapo-sync, throw nếu HTTP không 2xx; trả lease/payload authoritative. `crm.callback(body)`: POST result, throw nếu HTTP lỗi. Credential từ cấu hình worker, không nằm trong notification.
- `sapo.searchPurchaseReceipts({crm_receipt_id,receipt_code,order_code})`: tìm đủ ba tham chiếu trong **đơn nhập/phiếu nhập**, trả `{complete:true,matches:[document]}` chỉ sau tra cứu đầy đủ. Timeout, phân trang chưa đủ, tài liệu chưa rõ loại/trạng thái/khớp UUID phải throw hoặc `complete:false`. Không suy luận “không có” từ màn hình đang tải. DMH chung cho nhiều PNH không được dùng để nhận nhầm phiếu khác; adapter phân biệt theo UUID/PNH và kiểm DMH nguồn.
- `sapo.lookup(kind,reference)`: đọc master-data UI trả danh sách `{id,name,...}`; warehouse ID được ưu tiên, nếu không thì tên chính xác. Supplier ưu tiên **sapo_id** (không nhầm CRM id), MST rồi tên; employee tên chính xác hoặc sapo_id; product SKU chính xác (giữ số 0 đầu). Không tự tạo NCC/sản phẩm. Trùng tên/MST/mã hoặc thiếu → needs_review.
- `sapo.createPurchaseOrder(payload)`: chỉ tạo **purchase order**, lưu ba tham chiếu CRM UUID/PNH/DMH và metadata từng dòng để đọc lại; giữ note, ngày nhận, đơn vị, số lượng đạt/giá/CK/VAT, dùng ID đã resolve. Không có phương thức tạo đơn bán.
- `sapo.activatePurchaseOrder(id)`, `sapo.receiveAllGoodItems(id,{items,received_date})`: kích hoạt rồi nhận đủ hàng đạt **một lần**; adapter phải xác minh đúng đơn trước mỗi click. Bất kỳ timeout/không rõ sau click đều throw, tuyệt đối không lặp click tạo.
- `sapo.readPurchaseReceipt(id)`: đọc lại UI đã persist, trả document chuẩn `{kind:'purchase_order',id,status:'completed',receipt_status:'received',receipt_id,receipt_code,url,crm_receipt_id,crm_receipt_code,crm_order_code,received_date,warehouse,supplier,employee,items}`. items có `crm_line_id,sku,unit,good_quantity,unit_price,purchase_discount_percent,vat_percent`; không tự điền giá trị kỳ vọng từ request vào readback.

Điều phối claim trước, validate null/giá 0, lookup trước tạo và lần nữa sau resolve master-data, tạo → activate → receive → readback, rồi callback đủ ID/code/link. Existing phải đúng loại/đã nhận đủ và toàn bộ dữ liệu khớp; draft/partial/mismatch → needs_review. Reconcile chỉ tra cứu/callback, không gọi create/activate/receive. Callback thành công thất bại đường truyền thì retry **nguyên body callback đã lưu trong execution**; không chạy lại phần tạo. Adapter/n8n phải giữ body callback trong dữ liệu execution bền vững, không log lease hoặc secret công khai.

Đã thêm `deploy_n8n_supplier_receipt_v1_staged.js` dưới dạng **compiler offline**, không phải script deploy live đã được đối chiếu. Nó đọc export bán hàng rồi tái dùng node OpenClaw `/hooks/agent`/credential reference/agent/session/model; chỉ thay task nhập hàng, xuất workflow inactive. Không yêu cầu checkout adapter riêng: tái dùng browser/tools của session bán hàng, hoặc nhúng `runSupplierReceipt` vào handler/helper hiện có. Cần kết nối host OpenClaw để đối chiếu kiểu handoff live và chạy acceptance staging trước khi tuyên bố hoàn tất end-to-end. Khi rollout phải đồng bộ consumer có claim với CRM callback bắt buộc lease; consumer cũ không claim sẽ nhận 409.

## Kiểm thử hồi quy

- `node --import tsx --test tests/app/supplier-receipt-outbox.test.ts tests/app/supplier-receipt-consumer.test.ts`
- Các test warehouse-lifecycle/receipt buttons/link/early receipts kiểm tra không cộng tồn lần hai và không huỷ kho khi kết quả Sapo chưa rõ.
- Typecheck + UI build; toàn bộ network/Sapo/mail dùng mock. Cron SQL đã đối chiếu cấu trúc với lịch hiện có và tài liệu Supabase; chưa cài hoặc kiểm chứng thực thi pg_cron trên môi trường hosted.


## Worker IO và workflow staging offline

`receiptCrmClient` trong `scripts/supplier_receipt_worker_io.js` dùng base API được cấu hình + SAPO_SYNC_TOKEN hiện có; không redirect credential, timeout 30s, không in raw lỗi/provider body. `callback()` lưu body vào `receiptResultJournal` trước HTTP; mỗi receipt/lease có file riêng0600 dưới dir0700, atomic rename + fsync. Chỉ mục file SHA-256 không chứa token/mã phiếu. `replayResult(receiptId,leaseToken)` gửi lại nguyên callback đã lưu và không claim/tạo đơn. Không đặt journal trong repo/public web root. Đây là credential ngắn hạn, chỉ host worker được đọc.

Ví dụ nhúng vào handler trên **cùng host/session hiện có**, không chạy khi chỉ import module:

```js
import {receiptCrmClient,receiptResultJournal} from './supplier_receipt_worker_io.js';
import {runSupplierReceipt} from './sapo_goods_receipt_from_quote_web.js';
const crm=receiptCrmClient({baseUrl:process.env.CRM_STAFF_API_BASE,token:process.env.SAPO_SYNC_TOKEN,
  journal:receiptResultJournal(process.env.RECEIPT_RESULT_JOURNAL_DIR)});
// existingSapoHelpers là helper UI của runtime hiện có theo contract ở trên.
await runSupplierReceipt({crm,sapo:existingSapoHelpers,notification});
// Khi chỉ callback lỗi mạng: await crm.replayResult(receiptId,leaseToken);
```

Dựng workflow không gọi mạng hoặc ghi production:

```sh
node scripts/deploy_n8n_supplier_receipt_v1_staged.js \
  --sales-workflow /secure/export-sales-workflow.json \
  --crm-base https://crm-staging.example/api/staff \
  --out /tmp/supplier-receipt-staged.json
```

Chỉ hỗ trợ node HTTP generic `/hooks/agent` có credential reference và routing literal đã đối chiếu. Nếu có nhiều node dùng `--handoff-node`; nếu source dùng Execute Command/subworkflow hoặc routing expression phụ thuộc node cũ, compiler dừng để patch theo source thật, không đoán node. Không nhúng token vào JSON. Output inactive, từ chối ghi đè file. Chưa import/activate workflow; nếu rollout đường webhook cũ phải xử lý workflow trùng path có kiểm soát. HTTP202/runId chỉ là accepted/callback_pending. Task agent phải tự claim và xác minh kết quả Sapo trước callback. Giao thức đã đối chiếu [OpenClaw docs](https://docs.openclaw.ai/automation/cron-jobs/webhooks); chưa khẳng định phiên bản/kiểu handoff live tương thích.
