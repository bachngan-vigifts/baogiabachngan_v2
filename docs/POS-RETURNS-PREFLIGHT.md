# Trả hàng, đổi hàng, hoàn tiền POS — phương án đã duyệt

Ngày 19/10/2026. Anh đã duyệt phương án và cho tạo migration. Đã tạo hai migration bên dưới; chưa áp dụng lên production hoặc thao tác dữ liệu thật.

## Chính sách đã chốt

- Nhân viên lập yêu cầu; Manager hoặc người được chỉ định phê duyệt. Chỉ ghi nhập kho/hoàn tiền sau khi xác nhận thực tế.
- Mặc định chỉ hoàn tiền hàng. Manager quyết định hoàn thêm phí dịch vụ và phí ship; người được chỉ định không tự tăng phần phí được hoàn.
- Giữ phạm vi cửa hàng: Lock không truy cập Minh Long và ngược lại. Quyền duyệt không mở rộng phạm vi quầy/két.

## Tái sử dụng và phạm vi

Dùng lại `canApprove` và người duyệt được chỉ định trong module nhân sự, ca POS, két theo quầy, `cash_entries`, audit, `postMoves` và lịch sử sản phẩm. Không tạo danh sách người duyệt thứ hai. Không sửa lương, Sapo, cron hoặc luồng đăng nhập.

Áp dụng cho bill POS chính thức có hàng đã giao/xuất. Đơn chưa xuất dùng huỷ đơn hiện có. Đơn website chỉ có trong `web_store_orders` chưa phải bill bán CRM: không hoàn trực tiếp từ bản theo dõi này. Bill gốc, phiếu thu gốc và báo cáo ca đã kết giữ nguyên; thêm chứng từ liên kết. Huỷ phiếu thu không đồng nghĩa hoàn tiền hoặc nhận lại hàng.

Trạng thái: Chờ duyệt → Đã duyệt → Đang xử lý → Hoàn tất; có Từ chối/Huỷ trước khi phát sinh thực tế. Nhân viên xác nhận nhận lại hàng trong ca mở đúng cửa hàng; chọn hàng nhập lại bán được hoặc hàng hỏng. Chỉ số lượng bán được tăng tồn khả dụng. Xác nhận nhận hàng một lần cho mỗi yêu cầu; có thể lập yêu cầu khác cho phần còn lại của bill.

Đề xuất áp dụng ngoại lệ tự duyệt đã chốt cho Sổ quỹ: Manager được duyệt yêu cầu mình lập; người được chỉ định không tự duyệt. Mỗi thao tác lưu người, thời điểm, lý do và audit.

## Tính tiền và liên kết

Server dùng giá, CK và VAT **trên bill gốc**, không lấy giá hiện tại và không tin tổng từ client. Số lượng trả không vượt hàng đã giao trừ các yêu cầu còn hiệu lực. Khoá dòng đơn trong giao dịch để chặn hai yêu cầu cùng chiếm số lượng. Phân bổ VNĐ làm tròn theo dòng; lần trả cuối lấy phần dư để tổng hoàn không vượt bill.

Phí hoàn mặc định 0; Manager có thể duyệt một phần, tối đa phí gốc còn chưa hoàn. Phí dịch vụ giữ VAT gốc; phí ship không VAT. Duyệt không tự tạo nhập kho hoặc phiếu chi. Khoản hoàn tiền mặt chỉ trừ két ca đang mở lúc xác nhận thực trả. Chuyển khoản không vào két và cần tham chiếu/xác nhận thực chuyển; chức năng này không tự gửi lệnh chuyển tiền ngân hàng.

Gọi D là giá trị bill gốc, P là thu gốc còn hiệu lực, C là giá trị hàng/phí trả đã duyệt và thực nhận, R là tiền đã hoàn, X là tiền trả được sử dụng đổi hàng:

- Giá trị phải thu sau trả = D − C.
- Tiền giữ lại ở bill gốc = P − R − X.
- Công nợ ròng = (D − C) − (P − R − X).
- Công nợ dương là còn phải thu; âm là còn phải hoàn/được dùng đổi hàng. COD chưa thu không tạo tiền hoàn. Ví dụ bill 100.000đ đã thu 20.000đ, trả toàn bộ: xoá phần phải thu 80.000đ, chỉ được hoàn 20.000đ.

Đổi hàng tạo bill POS mới, dùng tín dụng từ khoản đã thu đủ điều kiện hoàn của bill cũ. Chỉ thu thêm phần chênh lệch; nếu bill mới rẻ hơn, phần dư chờ hoàn thực tế. Ghi rõ thanh toán bằng tín dụng đổi hàng (`customer_payments.method=other`, `payment_source=pos_exchange_credit`), không giả lập thu/chi tiền mặt cả hai chiều. Khoá số tiền được giữ cho đổi hàng trong lúc tạo QR; không cho đồng thời dùng tín dụng để đổi và hoàn tiền. Hết hạn/hủy được giải phóng trong luồng truy cập, không thêm cron. Không dùng huỷ phiếu thu thông thường để phá liên kết tín dụng/hoàn đã xác nhận; khi sửa sai phải có chứng từ đảo liên kết, quyền và audit tương ứng.

