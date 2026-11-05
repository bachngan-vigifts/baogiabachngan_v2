# Sổ kho

**Mục tiêu:** dần thay Sapo trong quản lý tồn kho.

Ở giai đoạn này **Sapo vẫn là nguồn tồn chính**. Hệ thống ghi một sổ kho riêng và so với tồn Sapo hằng ngày. Khi sổ kho gần như không lệch trong khoảng 1 tháng thì mới chuyển hẳn.

## Nguyên tắc
- **Mỗi phát sinh là 1 dòng** trong `stock_moves`: mã, kho, số lượng +/−, loại, chứng từ gốc, người làm, thời gian.
  - Không ai sửa hay xoá dòng.
  - Huỷ chứng từ thì ghi thêm dòng ngược lại (loại "Huỷ chứng từ").
- **Tồn** nằm trong `stock_balances`, bằng cộng dồn các dòng. Tồn được cập nhật trong cùng giao dịch với chứng từ gốc.
- **Một chứng từ chỉ ghi một lần** cho mỗi (mã, kho, loại). Bấm lặp hay gọi lại cũng không cộng hai lần.
- **Chỉ kho thật** (kho loại `stock`) mới có sổ kho. Kho NCC/ĐL không có.

## Phát sinh tự động
| Chứng từ | Sổ kho |
|---|---|
| Phiếu nhận hàng NCC (số lượng đạt) | **+** vào kho nhận. Kho nhận chọn trong danh sách kho, hệ thống khớp theo tên. |
| Huỷ phiếu nhận NCC | ghi dòng ngược lại |
| Kho xác nhận "đã đóng hàng" (phiếu đóng gói, nguồn = Kho) | **−** khỏi kho xuất. Kho xuất bắt buộc chọn lúc xác nhận. |

**Kho nhận không khớp danh sách kho:** từ chối toàn bộ thao tác nhận; không lưu phiếu riêng lẻ ngoài giao dịch kho. Kho phải là kho thật đang hoạt động và đã mở sổ.

## Chuỗi chứng từ nhập → xuất → giao

| Bước | Tác động tồn sổ kho |
|---|---|
| Duyệt đơn / HĐKT | Giữ hàng, không trừ tồn |
| Duyệt phiếu xin lấy trước | Cho phép nhận trong lượng đã chấp thuận, không cộng tồn |
| Lưu phiếu nhận NCC (thường hoặc lấy trước) | Cộng số đạt vào đúng kho trong cùng transaction |
| Gửi phiếu đóng gói | Chưa trừ tồn |
| Kho xác nhận **Đã xuất kho** | Trừ đúng lượng trên phiếu, đúng kho xuất, chỉ một lần |
| POS tại quầy thanh toán và giao ngay | Giữ cơ chế xuất trực tiếp theo chứng từ POS; không cần phiếu đóng gói CRM |
| Bàn giao / Đã giao | Kiểm tra đủ nguồn đã xác nhận; không trừ thêm |
| Callback n8n/OpenClaw | Lưu liên kết Sapo; không cộng tồn CRM lần nữa |

- Mỗi dòng đơn được đối chiếu riêng, kể cả nhiều dòng cùng SKU và xuất nhiều đợt. Không lấy một phiếu đã xuất làm bằng chứng cho toàn bộ đơn.
- Giao thẳng từ NCC/đại lý/nguồn ngoài cần phiếu nguồn được xác nhận thực tế; không trừ kho nội bộ và không tiếp tục giữ lượng hàng nội bộ tương ứng.
- Nguồn cửa hàng khác phải qua điều chuyển rồi xuất tại kho thực tế. Không tự chọn kho mặc định khi thiếu thông tin.
- Mọi đơn CRM có hàng, kể cả đơn cũ thiếu kế hoạch/kho, đều phải có đủ xác nhận nguồn trước khi giao. Đánh dấu tiến độ thủ công không thay thế duyệt đơn hay xuất kho.
- Các đơn cũ đã trừ lúc duyệt không trừ lần hai khi xác nhận phiếu. Vẫn cần phiếu xác nhận nguồn để chứng minh việc xuất thực tế.
- Không huỷ phiếu nhận khi đang gửi/chờ callback/đang có worker xử lý. Phải dừng và xác minh n8n/OpenClaw trước, tránh CRM hoàn tồn nhưng bên ngoài vẫn nhập. Các đường ghi khoá theo thứ tự đơn mua → phiếu nhận → job → sổ kho.
- Phiếu lịch sử sinh khi nhập file NCC không phải thao tác nhận hàng mới. Thiếu kho phải đối chiếu tồn đầu kỳ; không tự ghi bù vì có thể đã nằm trong tồn mở sổ.

