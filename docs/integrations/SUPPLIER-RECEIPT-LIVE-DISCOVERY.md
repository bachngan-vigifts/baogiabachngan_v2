# Điều tra nguồn live NCC/Sapo — 25/10/2026 UTC

Đây là bằng chứng quan sát trong môi trường Codex hiện tại, không phải xác nhận trạng thái Sapo. Không deploy, activate workflow, merge, gửi webhook hoặc retry PNH_20261025_001 / DMH_20261016_059.

## Checkout và lịch sử đã kiểm tra

| Vị trí/nguồn | Branch/commit | Kết quả |
| --- | --- | --- |
| `/workspace/baogiabachngan_v2` | main `3051dcffeed8d57ccaa27be1cd3998833e7840c0`; nhánh sửa `fix/supplier-receipt-sapo-workflow`, commit ban đầu `8e7ff18bc881caad872a2b0269bb2d5a34626c74` | Working tree sạch trước điều tra; `git pull origin main` thành công, đã cập nhật. Các thay đổi tiếp theo chỉ trên nhánh PR #309. |
| `/home/node/.openclaw/workspace/work/sites/crm-pos-lock-ghn-source-handoff` | Không thể đọc branch/SHA: đường dẫn không tồn tại | `/home/node` không tồn tại; không tự coi nhánh remote nào là checkout này. |
| `/home/node/.openclaw/workspace/work/sites/crm-pos-lock-ghn-sync` | Không thể đọc branch/SHA: đường dẫn không tồn tại | Không thể đối chiếu working tree trên host OpenClaw từ máy hiện tại. |
| `/home/node/.openclaw/workspace/work/sites/baogiabachngan-v2-n8n` | Không thể đọc branch/SHA: đường dẫn không tồn tại | Không coi bản cũ này là live. |
| `/home/node/.openclaw/workspace/scripts/{sapo_goods_receipt_from_quote_web.js,deploy_n8n_supplier_receipt_v1_staged.js,create_n8n_sapo_goods_receipt_from_quote_web_workflow.js,supplier_receipt_contract_v1.js}` | Không tồn tại trên máy hiện tại | Không đọc/patch giả các script ngoài repo. Các script mới trong PR là source mới, không phải bản sao đã xác minh từ runtime. |
| Remote `origin/chore/lock-ghn-bridge-source` | `1b9d95d2b44547cd5e3ad811507bcfa21f881410` | Có source handoff WordPress; không chứng minh là checkout OpenClaw live. |
| Remote `origin/feat/supplier-receipt-outbox` | `1e07a1bf59660632fa908d2485bdcb723b18dd3d` | Outbox/claim/callback mới; đã có trong main sau các cập nhật tiếp theo. |
| Remote `origin/feat/pos-lock-ghn-sync` | `7217e2bd889772f00b810e8bb4817da771d574be` | Nhánh lịch sử POS; không tự coi là production hiện hành. |
| Lịch sử CRM `5450188e72380a97f9a957c63b0c4a64ab3f53bf` (xem `git log -S sendReceiptToClaw`) | `5450188` | Luồng cũ `source:quote_web`, `items[].quantity`; không truyền giá/CK/VAT, không dùng outbox V1. |
| Lịch sử CRM `1932cd03f72d7cba6e709f500b99d8845582093c` | `1932cd0` | Thay luồng cũ bằng durable outbox + contract V1. |
| GitHub `bachngan-vigifts/bach-ngan-bao-gia` | main `2643971d3fe09799827d81d41f8954e0a5e5ca1d` | Đã đọc recursive tree; không thấy handler/workflow n8n/OpenClaw liên quan. Không clone/sửa repo này. |
| GitHub `bachngan-vigifts/request-a-quote` | main `67a74cb151cac0c1da2d58ccda1c21ddd2ae7b8e` | Đã đọc recursive tree; không thấy handler/workflow n8n/OpenClaw liên quan. Không clone/sửa repo này. |

