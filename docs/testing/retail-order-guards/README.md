# Chọn kho, xác nhận huỷ điều chuyển và báo cáo huỷ đơn

## 1. Chọn kho trước khi phân bổ

Form sinh đơn/HĐKT dùng chung `quote-sourcing.js`. Không tự chọn kho, kể cả chỉ có một kho được bán. Chưa chọn kho thì không dựng thẻ hàng/ô số lượng/nguồn hàng; có lời nhắc chọn kho. Chọn kho mới dựng hàng và điền tồn tương ứng, đổi kho tính lại phân bổ như trước, xoá lựa chọn ẩn và xoá thẻ hàng. `read()`/`prepare()` chặn sinh đơn có hàng khi chưa chọn kho hợp lệ. Báo giá chỉ có khoản phí, không có dòng hàng quản lý tồn, giữ luồng cũ.

## 2. Huỷ phiếu điều chuyển

Nút Huỷ phiếu dùng `confirmBox` chung với số phiếu cụ thể, `danger: true`, `delay: 3000`. Nút xác nhận bị khoá và đếm ngược 3–2–1; focus mặc định ở Không, giữ lại. Đóng/Escape/giữ lại không gửi request. Cơ chế khoá drawer và chống bấm trùng sẵn có vẫn áp dụng từ lúc chờ xác nhận tới khi đọc lại trạng thái sau ghi. Không đổi quyền, revision, API huỷ hoặc nghiệp vụ tồn.

## 3. Tỷ lệ huỷ / hoàn ở bảng đơn POS

Thêm thẻ **Tỷ lệ huỷ / hoàn**, bấm mở tổng quan ngay từ dữ liệu API đã tải. Thẻ Đơn web hiện có vẫn lọc các đơn website cần xử lý.

- Phạm vi: cửa hàng, nguồn, nhân viên, khoảng ngày đặt và từ khoá. Không dùng thẻ trạng thái hoặc bộ lọc thanh toán làm mẫu số, vì lọc đã thanh toán vốn loại các đơn đã huỷ. Ghi rõ phạm vi này trong popup.
- Khi chưa chọn khoảng ngày, analytics lấy đơn có ngày đặt từ `windowFrom` của API (mốc 30 ngày gần nhất). Những đơn còn đang xử lý từ trước mốc đó vẫn xuất hiện trong bảng vận hành như trước, nhưng không làm loãng tỷ lệ trong kỳ.
- Tính toàn bộ dữ liệu trước phân trang 100 dòng. Không cộng tiền khác loại tiền để tính tỷ lệ: đây là tỷ lệ **số đơn**.
- Huỷ/hoàn trên tổng = số đơn không thành công ÷ tổng đơn; hoàn thành trên tổng = số hoàn thành ÷ tổng đơn; thành công trên đơn đã kết thúc = hoàn thành ÷ (hoàn thành + không thành công). Không có mẫu số thì hiện Chưa có dữ liệu.
- Ví dụ 100 đơn gồm 50 huỷ/hoàn, 30 hoàn thành, 20 đang xử lý → lần lượt 50%, 30%, 37,5%. Không suy rằng 50 đơn chưa huỷ đều thành công.
- Tách trạng thái đã huỷ, hoàn/đang hoàn hàng, hoàn tiền, thất bại/mất/hỏng theo bằng chứng trạng thái đang lưu. Giao thất bại đang chờ xử lý không bị ép thành huỷ nếu bộ phân loại hiện tại vẫn xem là đang giao. Không thay đổi trạng thái nghiệp vụ để phục vụ báo cáo.
- Lý do POS lấy từ snapshot huỷ. Đơn web lấy lý do mới nhất của thao tác `web-order-cancel` trong audit CRM; truy vấn một lô theo ID đơn thuộc cửa hàng được phép, dùng chỉ mục audit theo entity sẵn có, không query từng đơn. Không trả snapshot POS/audit nguyên khối cho trình duyệt. Không có bằng chứng lý do thì ghi Chưa ghi nhận lý do, không tự đoán từ trạng thái GHN.
- Lý do được gom theo nội dung (bỏ khoảng trắng thừa, không phân biệt hoa/thường), có số đơn và tỷ trọng trong nhóm không thành công. Nội dung server chỉ đưa vào `textContent`.

### Đề xuất quản trị, chưa phải quy định phạt

Thử cảnh báo khi có ít nhất **30 đơn đã kết thúc** trong kỳ: từ **10%** huỷ/hoàn cần rà soát; từ **20%** cảnh báo cao. Các mốc này chỉ là đề xuất thử nghiệm, chưa được hiệu chỉnh theo dữ liệu lịch sử từng nguồn/cửa hàng. Không tự gán lỗi hoặc ghi phạt nhân viên. Đơn web hiện chưa có người bán gắn trên đơn, nên không quy trách nhiệm nhân viên từ tỷ lệ tổng.

Trước khi quyết định trách nhiệm cần tách lỗi khách, thiếu hàng, đơn trùng/thử, vận chuyển và lỗi thao tác có bằng chứng; so với mặt bằng cùng nguồn và kỳ có đủ thời gian giao. Không dùng phạt tiền/cắt lương thay xử lý kỷ luật lao động (Điều 127 Bộ luật Lao động 2019). PR không đụng lương/thưởng/kỷ luật.

## Kiểm chứng

- Typecheck và `git diff --check`.
- 67 test liên quan UI POS, phân bổ, sinh đơn, chống bấm trùng/giữ revision, bộ lọc và quyền điều chuyển.
- 4 test board/domain/API: hơn 500 đơn vẫn tính đủ trước phân trang; source/cửa hàng/nhân viên/ngày; không bị lọc thanh toán/trạng thái bóp méo; đơn đang xử lý; mẫu số 0; lý do POS; lý do audit web mới nhất; trạng thái hoàn/thất bại và lý do còn thiếu.
- Chromium 1280px/390px với module UI và `confirmBox` thật, dữ liệu giả: hàng bị ẩn trước khi chọn/được xoá khi bỏ kho, đổi kho có tồn đúng; xác nhận bị khoá đủ 3 giây; bỏ huỷ 0 ghi; xác nhận 1 ghi đúng ID/revision; báo cáo hiển thị 100/50/30/20, 50%, 37,5%; không lỗi JS. Chặn mọi origin ngoài localhost.
- Browser script: `PLAYWRIGHT_MODULE=<module Playwright> node scripts/testing/warehouse-and-transfer-guards.mjs`; cần Chromium ở `/usr/bin/chromium`. Test dữ liệu WASM dùng `node --import tsx --test --test-isolation=none --test-reporter=spec ...` trong môi trường có giới hạn native worker.

[Browser results](results.json) · [Chưa chọn kho](before-390.png) · [Xác nhận huỷ](confirm-390.png) · [Báo cáo trên mobile](analytics-390.png).

Không migration; không truy vấn/chỉnh dữ liệu production; không merge/deploy; không thay đồng bộ GHN/Sapo hoặc cron.