### Chống ghi trùng, hàng đang giữ, trả hàng, giao thất bại (28/10/2026)

- **Phiếu điều chỉnh bắt buộc mã chống gửi lặp** (`clientKey`), kể cả Manager.
  - Thiếu mã → `409 ADJUSTMENT_KEY_REQUIRED`, kèm phiếu cùng nội dung vừa lập trong 2 phút (nếu có).
  - Gửi lại cùng mã trả lại phiếu cũ; đổi nội dung cùng mã → `409`.
- **Lịch giao và phiếu nhận NCC kiểm cả nội dung khoá chống lặp** (migration `20261029120000_request_keys.sql`):
  - Lịch giao: form gửi một mã mỗi lần mở. Gửi lại cùng mã và cùng nội dung → trả chuyến cũ (200, `replayed`). Cùng mã khác ngày / địa chỉ / dòng hàng → `409 IDEMPOTENCY_CONFLICT`.
  - Phiếu nhận NCC: cùng mã nhưng khác số lượng / kho / ngày / phiếu xin lấy trước → `409 IDEMPOTENCY_CONFLICT`, không trả phiếu cũ. Phiếu lập trước migration (không có dấu nội dung) giữ cách cũ.
- **Lịch sử sản phẩm:**
  - Giữ đủ mọi phát sinh (không còn xoá bớt). Lịch sử nhanh 20 dòng, "Xem thêm phát sinh cũ" nạp trang cũ hơn (`?before=`).
  - Dòng "Giao hàng" ghi cùng giao dịch với "Đã giao", kể cả chuyến POS do GHN báo đã giao.
- **Không lấy hàng đang giữ cho đơn khác** (`sales/api/stock-free.ts`):
  - Áp dụng cho bước "Đã chuyển" điều chuyển (kho đi) và xác nhận xuất kho phiếu đóng gói.
  - Lượng được lấy = tồn sổ kho − hàng giữ cho đơn / báo giá khác ở kho đó (cùng cách tính với POS). Phần giữ của chính đơn được dùng.
  - Kiểm trong giao dịch, sau khoá `stock_holds`, khoá dòng tồn. Vượt → `409 HELD_FOR_OTHER_ORDER`, kèm số đơn đang giữ.
  - Manager được lấy vượt khi ghi lý do (`overrideHolds.reason`); nhật ký `stock-hold-override` ghi các đơn bị ảnh hưởng.
  - **Không tự xếp ưu tiên** giữa các đơn: hai đơn cùng giữ quá tồn thì bên nào xuất cũng cần Manager quyết.
- **Trả hàng CRM chỉ nhập lại trong phạm vi đã thực xuất** (`sales/api/crm-return-stock.ts`):
  - Mỗi dòng đơn: tổng nhập lại (mọi phiếu đã nhận + phiếu này) ≤ lượng xuất ròng có bút toán (phiếu xuất / trừ kiểu cũ).
  - Phần vượt (đơn cũ giao khi chưa ghi xuất): Manager chọn căn cứ khi duyệt, hoặc bổ sung trước khi nhận (`POST …/returns/:id/stock-basis`):
    - `pre_opening`: chuyến giao trước ngày chốt tồn đầu kỳ của kho nhận. Đơn cũ không có chuyến giao: đơn lập trước ngày chốt.
    - `adjustment`: phiếu điều chỉnh đã duyệt đã trừ bù đúng mã. Mỗi phiếu chỉ dùng tối đa lượng đã trừ, cộng dồn mọi phiếu trả.
  - Không có căn cứ → `409 RETURN_STOCK_UNPROVEN`. Từ chối phiếu và lập lại với tình trạng "Hàng hỏng" (không cộng tồn).
  - Kiểm lại lúc nhận hàng. Căn cứ lưu trên phiếu (`source_snapshot.stockBasis`) và nhật ký `crm-return-stock-basis`.
- **Huỷ đơn sau giao thất bại** (`POST /orders/:id/cancel-after-failed-delivery`, chỉ Manager):
  - Dùng khi chuyến đã rời kho rồi giao không thành công và khách không nhận nữa (huỷ thường bị chặn `RETURN_REQUIRED`).
  - Bắt buộc xác nhận kho đã nhận lại đủ hàng, lý do và mã chống gửi lặp.
  - Điều kiện: chưa giao món nào, chưa thu tiền, không có phiếu trả; mọi chuyến từng rời kho đang "Giao thất bại".
  - Huỷ đơn và đảo các phiếu xuất về đúng kho đã xuất, một giao dịch. Hàng hỏng lập phiếu điều chỉnh sau.
  - Giao lại sau thất bại dùng luồng giao thường (không trừ lần hai).