Báo cáo tách giá trị hàng trả, tiền thực hoàn và tín dụng đổi hàng; báo cáo ca cũ không bị viết lại. Chờ xử lý trả/hoàn được theo dõi sang ca sau, không tự chặn mở bán/kết ca. Với hoá đơn VAT đã phát hành, lưu chứng từ liên quan để kế toán xử lý; không tự sửa hoá đơn đã phát hành.

## Bảng mới đề xuất (4 bảng)

Tên trường dưới đây là tên SQL dự kiến; kiểu tiền theo repo là số nguyên VNĐ. ID/thời gian/JSON dùng cùng pattern POS hiện có.

| Bảng | Cột dự kiến |
| --- | --- |
| `pos_returns` | `id`, `return_no`, `order_id`, `register_id`, `warehouse_id`, `created_shift_id`, `kind` (return/exchange), `status`, `reason`, `requested_service_fee`, `requested_shipping_fee`, `approved_service_fee`, `approved_shipping_fee`, `subtotal`, `tax`, `total`, `source_snapshot`, `request_key`, `created_by`, `created_at`, `approved_by`, `approved_at`, `approval_note`, `received_by`, `received_at`, `received_shift_id`, `credit_effective_at`, `updated_at` |
| `pos_return_lines` | `id`, `return_id`, `order_line_id`, `sku`, `name`, `unit`, `requested_qty`, `received_qty`, `restock_qty`, `disposition` (restock/damaged), `condition_note`, `subtotal`, `tax`, `total` |
| `pos_refunds` | `id`, `refund_no`, `return_id`, `shift_id`, `drawer_id`, `method` (cash/transfer), `amount`, `cash_entry_id`, `reference`, `confirmation_note`, `confirmed_by`, `confirmed_at`, `request_key`, `created_at` |
| `pos_exchange_allocations` | `id`, `return_id`, `replacement_order_id`, `amount`, `payment_id`, `status` (reserved/applied/cancelled), `reserved_at`, `expires_at`, `applied_at`, `created_by`, `request_key`, `created_at` |

Ràng buộc: FK tới đơn/dòng đơn/quầy/kho/ca/két/người dùng/chứng từ hiện có; mã phiếu và mã yêu cầu unique; unique cặp phiếu trả/dòng gốc; số lượng và tiền không âm, số tiền hoàn/tín dụng > 0, nhập bán được không vượt thực nhận. Liên kết phiếu chi và khoản thanh toán tín dụng unique. Index theo đơn gốc, quầy/trạng thái/thời điểm và ca. Chặn xoá chứng từ đã phát sinh. Các giới hạn cộng dồn và tính nhất quán cùng cửa hàng được kiểm trong transaction có khoá dòng.

`source_snapshot` giữ phân bổ giá/CK/VAT gốc và phiên bản nguồn; sau duyệt không sửa tiền/số lượng trực tiếp, phải huỷ phần chưa thực hiện và lập lại. `pos_refunds` chỉ tạo khi xác nhận thực trả, không dùng trạng thái chờ để giả lập tiền đã chi. Phiếu chi hoàn mang người duyệt của yêu cầu, không bắt nhân viên duyệt lần hai sau khi đã trả tiền.

## Bảng/cột hiện có và migration

Không thêm cột vào bảng cũ. Không sửa migration đã áp dụng. Đề xuất hai migration mới, **chỉ tạo sau khi anh duyệt**:

1. Tạo 4 bảng trên, FK/index/check; mở rộng loại phát sinh kho `customer_return`, tham chiếu `pos_return`; mở rộng CHECK hướng tiền của `cash_entries` cho loại `customer_refund` chỉ là chi. Lịch sử sản phẩm đã có `customer_return`, không cần thêm loại mới ở bảng này. `customer_payments` đã hỗ trợ `other`/`payment_source`, không đổi enum thanh toán.
2. RLS và thu hồi quyền truy cập trực tiếp anon/authenticated cho bảng mới theo pattern bảng POS server-only. Mọi API vẫn kiểm quyền và phạm vi quầy ở server.

Đã tạo bằng Supabase CLI và đưa vào thư mục migration chuẩn của repo: `20261019072149_pos_returns.sql`, `20261019072202_supabase_access_pos_returns.sql`. Tạo migration không đồng nghĩa tự chạy lên production. Phải áp dụng hai file trước khi API có truy vấn bảng mới được đưa lên live.

## File/module dự kiến đụng

