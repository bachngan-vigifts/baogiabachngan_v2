# Điều tra nguồn live NCC/Sapo — 25/10/2026 UTC

Đây là bằng chứng quan sát trong môi trường Codex ban đầu và lần kiểm tra bổ sung trực tiếp trên host OpenClaw, không phải xác nhận trạng thái Sapo. Không deploy, activate workflow, merge, gửi webhook hoặc retry PNH_20261025_001 / DMH_20261016_059.

## Bổ sung từ host OpenClaw — 25/10/2026 10:55–11:50 UTC

- Host có credential n8n hợp lệ trong kho credential riêng; chỉ dùng trong tiến trình và không in giá trị.
- Workflow live là `YrvQihypiSc0odI9` — **Sapo supplier receipt v1 (CRM → OpenClaw UI)**, đang active nhưng có deployment gate đóng.
- Execution `12140` lúc `2026-10-25T07:50:00.357Z` và `12145` lúc `2026-10-25T07:59:09.083Z` đều kết thúc tại `Respond Contract V1` với HTTP 503. Node `Validate Contract V1 and Deployment Gate` trả `deployment_gate_closed` vì `LIVE_ENABLED=false`.
- Vì dừng ở gate, hai execution trên chưa chạy `Claim CRM Job`, chưa handoff OpenClaw và chưa thao tác Sapo. Đây là nguyên nhân 503 đã xác minh; không phải bằng chứng queue/admission đầy.
- Workflow bán hàng live `mYC4bwhlkvliy42l` và workflow receipt hiện hành đều handoff bằng `Execute Command`; không có workflow live nào dùng HTTP `/hooks/agent` và danh sách credential n8n không có credential OpenClaw agent-hook dùng chung.
- Code node handoff hiện hành chứa material xác thực OpenClaw inline. Không sao chép giá trị vào source, log hay báo cáo; không được mở gate bằng workflow này. Cần chuyển sang credential/env/runtime helper được quản lý trước khi activate.
- Host đã đọc được GitHub bằng `GH_TOKEN` lưu trong OpenClaw, fetch `main` mới nhất `f846f51e14467d575dd89b2e6f12a71b1d2a2be6` và source PR #309. Không cần bundle/source gửi tay.
- Contract/consumer/outbox/worker/workflow/warehouse targeted tests: 36/36 pass; typecheck và UI build pass sau khi cài dev dependencies từ lockfile. Chưa chạy mutation live.

## Checkout và lịch sử đã kiểm tra

| Vị trí/nguồn | Branch/commit | Kết quả |
| --- | --- | --- |
| `/workspace/baogiabachngan_v2` | main `3051dcffeed8d57ccaa27be1cd3998833e7840c0`; nhánh sửa `fix/supplier-receipt-sapo-workflow`, commit ban đầu `8e7ff18bc881caad872a2b0269bb2d5a34626c74` | Working tree sạch trước điều tra; `git pull origin main` thành công, đã cập nhật. Các thay đổi tiếp theo chỉ trên nhánh PR #309. |
| `/home/node/.openclaw/workspace/work/sites/crm-pos-lock-ghn-source-handoff` | `chore/lock-ghn-bridge-source`, `1b9d95d2b44547cd5e3ad811507bcfa21f881410` | Worktree lịch sử/handoff; không coi là production live. |
| `/home/node/.openclaw/workspace/work/sites/crm-pos-lock-ghn-sync` | `feat/pos-lock-ghn-sync`, `f06fcb7e8294c604c94285954966af5acb5cd152` | Worktree cũ có `sendReceiptToClaw`; không dùng làm base sửa. |
| `/home/node/.openclaw/workspace/work/sites/baogiabachngan-v2-n8n` | remote main đã fetch tới `f846f51e14467d575dd89b2e6f12a71b1d2a2be6` | Repo/worktree nguồn dùng để tạo worktree PR riêng; các thay đổi có sẵn của user được giữ nguyên. |
| `/home/node/.openclaw/workspace/scripts/{sapo_goods_receipt_from_quote_web.js,deploy_n8n_supplier_receipt_v1_staged.js,create_n8n_sapo_goods_receipt_from_quote_web_workflow.js,supplier_receipt_contract_v1.js}` | Đã đọc trên host | Handler cũ dùng Sapo API và payload `quote_web`; không thay mù vào consumer V1/browser task. Script CRM job/contract local tồn tại nhưng worker journal mới chỉ nằm trong PR. |
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