Tìm filename trong `/workspace`, `/tmp`, `/home`, `/opt`; kiểm tra toàn bộ nhánh/history Git của thư mục scripts. Không có checkout bổ sung, SSH config/agent hoặc thư mục n8n/OpenClaw của user hiện hành. `/mnt`, `/media` rỗng; Docker daemon truy cập được qua quyền network của môi trường nhưng không có container/volume. Không truy cập kho bí mật của user khác.

## Dấu vết production và luồng bán hàng

- Remote HTTPS `https://github.com/bachngan-vigifts/baogiabachngan_v2.git`; package `bach-ngan-bao-gia`, TS ESM/Node >=22.22. API source: `supabase/functions/baogia-v2-api/index.ts`; project `taceqfnsorewelsbdckg`.
- API deployment gần nhất quan sát: [40168922466](https://github.com/bachngan-vigifts/baogiabachngan_v2/actions/runs/40168922466), commit `d00ed916461d0254cf0ae8257246bbe745c1318a`, **bước Triển khai Edge Function thành công**, không phải chỉ workflow success do bỏ qua thiếu secret. Outbox base main không khác commit này.
- UI deployment: [40174593640](https://github.com/bachngan-vigifts/baogiabachngan_v2/actions/runs/40174593640), main `3051dcffeed8d57ccaa27be1cd3998833e7840c0`, **bước Đưa giao diện lên thành công**. Cloudflare config: project `crm-minhlong`, domain `crm.minhlongonline.com`, source `trial-ui/`.
- Source bán hàng triển khai xác nhận `sapoOrderMode:'n8n'`. `sapo-push.ts` gửi POST JSON tới `crm-order-from-web-to-claw` / `crm-hdkt-sapo-order-from-web-to-claw`; `pos-sapo.ts` gửi tới `crm-pos-order-from-web-to-claw`, cùng host n8n. HTTP nhận việc không đồng nghĩa hoàn tất Sapo.
- Không có source session/handoff node nằm sau các webhook này trong bất kỳ tree/history scripts đã kiểm tra. Không thể suy ra ID agent/session/credential thật từ tên webhook. Không gửi đơn thử vào các webhook bán hàng để dò.

## Cơ chế xác thực và workflow đã tìm

| Cơ chế/đường kiểm tra | Kết quả |
| --- | --- |
| Managed environment status | Connected/enforced; không có secret binding, runtime variable hay outbound identity n8n/OpenClaw. Không có MCP n8n/remote-shell trong tool catalog. |
| Tên biến môi trường liên quan | Chỉ có `GH_TOKEN`; không có N8N_API_KEY/OPENCLAW/SSH/SAPO_SYNC_TOKEN/Supabase/Cloudflare credential trong executor. Chỉ liệt kê tên, không in giá trị. |
| GitHub CLI + HTTPS | `gh auth status` xác nhận tài khoản bachngan-vigifts qua GH_TOKEN; read repo/deploy metadata, pull và push hoạt động. Không cần SSH fallback; không đăng nhập mới/đổi remote. |
| GitHub Actions secret/variable metadata | Endpoint list names trả 403 `Resource not accessible by integration`. Không cố trích xuất giá trị secret từ logs hoặc đổi workflow để làm lộ secret. |
| n8n `GET /api/v1/workflows?limit=100` | 403 Cloudflare 1010 `browser_signature_banned`, trước API n8n. |
| n8n `GET /api/v1/executions?limit=100` | Cùng 403; không lấy được execution quanh **2026-10-25 07:51 UTC**. |
| n8n `GET /rest/workflows`, `/healthz` | Cùng 403; không có bằng chứng workflow ID/name/active từ service thật. |

Phản hồi phân loại tại 09:08:47 UTC: `Error 1010: Access denied`, `The site owner has blocked access based on your browser's signature.`, `retryable:false`. Sau khi nhận diện không đổi user-agent, không đổi đường mạng để vượt chặn, không tiếp tục dò API n8n. GH_TOKEN chỉ dùng GitHub, không thử làm token n8n. Không có SSH host/identity được cấu hình để đọc các đường dẫn trên máy OpenClaw.

**Workflow live tìm được: chưa có workflow record nào truy cập được.** Ba đường webhook bán hàng và một đường nhập hàng là config source, không được trình bày thành workflow live đã đọc.

**Node/error gây 503 lúc 07:51 UTC: chưa xác định.** Cloudflare 1010/403 khi điều tra là lỗi khác, không được gán làm nguyên nhân 503 trước đó. Chỉ có thông báo CRM cho biết HTTP giao việc trả 503. Tài liệu OpenClaw có trường hợp queue/admission đầy trả 503, nhưng chưa có execution/runId chứng minh trường hợp này.

## Source bổ sung để tiếp tục trên runtime hiện có

- `deploy_n8n_supplier_receipt_v1_staged.js`: compiler offline đọc export workflow bán hàng, tái dùng đúng node HTTP `/hooks/agent` có credential reference và routing agent/session/model. Không clone node tạo đơn bán, không gọi API hoặc activate. Mặc định output `active:false`, ghi file mới bằng `wx`; từ chối inline secret, node mơ hồ hoặc routing expression phụ thuộc node cũ. Nguồn hook/session cụ thể vẫn cần đối chiếu export live, không dùng fixture test làm nguồn production.
- Task nhập hàng yêu cầu worker claim trước khi mở thao tác UI; payload authoritative từ claim, chỉ purchase/receive good items; reconcile chỉ tìm. Dùng browser/tool session của Claw hiện có, **không bắt buộc repo/checkout adapter riêng**. Với runtime handler có helper functions, có thể nhúng `runSupplierReceipt` để kiểm tra bằng code thay vì viết lại browser adapter.
- `supplier_receipt_worker_io.js`: client dùng lại SAPO_SYNC_TOKEN + local callback outbox riêng tư (dir0700/file0600), atomic rename/fsync, mỗi lease/generation một file. Gửi callback chỉ sau khi lưu; restart dùng `replayResult(receiptId,leaseToken)`, không claim/tạo lại. Không cần credential mới hoặc Supabase Auth.
- Compiler chỉ hỗ trợ direct OpenClaw agent hook đã xác minh trong tài liệu hiện hành. Nếu export live dùng Execute Command/subworkflow/custom handler, phải patch đúng kiểu đó, không ép vào template HTTP hoặc tự chọn node gần giống. Không gọi đây là workflow live đã sửa.

Kiểm thử mới: generated Code node chạy trong VM với n8n bindings, body/credentials/routing được kiểm, HTTP admission chỉ trả callback_pending, timeout/callback replay và dữ liệu riêng tư có test. **Chưa chạy trên n8n/OpenClaw/Sapo thật.**

## Một đầu mối truy cập còn thiếu

Cần **kết nối được cấp quyền tới đúng host OpenClaw đang chứa các đường dẫn `/home/node/.openclaw/...`** (qua execution environment hoặc SSH identity được cấu hình). Đầu mối đó cho phép tự đọc script/handoff live và credential n8n tại chỗ, không cần anh gửi token trong chat. Nếu không thể cấp kết nối, export workflow bán hàng + receipt và execution 07:51 được khử bí mật là phương án thay thế. Chưa thể kết luận root cause hoặc sửa đúng script runtime không hiện diện bằng cách đoán nội dung file.

Tham chiếu giao thức (không chứng minh phiên bản runtime live): [OpenClaw inbound webhooks](https://docs.openclaw.ai/automation/cron-jobs/webhooks), đã đọc 25/10/2026. HTTP200/runId là admission, không phải hàng đã nhập; `Idempotency-Key` phía gateway chỉ bổ sung, outbox/claim CRM vẫn là hàng rào bền vững.
