# Báo cáo Cửa hàng trưởng (CHT) – giai đoạn 1

Theo *Bản mô tả công việc CHT* và *Quy định chính sách lương CHT* (2026).

## Ai dùng
- **Manager** gán CHT cho từng cửa hàng (quầy POS) ở trang **Báo cáo CHT → Gán CHT**. Mỗi cửa hàng một CHT, mỗi người tối đa một cửa hàng.
- **CHT** thấy mục *Báo cáo CHT* trong menu, nộp báo cáo, giải trình; nhận **hộp nhắc việc 30 phút / lần** khi còn báo cáo chưa nộp.
- **Người duyệt**: Manager, hoặc chức vụ được cấp quyền *Duyệt báo cáo Cửa hàng trưởng* (`store.review`).

**Hướng dẫn cho CHT (PDF, có ảnh minh hoạ):** `trial-ui/guides/huong-dan-bao-cao-cua-hang-truong.pdf` – nút **Hướng dẫn (PDF)** trên trang Báo cáo CHT và trong hộp nhắc việc. Sửa nội dung thì thay file và tăng `?v=` ở `GUIDE_URL` (`trial-ui/store-reports.js`).

## Báo cáo và hạn nộp (giờ Việt Nam)
| Báo cáo | Kỳ | Hạn | CRM tự điền |
|---|---|---|---|
| Ngày | ngày có mở ca POS | trước 22h00 | doanh số, tiền mặt / CK / khác, chênh lệch quỹ theo từng ca |
| Tuần | thứ Hai → Chủ nhật | trước 10h00 thứ Hai tuần sau | doanh số tuần, 10 mã bán chạy, 10 mã tồn không bán 30 ngày |
| Tháng | tháng | trước ngày 02 tháng sau | doanh số, mã bán chạy, ngày / ca của từng người theo ca POS |
| Kiểm tồn kho | tháng | trước ngày 02 tháng sau | phiếu kiểm kê kho cửa hàng, số mã lệch, giá trị lệch (giá nhập gần nhất) |

## Ngày bắt đầu áp dụng: 06/11/2026
Báo cáo CHT triển khai từ **06/11/2026** (`STORE_REPORTS_LAUNCH_DAY` trong `domain/reports.ts`). Kỳ có **hạn nộp trước 00h00 ngày 06/11** mà chưa nộp được ghi **"Miễn – trước ngày triển khai"**: tính là hoàn thành (đủ Tiền Trách nhiệm), không nhắc việc. Gồm báo cáo ngày 01–05/11, báo cáo tuần 26/10–01/11 (hạn 02/11) và báo cáo tháng / kiểm tồn tháng 10 (hạn 02/11). Kỳ đã nộp vẫn xét theo giờ nộp thực tế.

## Nháp và nộp chính thức
- **Lưu nháp**: chỉ lưu phần CHT nhập, bất cứ lúc nào sau khi kỳ bắt đầu. Nháp **không** tính là đã nộp / đúng hạn và không tắt nhắc việc.
- **Nộp chính thức**: báo cáo tuần chỉ từ 00h00 thứ Hai tuần sau; tháng / kiểm tồn từ 00h00 ngày 01 tháng sau; báo cáo ngày nộp trong ngày (hạn 22h). Máy chủ kiểm tra lại, client gửi số liệu nào cũng bị bỏ qua.
- **Giờ nộp chính thức đầu tiên** là giờ xét đúng hạn. Nộp lại (khi chưa duyệt) thêm một bản vào **lịch sử nộp** (`store_report_versions`), không xoá bản cũ, không đổi giờ đầu.
- Mỗi lần nộp lưu **bản chụp**: số liệu CRM, phần CHT nhập, thời điểm tính (`meta.factsAt`) và nguồn bảng (`meta.sources`).
- Đã duyệt thì khoá cả nộp lại lẫn nháp (CHT dùng *Giải trình*). Không tự tính lại thưởng / Tiền Trách nhiệm cho báo cáo lịch sử.

### Hạn 22h và ca chưa đóng (cần anh xác nhận chính sách)
Ca có thể đóng sau 22h. CRM **không đổi chính sách**: CHT được nộp chính thức khi còn ca mở, báo cáo ghi **"Tạm tính – còn ca chưa đóng"**; đóng ca rồi *Nộp lại* để có số liệu đủ (giờ nộp đầu vẫn giữ). Tiền Trách nhiệm vẫn xét theo giờ nộp chính thức đầu tiên như cũ; người duyệt thấy cờ tạm tính và tự quyết (Đạt / Miễn…). CRM không tự phạt hay miễn.