- **Kiểm thử đồng thời trên PostgreSQL thật:** `TEST_PG_URL=postgres://… npx tsx --test tests/app/<file>.test.ts`.
  - Mỗi test một database mới, 20 kết nối. CI dùng PGlite (một kết nối nên không chứng minh được khoá).

### Giữ hàng theo đơn (quyết định Anh Thái 28/10/2026)

**Quy tắc:** mỗi mã chỉ được giữ tối đa = **có thể bán** = tồn − hàng đang giữ (đơn / báo giá / POS khác) tại kho bán.
- Tồn đọc đúng nguồn chuẩn: kho đã chốt đầu kỳ dùng sổ kho, chưa chốt dùng tồn Sapo.
- Giữ hàng chấm dứt khi:
  - xuất kho / giao xong (tiêu hao đúng dòng đơn);
  - hết hạn (tự nhả, báo người phụ trách một lần);
  - bấm **Huỷ giữ** (người phụ trách / Manager, bắt buộc lý do);
  - huỷ đơn.

**Đơn hàng / HĐKT CRM** (bảng `order_stock_holds`, migration `20261028150000_order_stock_holds.sql`, code `sales/api/order-hold-store.ts`):

| Lúc | Giữ bao nhiêu | Hạn |
|---|---|---|
| Đơn nháp | Không giữ. Báo giá đang giữ thì vẫn giữ tiếp theo báo giá | Theo báo giá |
| Duyệt, có ngày giao dự kiến | Tự giữ phần chưa giao, tối đa có thể bán; phần thiếu chờ hàng về | Hết ngày giao + 3 ngày (giờ VN) |
| Duyệt, không ngày giao | Không tự giữ. Riêng phần báo giá đã giữ: chuyển sang đơn đúng số đó | Hạn của báo giá |
| Hàng về: bấm **Giữ hàng / Giữ thêm** | Phần còn thiếu, tối đa có thể bán (mã chống gửi lặp bắt buộc) | 5 ngày |
| Manager **Gia hạn** | Không đổi lượng | +5 ngày |
| Đổi ngày giao (Manager) | Giữ tự động theo hạn mới; đơn chưa giữ thì tự giữ từ lúc có ngày giao | Ngày giao mới + 3 ngày |

- Lượng giữ hiệu lực = min(tổng dòng giữ còn hạn, phần chưa giao / chưa xuất).
- Mọi thao tác giữ chạy trong giao dịch dưới khoá `stock_holds`. Thứ tự khoá chung: `stock_holds` → đơn → sổ kho.
- Đơn POS giữ nguyên cơ chế hiện hành.
- **Chi tiết HĐKT:** có khối **Giữ hàng HĐKT** riêng ngay dưới bảng sản phẩm, dùng cùng `GET/POST /orders/:orderId/holds`, `/release` và `/extend` như đơn hàng. Đây là ID bản ghi hàng/giao hàng của HĐKT, không phải ID hồ sơ Word. HĐKT nháp hiển thị yêu cầu duyệt trước; chưa chọn kho thì nhắc chọn kho. Không tạo thêm dòng giữ riêng cho HĐKT, không tự chuyển đổi chứng từ cũ.
- **Kiểm tồn báo giá:** luôn có cột **Hàng đang giữ**, gồm cả phần báo giá đang mở giữ và các báo giá / đơn / HĐKT khác. Cột **Khả dụng cho báo giá** chỉ trừ giữ của chứng từ khác. Không tải được số giữ thì hiển thị chưa có số liệu, không kết luận đủ hàng từ tồn vật lý.
- **Tra tồn:** cột **Hàng đang giữ** hiển thị theo từng kho thật, riêng dòng **Chưa gắn kho** cho giữ báo giá / chứng từ chưa chọn kho; chỉ cộng một lần trong tổng. Không cộng hàng giữ hoặc hàng đang về vào tồn vật lý. Dùng cùng lượng giữ hiệu lực của bán hàng/POS; không hiện số giữ của kho riêng bị ẩn, không trả thông tin khách hay giá qua API Tra tồn.
- **Đơn cũ** (`sales_orders.hold_mode = 'legacy'`) vẫn giữ toàn bộ phần chưa giao cho tới khi Manager chuyển đổi:
  - `GET /stock-holds/conversion`: xem trước, chạy trong giao dịch rồi huỷ, không ghi gì. Đơn trước giữ trước, chỉ đơn đã duyệt có kho bán và ngày giao còn hiệu lực mới giữ.
  - `POST /stock-holds/conversion { planId, confirmed: true }`: chạy lại, chỉ ghi khi trùng mã kế hoạch. Dữ liệu đổi thì `409 HOLD_PLAN_CHANGED`; áp dụng lại không đổi gì.
  - Giao diện: khối "Giữ hàng" trên chi tiết đơn cũ có nút "Kế hoạch chuyển đổi giữ hàng đơn cũ" (Manager).