- Schema/API mới: `src/modules/sales/return-schema.ts`, `src/modules/sales/domain/pos-return-money.ts`, `src/modules/sales/api/pos-return-store.ts`, `src/modules/sales/api/pos-return-routes.ts`.
- Đăng ký schema/router: `src/db/schema.ts`, `src/app/router.ts`.
- Tái sử dụng phạm vi quầy và nối checkout/QR/tín dụng: `src/modules/sales/api/pos-access.ts`, `pos-store.ts`, `pos-routes.ts`; điểm tính công nợ/phiếu thu trong module sales và app routes; không thay cơ chế người duyệt hiện có.
- Sổ quỹ/ca: `src/modules/sales/api/cash-store.ts`, `src/app/cash-routes.ts`, kiểu/schema cash để nhận diện hoàn tiền và chặn huỷ chứng từ liên kết không hợp lệ.
- Kho: schema/kiểu phát sinh và ledger trong `src/modules/inventory/`; lịch sử sản phẩm tái sử dụng loại `customer_return` hiện có.
- UI: mới `trial-ui/pos-returns.js`; nối `trial-ui/pos.js`, `pos-print.js`, `pos-report.js`, `cash.js`, chi tiết đơn trong `app.js`, CSS và module import tương ứng. Mở từ bill gốc, chọn dòng trả, gửi duyệt, xác nhận nhận hàng/hoàn, in chứng từ K80.
- Test: domain tiền trả, API/UI, scope/quyền, idempotency/concurrency, công nợ/ca/kho; cập nhật đếm bảng ở test migration và CI gate. Tài liệu `docs/POS.md`, `docs/CASH.md`.
- Không đề xuất quyền mới. Dùng quyền bán/mở ca hiện có khi lập/xác nhận, và `canApprove` khi duyệt; Manager kiểm hoàn thêm phí. Tất cả kiểm tại server.

## Kiểm thử bắt buộc trước báo hoàn thành

- Nhân viên gửi, Manager/người được chỉ định duyệt đúng scope; delegated actor không tự duyệt, Manager ngoại lệ được audit; chỉ Manager duyệt thêm phí.
- Chưa duyệt/chưa thực nhận không tăng kho hoặc tạo tiền hoàn; hàng hỏng không tăng tồn bán được. Trả một phần/lặp yêu cầu không vượt số lượng gốc.
- Giữ giá/CK/VAT gốc; phân bổ làm tròn VNĐ; hoàn thêm phí đúng trần; COD chưa thu không hoàn tiền chưa nhận.
- Chỉ tiền thực trả mặt trừ két hiện tại; chuyển khoản/tín dụng đổi hàng không vào két; báo cáo ca đã chốt giữ nguyên.
- Đổi hàng đắt/rẻ hơn, tín dụng giữ chỗ, QR hết hạn, hai yêu cầu song song và retry không dùng/hoàn tiền hai lần. Bill mới vẫn kiểm tồn và tính tiền server.
- Công nợ ròng và lịch sử phiếu thu/chi khớp; các luồng huỷ/sửa chứng từ cũ không phá liên kết mới.
- Nội dung dùng DOM text, không innerHTML; không token client. Typecheck, toàn bộ test suite, build; báo rõ phần chưa thử máy in thật và Supabase live.

## Ô ghi chú đơn hàng (độc lập, không migration)

Đã triển khai trong nhánh này: ô dưới hướng dẫn phí, tối đa 2.000 ký tự, lưu `sales_orders.note` và snapshot, bill tạm/K80/chi tiết đơn/payload outbound. Ghi chú không đổi số tiền nên không làm mất xác nhận QR; retry cùng checkoutKey nhưng sửa ghi chú bị từ chối để tránh ghi đè kết quả cũ. Không thêm bảng/cột/quyền hoặc migration cho ghi chú.

## Triển khai sau duyệt

Luồng được đặt trong `src/modules/sales/api/pos-return-routes.ts`; các hàm tài chính/giữ tiền dùng chung trong `pos-return-credit.ts` (không tạo thêm `pos-return-store.ts`). Có nút **Trả / Đổi / Hoàn** ở POS và chi tiết đơn; tìm bill gốc, gửi duyệt, nhận hàng và xác nhận thực hoàn là các thao tác tách biệt. Phiếu K80 ghi rõ giá trị trả không đồng nghĩa đã hoàn tiền.

Sổ thu/chi (`src/app/cashbook-routes.ts`) bổ sung hoàn tiền khách và loại khoản thanh toán bằng tín dụng đổi hàng khỏi tiền thực thu. Các lịch thu và phiếu thu gốc giữ nguyên; API công nợ trả thêm lịch thu hiệu lực đã trừ hàng trả cho phần hiển thị. COD chưa thu được giới hạn theo công nợ ròng sau trả.

Chuyển khoản SePay đến sau khi tín dụng đổi hàng đã hết hạn/giải phóng được ghi audit `late-exchange-transfer`, đánh dấu `requiresReconciliation`; không tự chi lại tiền hoặc sử dụng lại tín dụng. Manager cần đối soát khoản đến muộn. Chứng từ hoàn thực tế và tín dụng đã dùng không được huỷ bằng nút huỷ phiếu thông thường; bản này chưa có màn đảo chứng từ hoàn ghi sai.

Giới hạn: không tự điều chỉnh Sapo/website/hóa đơn VAT đã phát hành, không tự chuyển khoản ngân hàng. Các chứng từ nguồn bên ngoài cần đối soát riêng. Kiểm thử dùng DB PostgreSQL WASM cô lập và giao diện giả lập, không phát sinh đơn hoặc hoàn tiền thật.