Các hạn chế 403 Cloudflare ở môi trường Codex ban đầu vẫn là dữ kiện đúng cho môi trường đó. Trên host OpenClaw, credential n8n hợp lệ đã cho phép đọc workflow/execution và xác minh nguyên nhân 503 như phần bổ sung phía trên.

## Source bổ sung để tiếp tục trên runtime hiện có

- `deploy_n8n_supplier_receipt_v1_staged.js`: compiler offline đọc export workflow bán hàng, tái dùng đúng node HTTP `/hooks/agent` có credential reference và routing agent/session/model. Không clone node tạo đơn bán, không gọi API hoặc activate. Mặc định output `active:false`, ghi file mới bằng `wx`; từ chối inline secret, node mơ hồ hoặc routing expression phụ thuộc node cũ. Nguồn hook/session cụ thể vẫn cần đối chiếu export live, không dùng fixture test làm nguồn production.
- Task nhập hàng yêu cầu worker claim trước khi mở thao tác UI; payload authoritative từ claim, chỉ purchase/receive good items; reconcile chỉ tìm. Dùng browser/tool session của Claw hiện có, **không bắt buộc repo/checkout adapter riêng**. Với runtime handler có helper functions, có thể nhúng `runSupplierReceipt` để kiểm tra bằng code thay vì viết lại browser adapter.
- `supplier_receipt_worker_io.js`: client dùng lại SAPO_SYNC_TOKEN + local callback outbox riêng tư (dir0700/file0600), atomic rename/fsync, mỗi lease/generation một file. Gửi callback chỉ sau khi lưu; restart dùng `replayResult(receiptId,leaseToken)`, không claim/tạo lại. Không cần credential mới hoặc Supabase Auth.
- Compiler chỉ hỗ trợ direct OpenClaw agent hook đã xác minh trong tài liệu hiện hành. Nếu export live dùng Execute Command/subworkflow/custom handler, phải patch đúng kiểu đó, không ép vào template HTTP hoặc tự chọn node gần giống. Không gọi đây là workflow live đã sửa.

Kiểm thử mới: generated Code node chạy trong VM với n8n bindings, body/credentials/routing được kiểm, HTTP admission chỉ trả callback_pending, timeout/callback replay và dữ liệu riêng tư có test. **Chưa chạy trên n8n/OpenClaw/Sapo thật.**

## Điều kiện còn thiếu trước khi mở live

Không còn thiếu checkout hay quyền đọc runtime. Điều kiện kỹ thuật còn thiếu là **một handoff OpenClaw được quản lý bằng credential/env hoặc helper runtime**, thay cho material xác thực inline trong Code node. Compiler PR hiện cố ý chỉ nhận HTTP `/hooks/agent` có credential reference; runtime live hiện không có node/credential kiểu đó. Vì thay đổi credential hoặc quyền truy cập production cần phê duyệt riêng, PR giữ workflow staging `active:false` và không tự mở gate.

Tham chiếu giao thức (không chứng minh phiên bản runtime live): [OpenClaw inbound webhooks](https://docs.openclaw.ai/automation/cron-jobs/webhooks), đã đọc 25/10/2026. HTTP200/runId là admission, không phải hàng đã nhập; `Idempotency-Key` phía gateway chỉ bổ sung, outbox/claim CRM vẫn là hàng rào bền vững.
