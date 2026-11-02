# Điều chuyển đã nhận → n8n → Madam Sen (v1)

Trạng thái bàn giao: code CRM và kiểm thử cục bộ; chưa chạy migration, chưa cấu hình secret, chưa deploy. Không có kết nối quản trị n8n trong phiên này: workflow `zdRTgyHOttwFEJYh` chưa được đọc, sửa hoặc kích hoạt. Không được coi phần n8n / chứng từ đích là đã kiểm chứng.

Workflow do chủ doanh nghiệp cung cấp: **DRAFT — CRM stock transfer received → destination warehouse (v1)**, URL `https://n8nthai.moarchvn.com/webhook/crm-stock-transfer-received-v1`. Giữ inactive khi còn bất cứ URL `.invalid`, chưa có ánh xạ kho/SKU hoặc chưa kiểm thử hệ thống đích. Hệ thống đích đã được chủ doanh nghiệp chốt là **Sapo Bách Ngân**. Chưa xác minh tenant/origin và ánh xạ kho qua kết nối thực tế; không tự mặc định mã kho Sapo hay thay luồng Sapo đang chạy.

## Vòng đời CRM

Code main đã có `pending → approved → shipped → done`, `/ship`, `/receive` và `received_qty`; không phải luồng `/done` một bước trong bản mô tả cũ.

- `/ship` ghi `shipped_qty = qty` cho từng dòng và trừ kho đi. Chưa hỗ trợ chuyển từng phần trong cùng phiếu.
- `/receive` khoá phiếu bằng `FOR UPDATE`, kiểm tra trạng thái/revision/quyền nhận, ghi số thực nhận và cộng đúng kho đến. Nhận thiếu bắt buộc lý do. Từ bản thay đổi này **không tự hoàn phần thiếu về kho đi**: giữ `shipped_qty − received_qty` để đối soát; hàng chưa nhận không thuộc tồn bán. Khi tìm thấy hàng phải xử lý bằng chứng từ được duyệt riêng; không sửa lịch sử nhận.
- Trong cùng transaction, đổi `done` và chèn một outbox snapshot duy nhất cho phiếu (INSERT ON CONFLICT). Không gọi HTTP trong transaction.
- Trước activation hoặc khi tích hợp tắt: không tạo sự kiện. Không có chức năng backfill. Phiếu lịch sử/đã nhận trước đó không bị ghi lại tồn hay tự phát sự kiện.
- Tất cả dòng nhận 0: ghi outbox `succeeded` kèm `ZERO_RECEIVED_NO_DOCUMENT`, không gọi n8n, không có chứng từ đích; giao diện ghi rõ đã bỏ qua tạo phiếu rỗng.

## Migration và cấu hình — chưa thực hiện production

1. Chủ doanh nghiệp chạy tay `migrations/postgres/20261102104511_transfer_received_outbox.sql`; migration cũ `20261102120000_transfer_receive.sql` vẫn phải có. Migration mới thêm shipped_qty, settings và outbox có RLS, không cấp quyền trình duyệt; không quét/ghi lại chứng từ lịch sử. Chạy lặp không đổi activation và không tạo job. Tên file mới do Supabase CLI tạo; thêm `received_qty IF NOT EXISTS` để thứ tự migration trong database test mới vẫn hợp lệ với file nhận hàng mang timestamp tương lai.
2. Kiểm tra bằng `scripts/sql/assert-transfer-outbox.sql` (deploy gate chỉ đọc, không chạy migration).
3. Cấu hình riêng qua kho secret của Edge/n8n, không ghi giá trị vào repo/chat/log:
   - `STOCK_TRANSFER_WEBHOOK_URL`: URL webhook nêu trên.
   - `STOCK_TRANSFER_WEBHOOK_TOKEN`: n8n Header Auth nhận `Authorization: Bearer …` từ CRM.
   - `STOCK_TRANSFER_SYNC_TOKEN`: secret riêng ≥32 ký tự cho n8n → CRM, cũng dùng Authorization Bearer; không dùng cookie/token Sapo, không dùng query string.
   - `STOCK_TRANSFER_DESTINATION_ORIGIN`: origin HTTPS chính xác của hệ thống đích, không `.invalid`, không path/query. Callback chứng từ phải cùng origin, không credentials/query/hash.