### Đơn web (Lock, Minh Long) – sổ kho theo GHN (quyết định Anh Thái 28/10/2026)

Code `sales/api/web-order-stock.ts`, migration `20261029090000_web_order_stock.sql`.

| GHN báo | Sổ kho kho quầy của đơn web (chứng từ `web_order`) |
|---|---|
| Chờ lấy / đang lấy / huỷ trước khi lấy | Không ghi |
| Đã lấy hàng (picked) hoặc bất kỳ trạng thái sau đó (đang giao, đã giao, đang hoàn…) | **Tự trừ** theo dòng hàng website, một lần |
| Đã hoàn về shop (`returned`) | **Tự cộng lại** đúng số đã trừ (dòng đảo), một lần |
| Thất lạc / hư hỏng / hoàn thất bại | Không cộng lại (hàng không về) |

- Trạng thái kho của đơn web (`web_store_orders.stock_status`): `none`, `issued`, `returned`, `blocked` (không trừ được), `legacy`.
- **Không trừ được:** mã website không có trong danh mục, kho thiếu, kho chưa chốt đầu kỳ.
  - Không chặn đồng bộ GHN: đơn chuyển `blocked`, hiện lý do trên POS, báo Manager một lần.
  - Sửa mã / nhập hàng xong thì lượt đồng bộ GHN sau tự trừ (lưới an toàn `reconcileWebOrderStock`).
- Gọi ở mọi chỗ ghi trạng thái GHN: webhook GHN, lượt hỏi GHN của Minh Long, webhook website Lock, thao tác trên đơn web.
  - Khoá dòng đơn web; gửi lặp / đồng thời không ghi hai lần.
  - Người ghi sổ khi tự động: tài khoản Manager lập sớm nhất, dòng sổ có ghi chú "Tự động theo GHN".
- **Đơn cũ:** đã lấy hàng / kết thúc trước migration thì đánh `legacy`, không tự trừ bù. Đối soát qua hồ sơ (docs/DOI-SOAT-KHO-LICH-SU.md, mục B).
- **Tạo vận đơn GHN mất phản hồi** (POS COD, web Minh Long): trước khi báo lỗi, tra GHN theo `client_order_code` và gắn lại đúng vận đơn (`sales/api/ghn-client-code.ts`), không tạo trùng.

### Đối soát chỉ đọc

Manager gọi `GET /warehouse-workflow-audit?offset=0` để kiểm tra số dư so với sổ, phiếu nhận so với phát sinh đúng kho, và đơn đang/đã giao thiếu bằng chứng xuất. Mỗi trang 100 bản ghi, có tổng số và thông tin trang tiếp. Báo cáo không thay đổi dữ liệu; không coi việc thiếu chứng từ tự động là bằng chứng phải trừ bù. Cần xác minh kho, kỳ mở sổ và chứng từ thực tế trước khi sửa lịch sử.

## Trang "Đối chiếu tồn Sapo" (#/inventory) – chỉ Manager / quyền "Sổ kho – xem"
(Trước đây tên là "Sổ kho". Từ 22/10/2026 tên "Sổ kho" dùng cho trang giao dịch `#/stock-moves` bên dưới.)
- **Đối chiếu:** tồn sổ kho, tồn Sapo và chênh lệch theo từng mã × kho. Mặc định chỉ hiện các dòng lệch.
- **Thẻ kho:** bấm vào một dòng để xem các phát sinh của mã đó, có tồn luỹ kế và link về chứng từ.
- **Chốt tồn đầu kỳ (Manager):** lấy tồn Sapo hiện tại làm điểm bắt đầu.
  - Hệ thống ghi thêm dòng chênh lệch, không xoá lịch sử.
  - Chốt lại lần nữa khi không có gì đổi thì không ghi thêm dòng nào.
- **Phiếu điều chỉnh (Manager):** dùng cho kiểm kê lệch, hàng hỏng, hàng mẫu…
  - Bắt buộc ghi lý do.
  - Số dương là tăng tồn, số âm là giảm tồn.
  - Mã hàng phải có trong danh mục.