## Báo cáo ngày – tiền phải nộp (nguồn Sổ quỹ)
Tiền phải nộp = **tiền đầu ngày** (tiền thực đếm lúc mở ca đầu tiên) + thu tiền mặt (bán hàng, COD, Thu khác / Rút két) − chi hợp lệ (chi vặt, tạm ứng, hoàn tiền khách) − **quỹ được giữ lại**.
- Tiền bàn giao giữa các ca không cộng lại. Phiếu *Nộp két* là tiền đã nộp, không trừ thêm lần nữa. Phiếu điều chỉnh két và phiếu chờ duyệt hiện riêng, không tính.
- Thiếu tiền đầu ngày / quỹ giữ lại / lịch nộp → hiện **thiếu căn cứ**, không tính, không coi là 0. Manager đặt ở **Cấu hình cửa hàng** (trang Báo cáo CHT).
- So số CHT khai đã nộp ngân hàng với tiền phải nộp và với Sổ quỹ. Có chênh lệch → bắt buộc giải trình; **không** tự đánh dấu "sai số liệu sổ quỹ" hay trừ tiền – người duyệt quyết định.
- Lệch quỹ khi kết ca: thiếu và thừa hiện riêng.
- Trả / đổi / hoàn trong ngày: phiếu trả (link đơn gốc, đơn đổi sang), phiếu hoàn (tiền mặt đã ghi Sổ quỹ / chuyển khoản). Hoàn tiền mặt chỉ trừ một lần (qua phiếu chi). Doanh thu POS bỏ đơn huỷ; hàng trả hiện riêng.
- Ca thuộc ngày theo ngày làm việc của ca (ca qua nửa đêm thuộc ngày mở ca).

## Báo cáo tuần
- **Doanh thu POS** của báo cáo (gồm VAT, đơn không huỷ, theo ngày làm việc của ca) tách riêng với **doanh số xét chỉ tiêu** (CRM net + POS trước VAT, đơn đã duyệt – cùng nguồn xét thưởng DS cửa hàng). Không chia doanh thu POS cho chỉ tiêu.
- Chỉ tiêu / mốc thưởng lấy qua contract `StoreTargetOf` (lắp ở `src/app/store-report-sources.ts`): đúng cấu hình nguồn doanh số cửa hàng + tham số lương của tháng. Quầy chưa nằm trong cấu hình → "chưa cấu hình", **không** gán mặc định 300 triệu.
- **Hàng cần bổ sung** theo ngưỡng tối thiểu từng mã của kho cửa hàng (`store_restock_rules`, Manager đặt ở *Cấu hình cửa hàng*): tồn sổ kho, hàng đã giữ (cùng cách tính POS), đang về (phiếu điều chuyển tới kho đã duyệt / đã gửi). Đề xuất = ngưỡng − (tồn trống + đang về). Chưa có ngưỡng → báo chưa cấu hình. "Tồn" là tồn sổ kho, không phải tồn trên kệ.
- Đề xuất đặt hàng / xử lý hàng chậm bán: CHT ghi số đơn mua / phiếu điều chuyển liên quan, link sang trang Đơn mua và Điều chuyển; **không** tự tạo chứng từ hay ghi kho.

## Báo cáo tháng
- Kết quả chỉ tiêu và mốc thưởng từ cùng nguồn trên, ghi rõ **thưởng DS cửa hàng tạm tính (trước chia)**; không có lương cá nhân.
- So tháng trước cùng quầy, cùng cách tính. Tháng trước không mở ca → **thiếu dữ liệu** (không coi là 0).
- Doanh thu theo **thương hiệu** (trường thương hiệu trong danh mục); mã trống thương hiệu vào nhóm **Chưa phân loại**. Không đoán từ tên sản phẩm.
- Lệch quỹ khi kết ca: thiếu và thừa riêng (kèm số ca).
- Ngày có ca POS chỉ để đối chiếu; **công chấm HR** lấy qua contract `StoreAttendanceOf` (chưa chấm → "Chưa chấm").

## Báo cáo kiểm tồn
- Phiếu kiểm kê (dòng nguồn `stocktake`) của **đúng kho cửa hàng**, lập từ 00h ngày 01 tới hạn (00h ngày 02 tháng sau, giờ VN). Phiếu **chờ duyệt** vẫn được nộp báo cáo; phiếu từ chối không tính.
- Phạm vi: số mã đã đếm so với số mã đang có tồn; liệt kê mã chưa kiểm. Một phiếu không mặc nhiên là đã kiểm đủ.
- Ghi nhận phiếu **không chênh lệch**. Lệch theo mã lấy lần đếm mới nhất (không cộng dồn giữa các phiếu); **thừa / thiếu** tách riêng; **hàng hỏng / bể** (khách trả, loại hỏng) riêng; số phiếu chờ duyệt.
- Giá trị lệch = |SL lệch| × giá nhập gần nhất (lịch sử sản phẩm) – ghi rõ phương pháp, mã thiếu giá không tính, **không phải tiền bồi thường**. Giá vốn **chỉ Manager xem** (CHT thấy số lượng).
- Mã có giá trị lệch ≥ **ngưỡng giải trình** (Cấu hình cửa hàng) phải giải trình riêng mới nộp chính thức được. Chưa cấu hình ngưỡng → không bắt buộc theo mã.