4. Review/merge code và deploy sau migration. **Settings mặc định disabled**, việc deploy không bật gửi.
5. Hoàn thiện workflow, ánh xạ và kiểm thử giả trước. Bật workflow sau khi không còn placeholder. Sau đó Manager mới gọi `PUT /admin/stock-transfer-integration` với `{"enabled":true}`. Server ghi `integration_activated_at` tại lần bật đầu; tắt/bật không đổi mốc. Không nhập mốc quá khứ. GET cùng path trả enabled/mốc, không trả credential.
6. Khi dừng sự cố dùng PUT enabled false; dừng cả gửi và claim mới, callback của execution đã claim vẫn được tiếp nhận để đối soát. Phiếu nhận trong thời gian tắt không tự backfill khi bật lại.

## Payload và API

CRM gửi JSON, header `x-payload-sha256` là SHA256 hex của nguyên snapshot UTF-8:

```json
{
  "schema_version": 1,
  "event": "stock_transfer.received",
  "idempotency_key": "crm-stock-transfer:<transfer_id>:received:v1",
  "integration_activated_at": "<ISO UTC>",
  "transfer_id": "<id>",
  "transfer_no": "<PCK...>",
  "from_warehouse_id": "<id kho đi CRM>",
  "to_warehouse_id": "<id kho đến CRM>",
  "shipped_at": "<ISO UTC>",
  "received_at": "<ISO UTC>",
  "received_by": "<member id>",
  "note": "<ghi chú nhận hàng>",
  "items": [{"sku":"<SKU>","unit":"Bộ","shipped_qty":24,"received_qty":20}]
}
```

Các path dưới đây nối sau `https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff`. Mọi endpoint `/integrations/stock-transfers/*` dùng secret riêng `STOCK_TRANSFER_SYNC_TOKEN`, không chấp nhận phiên Manager thay cho secret.

- POST `/integrations/stock-transfers/claim`: `{idempotency_key,payload_hash}`. Chỉ một execution nhận `granted:true`, `claim_token`, payload snapshot gốc và hash. **Dùng payload trả từ claim làm dữ liệu nghiệp vụ có thẩm quyền**, không dùng nội dung webhook đã bị thay đổi. Lượt khác nhận `granted:false` và trạng thái/kết quả cũ: phải kết thúc nhánh, không tạo.
- Cùng key khác hash → HTTP409 `COMMAND_CONFLICT`, giữ snapshot cũ, trạng thái conflict; không cấp quyền tạo. Snapshot được kiểm tra schema/hash/mốc activation trước khi gửi và claim.
- POST `/integrations/stock-transfers/result`: `{idempotency_key,payload_hash,claim_token,status}`. Status `manual | unknown | failed | succeeded`. Chỉ claim owner được báo kết quả. Thành công cần `verified:true`, `destination_system`, `destination_id`, `destination_no`, `destination_url`. Đây là xác nhận của worker đã kiểm chứng; CRM không tự đăng nhập hệ thống đích để kiểm chứng độc lập. Cùng kết quả gửi lại an toàn; khác kết quả đã thành công bị chặn.
- POST `/integrations/stock-transfers/dispatch`: gửi tối đa 4 pending đến hạn, không đụng phiếu lịch sử/tồn. Gọi sau commit và từ nhịp `/pulse` hiện có; không thay cron Sapo/nhận NCC. Nếu không ai mở CRM, pending có thể chờ đến phiên tiếp theo; muốn SLA nền liên tục cần lịch n8n riêng gọi endpoint này (chưa tạo/kích hoạt lịch trong PR).

Claim token là mã quyền xử lý riêng từng job, không phải token đăng nhập; không hiển thị trong UI/log. Không lưu nó trong n8n static data. Lưu tham chiếu trong execution hoặc kho credential được bảo vệ để tiếp tục đối soát nếu execution dừng.

## Các node cần ghép vào workflow nháp

