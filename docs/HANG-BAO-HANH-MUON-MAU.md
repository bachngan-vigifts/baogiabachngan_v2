# Hàng bảo hành & mượn mẫu

Route `#/product-custody`, trong nhóm **Danh mục sản phẩm** trên PC; trên mobile dùng menu hiện có, mục nằm ngay sau Sản phẩm trong nhóm Bán hàng. Không thêm thanh điều hướng thứ hai. API `/api/staff/product-custody`.

## Phạm vi đợt này

- Bảo hành gửi NCC, có thể gắn khách cần giao lại; mượn mẫu gắn khách đã duyệt trong phạm vi phụ trách/chia sẻ hiện có.
- Một phiếu có 1–50 SKU hoạt động; lưu tên/đơn vị/tình trạng lúc bàn giao. Mỗi SKU một dòng, số lượng tối đa 3 chữ số thập phân.
- Nhận trả từng phần theo từng dòng. Không được nhận vượt phần còn lại; nhận đủ mọi dòng mới chuyển Đã nhận lại. Lưu ngày, người, số lượng và tình trạng ở từng lần.
- Đổi hạn trả, ghi chú; chỉ Manager được phân công lại. Người nhận phân công phải hoạt động và có quyền module.
- Ảnh JPG/PNG/WebP tối đa 400 KB sau nén, tối đa 12 ảnh/phiếu. Dùng `StaffEnv.files` private, link ký 15 phút, kiểm tra byte thực, kiểm tra quyền trước khi ký link. Upload không lưu được bản ghi sẽ cố xoá object vừa tải; lỗi kết nối khi dọn được ghi log để đối soát. Chưa hỗ trợ PDF/Office trong đợt này.
- Không có thông báo ra ngoài CRM; các chỉ số/nhãn trong trang phản ánh phiếu cần theo dõi.

## Nghiệp vụ và tồn kho

**Phiếu theo dõi không phải chứng từ kho.** Tạo, nhận trả hoặc hoàn tất không gọi `postMoves`, không ghi tồn, giá vốn, doanh số hoặc công nợ. Nhân viên phải thực hiện luồng kho tương ứng riêng; nhãn hoàn tất không có nghĩa đã tự nhập kho.

Bảo hành: Chờ gửi → Đã gửi NCC → NCC đang xử lý; có thể nhận trả ngay từ Đã gửi NCC (NCC đã trả trước khi nhân viên cập nhật bước xử lý). Nhận đủ → Đã nhận lại → Đã giao khách (có khách gắn phiếu) hoặc Hoàn tất. Khi kết thúc bảo hành phải có kết quả xử lý. Mượn mẫu: tạo phiếu ghi nhận mẫu đã giao → Đang mượn; nhận đủ → Đã nhận lại → Hoàn tất theo dõi. Không cho chuyển ngược hoặc đánh dấu đã nhận bằng nút đổi trạng thái.

Ngày thực tế không ở tương lai hoặc trước lần ghi nhận trước. Tính hạn theo Asia/Ho_Chi_Minh; sắp đến hạn = hôm nay tới 3 ngày tiếp theo. Quá hạn là nhãn tính toán, không lưu đè trạng thái. Khi đã nhận đủ thì dừng cảnh báo chờ khách/NCC trả, kể cả chưa hoàn tất thủ tục giao lại khách. Phiếu có một phần chưa trả vẫn quá hạn nếu vượt hạn.

## Kiến trúc và quyền

Module `src/modules/product-custody/` theo cấu trúc domain thuần/API/schema có sẵn. Hợp đồng chung ở `src/core/contracts/product-custody.ts`; nhãn và hàm domain được bundle bằng ui:build ra `trial-ui/product-custody-contract.js`. Giao diện chính tải qua dynamic import khi mở route.

Quyền riêng `page.product-custody`, Manager luôn có. Migration cấp mặc định cho các chức vụ Sale, Sale Admin, NVBH ML/Lock, Kế toán, Kho; chức vụ tuỳ chỉnh do Manager cấp. Nhân viên chỉ được xem/sửa phiếu mình tạo hoặc phụ trách, kể cả người có phạm vi dữ liệu toàn công ty ở module khác. List, số đếm, detail, upload và link ký đều theo cùng phạm vi. NCC/khách không vào API nhân viên. Lập phiếu có khách phải qua `customerAccess`; ô tìm chỉ trả id/tên các khách phù hợp.

Mã BH_NNN_DDMMYYYY / MM_NNN_DDMMYYYY dùng bộ sinh mã hiện có. Tạo/nhận trả/cập nhật dùng clientKey + fingerprint, revision và khoá transaction; gửi lại cùng yêu cầu không nhân đôi phiếu/số lượng. Sai revision trả 409. Lịch sử và audit cùng transaction với cập nhật. Gộp khách trùng nối qua hợp đồng composition `customerMergeHooks`, chuyển FK phiếu trong cùng transaction trước khi xoá khách trùng; giữ tên lịch sử đã ghi.

## Triển khai

1. Review PR, chờ CI đạt trên head cuối; chưa merge/deploy khi chưa được Anh Thái xác nhận.
2. Chạy tay `migrations/postgres/20261107161337_product_custody.sql` trên project CRM. Chỉ thêm bảng/index/quyền module, không sửa dữ liệu kho cũ. Không sửa migration đã áp dụng.
3. Chạy `scripts/sql/assert-product-custody.sql`. Gate kiểm tra bảng/cột, RLS, quyền browser và index chống trùng; workflow deploy API chặn nếu thiếu.
4. Triển khai API rồi UI từ main theo workflow hiện có.

Không đổi bucket hay quyền Storage. Chưa chạy migration trên production trong quá trình phát triển.

## Kiểm tra

- `tests/app/product-custody.test.ts`: tạo/replay, trạng thái, nhận từng phần, quá hạn theo giờ VN, phân quyền, lọc, gộp khách, private photo và dọn upload thất bại; stock_balances giữ nguyên.
- `tests/db/product-custody.test.ts`: migration chạy lại, RLS/quyền và gate phát hiện thiếu cột.
- `scripts/testing/product-custody.mjs`: CRM/router thật + dữ liệu tổng hợp trên PC 1440/mobile 390, tạo phiếu/nhận từng phần/hoàn tất/lịch sử/lọc, modal không tràn và không đổi số dư kho.
- Chạy `npm run typecheck`, `npm run ui:build`, `npm test`. CI hiện có 4 shard và concurrency 2; không dùng hướng dẫn 2 shard/concurrency 4 đã cũ trong prompt.