## Đề xuất giai đoạn sau (chưa làm)
- Báo cáo tuyển dụng / đào tạo NVBH.
- Theo dõi chi phí vận hành cửa hàng (điện, nước, vật tư).
- So cùng kỳ năm trước.
- Dự báo doanh số cuối tháng trong báo cáo CHT.
- Báo cáo sự cố đột xuất và nhắc việc bằng thông báo đẩy điện thoại.
- Liên kết đơn mua NCC với kho theo mã kho (hiện đơn mua lưu tên kho dạng chữ nên "đang về" chỉ tính phiếu điều chuyển).
- Thay đổi chính sách thưởng / phạt (cần quyết định riêng).

## Tệp đính kèm (chứng từ nộp tiền, biên bản kiểm kê)
- CHT đính kèm trong hộp báo cáo: báo cáo ngày (chứng từ nộp tiền, tệp khác), kiểm tồn (biên bản / ảnh kiểm kê có chữ ký), tuần / tháng (tệp khác).
- Chỉ ảnh JPEG / PNG / WebP hoặc PDF; máy chủ nhận dạng theo **byte thực tế**, MIME khai phải khớp; PDF có JavaScript / tự chạy / tệp nhúng bị từ chối.
- Tối đa 6 MB / tệp, 6 tệp và 24 MB / báo cáo. Khoá lưu `store-reports/<uuid>.<đuôi>` do máy chủ đặt.
- Kho file private (bucket hiện có). Chỉ CHT của cửa hàng và người duyệt xem; link ký 10 phút cấp sau khi kiểm quyền; chỉ tệp đã kiểm tra xong mới có link.
- CHT gỡ được khi báo cáo chưa duyệt; đã duyệt thì khoá. Nộp chính thức ghi danh sách tệp (id, mã SHA-256) vào bản chụp.
- Lỗi giữa chừng: dòng ghi trước ("đang tải") → tải lên → "sẵn sàng". Lỗi kho file thì xoá dòng + tệp ngay; lỗi không dọn được thì lượt tải / gỡ kế tiếp dọn lại (tệp tải dở quá 15 phút, tệp đã gỡ chưa xoá được ở kho file).

## Tiền Trách nhiệm (4 ngạch × 250.000)
- Ngày: 0 lần chưa đạt 250k · 1–2: 150k · 3–4: 50k · ≥ 5: 0. Chưa đạt = trễ / thiếu; *sai số liệu sổ quỹ* tính 2 lần.
- Tuần: 0: 250k · 1: 150k · 2: 50k · ≥ 3: 0. Chưa đạt = trễ / thiếu / *đề xuất đặt hàng sai*.
- Tháng: đúng hạn 250k · trễ ≤ 2 ngày 100k · còn lại 0.
- Kiểm tồn kho: đúng hạn 250k · trễ ≤ 2 ngày 150k · còn lại hoặc *có chênh lệch nhưng không báo* 0.
- Duyệt *Miễn (lý do khách quan)* → không tính chưa đạt.

Trang hiện số tạm tính theo tháng. Giai đoạn 2 đưa vào bảng lương CHT (năng lực, thưởng Sale-out chia hệ số CHT 1,5 / NVBH 1, thưởng Sale-in × H_QL, cơm + xăng theo ngày công).

## Kỹ thuật
- Module `src/modules/store` (domain thuần: `domain/reports.ts`). API `/store/*` – xem đầu file `api/routes.ts`.
- Migration `20261111100000_store_manager_reports.sql` (chạy tay) + cổng `scripts/sql/assert-store-manager-reports.sql`.
- Migration `20261112090000_store_report_submission.sql` (chạy tay): `store_report_drafts`, `store_report_versions` (tạo bản lần 1 cho báo cáo đã có), `store_settings` + cổng `scripts/sql/assert-store-report-submission.sql`.
- Migration `20261112100000_store_report_files.sql` (chạy tay): `store_report_files` + cổng `scripts/sql/assert-store-report-files.sql`.
- Migration `20261112110000_store_restock_rules.sql` (chạy tay): `store_restock_rules` + cổng `scripts/sql/assert-store-restock-rules.sql`.