## Giao diện cho tài khoản Kho
Tài khoản kho chỉ thấy các trang cần dùng, chữ to, nút to.
- **Trang kho (#/kho):** trang mở đầu sau khi đăng nhập. Có 3 thẻ lớn: Cần đóng gói · Hàng NCC về – cần nhận · Giao hàng hôm nay, và danh sách việc bên dưới.
- **Thanh dưới trên điện thoại:** Trang chủ · Đóng gói · Nhận hàng · Giao hàng · Tra tồn.
- **Ẩn với kho:** Sơ đồ quy trình, Tổng quan doanh số, Sổ kho (cùng các trang bán hàng như trước).
- **Phiếu đóng gói:** làm theo các bước có đánh số:
  1. tick từng món khi lấy hàng (máy nhớ các món đã tick);
  2. chụp ảnh hàng đã đóng;
  3. chọn kho xuất;
  4. bấm "Đã đóng xong". Nút chỉ bấm được khi đủ cả ba bước trên.
- **Nhận hàng NCC:** trang Đơn mua chỉ hiện các đơn chờ nhận, dạng thẻ. Bấm vào thẻ là mở thẳng form nhận hàng.
  - Mỗi mã một thẻ: "Cần nhận N", ô "Số đạt" / "Số hỏng", nút "Đủ N".
  - Có hàng hỏng thì **bắt buộc 1–3 ảnh**. Manager xem ảnh ngay trên phiếu nhận của đơn mua.
- **Lịch giao hàng:** mặc định hiện hôm nay và ngày mai.
  - Kho **không có nút Huỷ**; máy chủ cũng chặn. Chỉ nhân viên phụ trách hoặc Manager huỷ được chuyến.
  - Bấm "Đã giao" phải chụp 1–3 ảnh hàng đã giao hoặc biên bản ký nhận. Kho bắt buộc chụp, người khác thì tuỳ chọn.
  - Ảnh hiện trên Lịch giao hàng và trên trang đơn.
- **Tra tồn (#/stock-lookup):** cho Kho và Manager. Gõ mã, tên, hoặc quét mã vạch (máy quét cầm tay, hoặc camera trên Chrome Android).
  - Hiện số lượng từng kho thật, **không có giá**.
  - Chưa chốt tồn đầu kỳ thì lấy tồn Sapo; đã chốt thì lấy tồn sổ kho.
- **Lưu ảnh:** ảnh nén ở trình duyệt, lưu trong kho file private (Supabase Storage, thư mục `warehouse-photos/`). Bảng `warehouse_photos` chỉ giữ khoá file.

## Kế hoạch tiếp theo
- **Giai đoạn 2:** chuyển kho giữa các kho, kiểm kê có Manager duyệt, giá vốn bình quân, báo cáo nhập – xuất – tồn theo kỳ.
- **Giai đoạn 3:** chốt tồn đầu kỳ lần cuối, tắt đồng bộ tồn từ Sapo, hệ thống trở thành nguồn tồn chính.

## Kỹ thuật
- **Code:**
  - `src/modules/inventory/`: schema, `api/ledger.ts` ghi phát sinh, `api/photos.ts` ảnh kho, `api/routes.ts` (gồm `GET /inventory/lookup`).
  - Giao diện: `trial-ui/inventory.js`, `trial-ui/kho.js` (Trang kho, Tra tồn).
- **Migration:**
  - `0059_stock_ledger.sql`: 2 bảng mới và cột `packing_slips.stock_warehouse_id`.
  - `0060_supabase_access_stock_ledger.sql`: chặn truy cập trực tiếp qua Data API.
  - `0061_warehouse_photos.sql`: bảng ảnh kho.
  - `0062_supabase_access_warehouse_photos.sql`: chặn truy cập trực tiếp bảng ảnh kho.
- **Test:**
  - `tests/app/inventory.test.ts`: sổ kho và tra tồn.
  - `tests/app/order-progress.test.ts`: phiếu xuất khi đóng gói.
  - `tests/app/purchasing.test.ts`: ảnh hàng hỏng.
  - `tests/app/packing.test.ts`: kho không huỷ chuyến, ảnh đã giao.

## Kho bán theo chức vụ · trừ kho khi bán · điều chuyển (yêu cầu 18/10/2026)

**Tồn chuẩn = sổ kho.** Kho thật đã chốt tồn đầu kỳ đọc số dư sổ kho ở mọi nơi (danh mục, chi tiết sản phẩm, Kiểm tồn, Tra tồn, giữ hàng, popup duyệt đơn). Kho chưa chốt vẫn đọc tồn đồng bộ Sapo. Trước đây chỉ kho quầy POS dùng sổ kho; nay áp cho mọi kho đã chốt.
- **Trước khi bật:** Manager vào **Sổ kho → Chốt tồn đầu kỳ** cho từng kho (VIGIFTS, SR Minh Long - Lock, các kho Hoá đơn) để sổ kho bằng tồn Sapo tại thời điểm chuyển.
- Kho đã có bán đơn / HĐKT hoặc điều chuyển trong app thì **không chốt lại đầu kỳ từ Sapo** được (Sapo không biết các phát sinh này); kiểm kê lệch dùng phiếu điều chỉnh.

**Kho bán theo chức vụ** (trang **Phân quyền → Kho bán theo chức vụ**, bảng `warehouse_sellers`):
| Kho | Chức vụ được bán |
|---|---|
| KHO VIGIFTS | Sale Admin, Sale |
| SR Minh Long - Lock | NVBH ML, NVBH LOCK |
| Kho Hoá đơn (mọi kho tên có "Hoá đơn") | Kế toán – **kho riêng** |
| Mọi kho | Manager |
- Migration gán sẵn theo tên kho; Manager kiểm lại / sửa ở trang Phân quyền.
- Nhân viên chỉ lập / duyệt đơn, HĐKT từ kho chức vụ của **người phụ trách đơn** được bán (máy chủ trả 403 `WAREHOUSE_NOT_ALLOWED`). Người phụ trách chỉ bán một kho → tự chọn.
- Ai cũng xem tồn các kho khác, **trừ kho riêng** (Hoá đơn): chỉ chức vụ bán kho đó + Manager thấy (danh mục, Tra tồn, lịch sử, điều chuyển).
- Bảng gán còn trống = tính năng chưa bật (không bắt chọn kho, đơn không trừ kho theo đơn).

**Duyệt giữ hàng, xác nhận xuất mới trừ kho (kênh CRM, từ 24/10/2026):**
- Duyệt đơn / HĐKT xác nhận nghiệp vụ và kho dự kiến, không ghi bút toán trừ kho. Đơn giữ phần chưa xuất ở kho bán; tồn thực và khả dụng sau giữ hàng là hai số khác nhau.
- Kho xác nhận **Đã xuất kho** trên phiếu đóng gói nguồn Kho: chọn đúng kho, đủ ảnh và số lượng. Server kiểm tồn trong transaction, ghi `stock_moves` và cập nhật `stock_balances` cùng lần. Không đủ tồn thì toàn bộ xác nhận rollback; bấm lặp không trừ thêm.
- Xuất từng phần chỉ trừ số lượng trên phiếu đó, đồng thời giảm giữ hàng phần đã xuất. Kho khác không bị trừ. Đổi kho dự kiến trước khi xuất không chuyển số dư thực.
- Duyệt, sửa báo giá hay đánh dấu tiến trình không thay thao tác xác nhận xuất. Đã giao không tự hoàn tất hoặc huỷ phiếu có SKU chưa xác nhận xuất.
- Huỷ đơn chưa xuất không cộng kho; huỷ phiếu đã xuất theo cơ chế hiện hành ghi dòng đảo, không xoá lịch sử.
- **Tương thích đơn cũ:** các bút toán trừ lúc duyệt đã ghi được giữ nguyên. Khi xác nhận đóng gói không trừ lần hai; huỷ hoàn phần cũ. Chặn đổi kho/sửa mã hoặc số lượng đơn cũ đã trừ để yêu cầu đối soát, không tự dịch chuyển số dư hoặc sửa lịch sử.
- Lịch sử bán/chứng từ ghi “Giao hàng” theo chuyến giao; chỉ `stock_moves` là bằng chứng đã trừ sổ kho. Đơn cũ đã giao nhưng thiếu kho/phiếu xuất cần đối soát đúng kho trước khi bù.
- POS / web giữ luồng xuất kho riêng hiện hành.

**Điều chuyển kho** (`#/transfers`, bảng `stock_transfers` + `stock_transfer_lines`):
1. Nhân viên bấm **＋ Xin điều chuyển**: kho đi, kho đến, lý do, các mã + số lượng → **Chờ duyệt** (báo người duyệt, vào hộp **Cần duyệt**, việc "Duyệt điều chuyển").
2. Manager / người được duyệt **Duyệt** hoặc **Từ chối** (bắt buộc lý do).
3. **Kho đi xuất hàng** (nhóm Kho – quyền *Điều chuyển kho – xác nhận đã chuyển* – hoặc nhân viên bán của kho đi) bấm **Đã chuyển** → phiếu sang **Đang chuyển** và sổ kho trừ kho đi (**Chuyển kho đi**) đủ số lượng xin. Kho đi đã chốt đầu kỳ mà không đủ tồn → 409 `TRANSFER_SHORT`. Báo kho đến, tạo việc "Nhận hàng điều chuyển".
4. **Kho đến nhận hàng** (Manager hoặc nhân viên thuộc chức vụ được phân kho đến trong Phân quyền kho bán) bấm **Nhận hàng**, nhập **SL nhận** từng mã (mặc định điền sẵn SL chuyển, có nút "Nhận đủ tất cả"). Sổ kho cộng kho đến đúng số nhận (**Chuyển kho đến**). Nếu nhận thiếu: bắt buộc ghi lý do, phần thiếu **giữ chênh lệch chờ đối soát**, không tự hoàn tồn kho đi, báo Manager; không nhận quá SL chuyển (`RECEIVE_OVER`). API chỉ nhận số JSON hữu hạn, không âm, tối đa 3 chữ số thập phân; kiểm tra trước khi làm tròn. Người xin phiếu hoặc người có quyền điều chuyển chung không tự có quyền nhận nếu chưa được phân kho đến. Phiếu nhận thiếu vẫn chốt `done`, lưu chênh lệch để đối soát; không nhận bổ sung trên cùng phiếu.
5. Nút **In phiếu điều chuyển** (từ khi đã duyệt) in mẫu A4 giống phiếu giao hàng để nhân viên mang theo: kho đi/đến, danh sách mã, SL chuyển, cột SL nhận để kho đến ghi tay, 4 chữ ký.
6. Người xin / Manager huỷ được khi chưa chuyển (đã "Đang chuyển" thì huỷ phải hoàn kho – không cho huỷ).

**Sổ kho** (`#/stock-moves`, mọi nhân viên; trước đây tên là "Lịch sử xuất nhập"): xem mục **Trang Sổ kho** bên dưới.

**Kỹ thuật:** migration `20261021120000_warehouse_sales.sql` (+ `20261021120001_supabase_access_warehouse_sales.sql`); `inventory/api/{warehouse-access,transfer-routes,history-routes}.ts`, `ledger.ts › syncSaleMoves`, `sales/api/routes.ts › pickSaleWarehouse / syncOrderStock`, `sales/api/pos-stock.ts` (nguồn tồn); giao diện `trial-ui/stock-ops.js`. Test: `tests/app/warehouse-sales.test.ts`, `transfer-receive.test.ts`, `transfer-print.test.ts`. Migration nhận hàng điều chuyển `20261102120000_transfer_receive.sql` (thêm `shipped_*`, `received_qty`, trạng thái `shipped`) – **chạy tay trong Supabase SQL Editor trước khi merge**; API `/stock-transfers/:id/done` đã thay bằng `/ship` + `/receive`.

## Trang Sổ kho (#/stock-moves) – như "Sổ kho" của Sapo (22/10/2026)

Mỗi dòng là **một giao dịch** trong `stock_moves`, mới nhất trước. Mặc định xem 30 ngày gần nhất.

| Cột | Lấy từ |
|---|---|
| # | Số thứ tự trong trang |
| Ngày ghi nhận | `stock_moves.created_at` (lúc chứng từ ghi vào sổ kho) |
| Giao dịch | Số chứng từ `ref_no` (bấm để mở chứng từ gốc) + diễn giải `stockMoveDescription(kind, ref_type)` |
| Phiên bản sản phẩm | Mã SKU (bấm mở thẻ sản phẩm: tồn từng kho, lịch sử) + tên; nhãn **Ngừng giao dịch** khi `products.active = false` |
| Nhập kho / Xuất kho | Số lượng dương / âm của dòng |
| Tồn kho sau giao dịch | Cộng dồn **toàn bộ** sổ kho của (mã, kho) tới dòng đó (`sum(qty) over (partition by sku, warehouse_id order by created_at, id)`), tính **trước** khi lọc nên lọc ngày / loại không làm sai số. Âm = tô đỏ. |
| Chi nhánh | Kho thật của dòng |

- **Dòng "Tổng N giao dịch"**: số giao dịch và tổng Nhập / Xuất của **cả bộ lọc**, không chỉ trang đang xem.
- **Bộ lọc**: Chi nhánh · Từ ngày / Đến ngày · Giao dịch (Bán hàng / Nhập kho / Xuất kho / Điều chuyển / Điều chỉnh – đầu kỳ / Huỷ chứng từ) · Nhãn hiệu · Trạng thái sản phẩm (Đang / Ngừng giao dịch) · ô tìm (mã, tên, số chứng từ, ghi chú). Bộ lọc đang bật hiện thành chip có ×.
- **Link giữ bộ lọc**: `#/stock-moves?q=…&warehouseId=…&from=YYYY-MM-DD&to=…&group=…&brand=…&status=…`. Gửi link cho người khác là mở đúng bộ lọc.
- **Phân trang** 20 / 50 / 100 / 200 dòng. **⬇ Xuất file**: Excel theo bộ lọc (tối đa 5000 dòng mới nhất, báo khi bị cắt).
- **Kho riêng** (Hoá đơn) không hiện với người không bán kho đó: không có trong danh sách, dòng và tổng.
- Link chứng từ chỉ hiện khi người xem mở được trang đó (theo phân quyền), không thì hiện chữ.
- **Chưa có cột Giá trị** (như Sapo). Sổ kho chưa lưu giá vốn từng dòng. Muốn có giá trị cần thêm giá vốn bình quân: cần migration thêm cột giá vào `stock_moves`, và ghi giá ở mọi nơi gọi `postMoves`. Đây là việc riêng, xem Giai đoạn 2.

### Chứng từ nào ghi gì vào sổ kho (tự động – không ai nhập tay)
| Nghiệp vụ | Loại (`kind`) | Chứng từ (`ref_type`) | Diễn giải trên Sổ kho | Link mở |
|---|---|---|---|---|
| Chốt tồn đầu kỳ (Đối chiếu tồn Sapo) | opening | opening | Chốt tồn đầu kỳ | – |
| Nhận hàng NCC (số đạt) | receipt | supplier_receipt | Nhập hàng vào kho | Đơn mua `#/purchases/<id>` |
| Huỷ phiếu nhận NCC | reverse | supplier_receipt | Huỷ phiếu nhập hàng | Đơn mua |
| Duyệt đơn / HĐKT kênh CRM (trừ kho bán) | sale | sales_order | Xuất kho khi duyệt (lịch sử cơ chế cũ) | Đơn `#/orders/<id>` |
| Huỷ / sửa SL / đổi kho đơn đã duyệt | reverse hoặc sale (phần chênh) | sales_order | Huỷ / sửa đơn – hoàn lại kho | Đơn |
| Xác nhận đóng gói (đơn chưa trừ lúc duyệt) | issue | packing_slip | Xuất kho đóng gói giao hàng | Phiếu `#/packing/<id>` |
| Bán tại quầy POS | sale | pos_order | Xuất kho bán tại quầy | Đơn |
| Bàn giao vận chuyển / giao COD (POS) | issue | pos_delivery | Xuất kho giao hàng cho khách/shipper | Đơn gốc của phiếu giao |
| Khách trả hàng (nhập lại kho) | customer_return | pos_return | Khách trả hàng – nhập lại kho | Đơn gốc |
| Điều chuyển "Đã chuyển" | transfer_out / transfer_in | stock_transfer | Chuyển hàng sang kho khác / Nhận hàng chuyển kho | Phiếu `#/transfers/<id>` |
| Phiếu điều chỉnh (Manager) | adjust | adjustment | Điều chỉnh tồn kho | – |
| Đơn website: GHN đã lấy hàng | issue | web_order | Xuất kho đơn website (GHN đã lấy hàng) | – |
| Đơn website: GHN đã hoàn về shop | reverse | web_order | Đơn website GHN hoàn về – nhập lại kho | – |

### Thêm loại chứng từ mới (để không rối về sau)
1. Thêm giá trị vào `STOCK_MOVE_KINDS` / `STOCK_REF_TYPES` (`src/modules/inventory/domain/kinds.ts`) + migration cập nhật check constraint.
2. Ghi sổ **chỉ qua** `postMoves` / `reverseRef` / `syncSaleMoves` (`inventory/api/ledger.ts`), **trong cùng transaction** với chứng từ gốc. Huỷ không xoá dòng mà ghi dòng ngược lại.
3. Thêm diễn giải vào `stockMoveDescription` (TypeScript báo lỗi nếu thiếu `kind`).
4. Link mở chứng từ:
   - chứng từ có trang theo id → thêm vào `directLink` (`inventory/api/history-routes.ts`);
   - chứng từ của module khác (inventory không được import sales / suppliers) → viết hàm tra link trong module đó, rồi gắn vào `stockRefLinkHooks` ở `src/app/router.ts`. Ví dụ có sẵn: `sales/api/stock-ref-links.ts`, `suppliers/api/stock-ref-links.ts`.
5. Thêm vào nhóm lọc `GROUPS` (history-routes.ts và `trial-ui/stock-ops.js`) nếu cần, và thêm một dòng vào bảng trên.
6. Test: `tests/app/warehouse-sales.test.ts` (Sổ kho: tồn sau giao dịch, tổng, lọc, phân trang, kho riêng); link qua hook: `tests/app/inventory.test.ts` (phiếu nhận NCC), `tests/app/pos-order-flow.test.ts` (giao COD), `tests/app/pos-returns.test.ts` (khách trả).