1. Webhook POST + Header Auth credential. Không chỉ kiểm tra token trong Code node sau khi trả ACK.
2. Validate schema/version/event/key, received_at ≥ integration_activated_at, số lượng hữu hạn `0 ≤ received_qty ≤ shipped_qty`; nếu dùng hash từ header phải đối chiếu với claim. Không cho body webhook tự chọn URL callback/hệ thống đích.
3. Gọi API claim. Chỉ nhánh `granted:true` đi tiếp. Khi 409 hoặc granted false, kết thúc với trạng thái cũ; không retry bằng key mới.
4. Dùng snapshot từ claim; chỉ giữ các dòng `received_qty > 0` để tạo chứng từ. Giữ nguyên key/hash gốc dù đã lọc dòng 0. Không tạo phiếu rỗng.
5. Ánh xạ kho CRM → kho đích, SKU và đơn vị. Thiếu ánh xạ: callback manual, không tự tạo kho/sản phẩm. Kho đi và kho đến khác nhau. Không ghi tồn CRM.
6. Tra cứu chứng từ đích theo đúng idempotency_key trước khi tạo. Nếu có sẵn phải kiểm tra đúng kho, SKU, số lượng rồi dùng lại. Nếu cần tạo, ghi tham chiếu CRM duy nhất vào chứng từ đích.
7. Đọc lại chứng từ thực tế và so kho đi/đến, tập SKU, đơn vị, received_qty và tham chiếu CRM. Chỉ callback succeeded sau khi khớp, kèm ID/số/link. HTTP202 của webhook chỉ là nhận sự kiện, không phải tạo thành công.
8. Sau request tạo bị timeout/mất phản hồi: callback unknown; chỉ tìm và đối soát chứng từ, không tự chạy node Create lần nữa. Truyền lại cùng key trong mọi callback/retry callback.

## Trạng thái và giới hạn

- `pending`: chờ gửi/claim; HTTP2xx không đổi thành succeeded. Sau ACK chưa claim, CRM có thể gửi lại **cùng snapshot** sau 5 phút; claim nguyên tử vẫn chỉ cấp quyền một lần.
- HTTP429: giữ pending, đợi ít nhất 5 phút và tôn trọng Retry-After dài hơn trước khi gửi lại. HTTP4xx khác: failed. Lỗi mạng/HTTP5xx/lease giao HTTP bị ngắt: unknown nếu chưa có worker claim/kết quả; không tự phát lại.
- `claimed`: đã cấp quyền tạo một lần. Không tự thu hồi hoặc cấp lại quyền khi hết thời gian; tránh worker cũ tiếp tục tạo song song. Execution dừng phải đối soát, không chạy lại node Create. Callback owner có thể đưa unknown/manual và hoàn tất khi đã tìm được chứng từ.
- HTTP ACK đến sau callback không ghi đè claimed/succeeded/manual/unknown. Không có handler tích hợp nào ghi lại stock_moves hoặc trạng thái nhận hàng.
- UI phiếu hiện trạng thái tích hợp và link chứng từ, không lộ payload hoặc credential. Failed/manual/unknown/conflict dừng để đối soát; PR này không có nút reset/force-create. Với unknown chưa claim, cần operator xác minh phía n8n/đích trước khi bổ sung công cụ giải quyết; không sửa DB tuỳ tiện để chạy lại.
- CRM bảo đảm ghi tồn một lần và cấp một quyền tạo cho mỗi sự kiện. **Không bảo đảm exactly-once trên hệ thống đích nếu đích không có unique/idempotency theo tham chiếu CRM.** Không dựa vào n8n static data hoặc cách “đọc thấy chưa có rồi tạo” để tuyên bố tuyệt đối không trùng.
- Không xoá key/job khi callback thành công. Nếu triển khai retention sau này, phải giữ key lâu hơn mọi thời gian retry/đối soát.

## Kiểm thử đã thực hiện và còn chờ

Cục bộ: kiểm tra receipt/outbox cùng transaction; lỗi ghi outbox rollback toàn bộ receipt; gửi lỗi sau commit không rollback receipt; nhận trùng; claim đồng thời; callback replay; hash conflict; timeout; callback trước ACK; 429; nhận 0; không backfill; activation; quyền; RLS; constraint shipped/received. Bộ test chạy PGlite và chạy PostgreSQL thật qua TEST_PG_URL (PGlite kiểm tra gửi lại tuần tự; đồng thời thực sự chỉ xác minh trên PostgreSQL).

Chưa kiểm thử: workflow nháp thực tế, xác thực Header Auth n8n, ánh xạ kho/SKU, tạo và đọc lại chứng từ đích, mạng production và secret mới. Chưa chạy migration hoặc kích hoạt production. Chỉ chuyển sang sử dụng chính thức sau khi các mục này đã qua trên môi trường thử và một phiếu có kiểm soát được chủ doanh nghiệp cho phép.

## Prompt bàn giao cho Madam Sen / OpenClaw

Có thể copy nguyên khối bên dưới; không gửi secret qua chat:

```text
Hoàn thiện workflow n8n zdRTgyHOttwFEJYh để nhận phiếu điều chuyển CRM và tạo chứng từ trên SAPO BÁCH NGÂN.

Tài liệu hợp đồng API: repo bachngan-vigifts/baogiabachngan_v2, PR #426, docs/integrations/STOCK-TRANSFER-N8N-V1.md. Đọc bản mới nhất của nhánh feat/transfer-received-outbox trước khi làm. Không chỉnh workflow Sapo/nhận NCC hiện có, không thay phiên đăng nhập Sapo, không quét phiếu lịch sử.
Webhook: https://n8nthai.moarchvn.com/webhook/crm-stock-transfer-received-v1.
CRM API base: https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff.

1. Kiểm tra workflow hiện có; giữ inactive nếu còn URL .invalid, thiếu credential hoặc thiếu mapping. Chỉ dùng credential được bảo vệ, không in token/cookie hoặc ghi vào workflow JSON/tài liệu/chat.
2. Xác minh tenant Sapo Bách Ngân, origin link chứng từ, quyền API và khả năng tạo/đọc lại chứng từ điều chuyển. Lập bảng CRM warehouse_id -> Sapo location_id, cùng mapping SKU/đơn vị. Thiếu mapping hoặc không hỗ trợ nghiệp vụ thì dừng và báo rõ, không tạo sản phẩm/kho mới. Không đoán endpoint Sapo.
3. Webhook dùng Header Auth. Validate schema_version=1, event=stock_transfer.received, mã và hash; received_at không trước integration_activated_at. CRM chỉ gửi sau khi nhận hàng đã commit, không gửi lúc duyệt/Đã chuyển.
4. Gọi POST /integrations/stock-transfers/claim bằng secret STOCK_TRANSFER_SYNC_TOKEN riêng. Chỉ granted=true mới được tạo chứng từ. Dùng payload từ claim, giữ idempotency_key/payload_hash gốc. granted=false hoặc 409 thì kết thúc, không tạo.
5. Chỉ tạo theo received_qty > 0, không theo qty đề nghị hay shipped_qty. Giữ dòng 0 trong snapshot gốc, lọc ở nhánh tạo chứng từ; không tạo phiếu rỗng. n8n không ghi tồn CRM.
6. Tra và đối chiếu chứng từ Sapo theo idempotency_key trước khi tạo; kiểm tra kho đi/đến, toàn bộ SKU/đơn vị/số lượng. Ghi tham chiếu CRM vào chứng từ. Xác minh Sapo có unique/idempotency thật hay không; nếu không có phải nêu giới hạn, không tuyên bố exactly-once bằng static data hoặc đọc-rồi-tạo.
7. Sau Create phải đọc lại và đối chiếu. Chỉ callback POST /integrations/stock-transfers/result succeeded khi verified=true; gửi key/hash/claim_token cùng destination_system=sapo_bach_ngan, destination_id, destination_no, destination_url đúng origin đã cấu hình.
8. Timeout hoặc không rõ Create đã lưu: callback unknown, chỉ tìm/đối soát; không tự chạy Create lại, đổi key hay reset claim. Thiếu mapping -> manual; lỗi nghiệp vụ chắc chắn chưa tạo -> failed. HTTP202 của webhook không phải thành công.
9. Dùng hai credential độc lập: CRM -> webhook Header Auth và n8n -> CRM sync token, mỗi mã >=32 ký tự. Thiết lập qua kho secret được phép, không gửi giá trị cho người dùng. Gửi lại cho người phụ trách CRM thông tin không nhạy cảm: tên credential, webhook URL, origin đích và bảng mapping.
10. Kiểm thử bằng fixture/môi trường thử: đúng mapping, nhận thiếu, dòng0, gửi lặp, hai execution đồng thời chỉ1 granted, cùng key khác hash, timeout sau Create, callback gửi lại, lỗi đọc lại, thiếu mapping, sự kiện trước activation. Không tạo phiếu thật để thử nếu chưa được chủ doanh nghiệp chỉ định phiếu và cho phép.
11. Chỉ activate sau khi CRM đã merge/deploy, migration đã có, cả hai bên cấu hình đủ và kiểm thử qua. Manager bật tích hợp CRM sau cùng; không backdate activation hoặc backfill.

Trả báo cáo: workflow ID/phiên bản, active hay inactive, mapping, API/loại chứng từ Sapo đã xác minh, hỗ trợ chống trùng ở Sapo, kết quả từng test và các bước còn thiếu. Không trả secret. Chưa có điều kiện nào thì nói rõ, không nhận đã hoàn thành.
```
