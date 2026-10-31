# Chọn kho, xác nhận huỷ điều chuyển và báo cáo huỷ đơn

## 1. Chọn kho trước khi phân bổ

Form sinh đơn/HĐKT dùng chung `quote-sourcing.js`. Không tự chọn kho, kể cả chỉ có một kho được bán. Chưa chọn kho thì không dựng thẻ hàng/ô số lượng/nguồn hàng; có lời nhắc chọn kho. Chọn kho mới dựng hàng và điền tồn tương ứng, đổi kho tính lại phân bổ như trước, xoá lựa chọn ẩn và xoá thẻ hàng. `read()`/`prepare()` chặn sinh đơn có hàng khi chưa chọn kho hợp lệ. Báo giá chỉ có khoản phí, không có dòng hàng quản lý tồn, giữ luồng cũ.

## 2. Huỷ phiếu điều chuyển

Nút Huỷ phiếu dùng `confirmBox` chung với số phiếu cụ thể, `danger: true`, `delay: 3000`. Nút xác nhận bị khoá và đếm ngược 3–2–1; focus mặc định ở Không, giữ lại. Đóng/Escape/giữ lại không gửi request. Cơ chế khoá drawer và chống bấm trùng sẵn có vẫn áp dụng từ lúc chờ xác nhận tới khi đọc lại trạng thái sau ghi. Không đổi quyền, revision, API huỷ hoặc nghiệp vụ tồn.

## 3. Tỷ lệ huỷ / hoàn ở bảng đơn POS

Thêm thẻ **Tỷ lệ hoàn thành**, bấm mở tổng quan ngay từ dữ liệu API đã tải. Thẻ Đơn web hiện có vẫn lọc các đơn website cần xử lý.

- Phạm vi: cửa hàng, nguồn, nhân viên, khoảng ngày đặt và từ khoá. Không dùng thẻ trạng thái hoặc bộ lọc thanh toán làm mẫu số, vì lọc đã thanh toán vốn loại các đơn đã huỷ. Ghi rõ phạm vi này trong popup.
- Khi chưa chọn khoảng ngày, analytics lấy đơn có ngày đặt từ `windowFrom` của API (mốc 30 ngày gần nhất). Những đơn còn đang xử lý từ trước mốc đó vẫn xuất hiện trong bảng vận hành như trước, nhưng không làm loãng tỷ lệ trong kỳ.
- Tính toàn bộ dữ liệu trước phân trang 100 dòng. Không cộng tiền khác loại tiền để tính tỷ lệ: đây là tỷ lệ **số đơn**.
- Huỷ/hoàn trên tổng = số đơn không thành công ÷ tổng đơn; hoàn thành trên tổng = số hoàn thành ÷ tổng đơn; thành công trên đơn đã kết thúc = hoàn thành ÷ (hoàn thành + không thành công). Không có mẫu số thì hiện Chưa có dữ liệu.
- Ví dụ 100 đơn gồm 50 huỷ/hoàn, 30 hoàn thành, 20 đang xử lý → lần lượt 50%, 30%, 37,5%. Không suy rằng 50 đơn chưa huỷ đều thành công.
- Tách trạng thái đã huỷ, hoàn/đang hoàn hàng, hoàn tiền, thất bại/mất/hỏng theo bằng chứng trạng thái đang lưu. Giao thất bại đang chờ xử lý không bị ép thành huỷ nếu bộ phân loại hiện tại vẫn xem là đang giao. Không thay đổi trạng thái nghiệp vụ để phục vụ báo cáo.
- Lý do POS lấy từ snapshot huỷ. Đơn web lấy lý do mới nhất của thao tác `web-order-cancel` trong audit CRM; truy vấn một lô theo ID đơn thuộc cửa hàng được phép, dùng chỉ mục audit theo entity sẵn có, không query từng đơn. Không trả snapshot POS/audit nguyên khối cho trình duyệt. Không có bằng chứng lý do thì ghi Chưa ghi nhận lý do, không tự đoán từ trạng thái GHN.
- Lý do được gom theo nội dung (bỏ khoảng trắng thừa, không phân biệt hoa/thường), có số đơn và tỷ trọng trong nhóm không thành công. Nội dung server chỉ đưa vào `textContent`.

### Cảnh báo quảng cáo theo đơn web

Tính riêng đơn website trong cùng tập lọc; loại đơn POS/quầy khỏi mẫu số đánh giá quảng cáo. Cần ít nhất **30 đơn web đã kết thúc**. Tỷ lệ cảnh báo = đơn web huỷ/hoàn/thất bại ÷ (đơn web hoàn thành + huỷ/hoàn/thất bại). Đơn đang chờ xử lý được hiện số lượng riêng, không coi là thành công hay dùng để làm loãng tỷ lệ.

- Dưới 30 đơn kết thúc: chưa đủ mẫu, không cảnh báo cắt ngân sách.
- Dưới 10%: theo dõi.
- Từ 10% đến dưới 20%: cảnh báo cần rà soát nguyên nhân, chất lượng khách và xử lý/giao hàng; mục tiêu về dưới 10% huỷ/hoàn.
- Từ 20%: cảnh báo đỏ đề nghị xem xét giảm/tạm dừng ngân sách quảng cáo nguồn liên quan và cải thiện về dưới 10% trước khi tăng ngân sách.

Ngưỡng so bằng số đếm gốc, không dùng tỷ lệ làm tròn để quyết định. Cảnh báo hiển thị ngay ở bảng đơn và trong popup, không thêm HTTP hay query CSDL. Đây là các mốc thử nghiệm, chưa phải chuẩn đánh giá ngành hoặc khẳng định quảng cáo có lỗi. CRM chưa có dữ liệu chi phí/chiến dịch hay nguồn khách trả phí, nên cần đối chiếu trước khi quyết định. **Không tự đổi ngân sách, phạt hoặc trừ lương**; không gán lỗi nhân viên. Đơn web chưa có người bán gắn trên đơn.

## 4. Chữ trang Công việc

Trang vốn dùng cùng Be Vietnam Pro với CRM; cảm giác khác chủ yếu do tiêu đề việc ở weight 650 (các file font hiện có là 400/500/600/700) và nhiều chữ đậm cùng xuất hiện. Chuyển tên việc/người nhận/ngày hạn/nhóm sang 500, trạng thái 400, giữ nhấn thẻ/tab đang chọn ở 600. Chữ dòng việc desktop dùng token 14px như bảng CRM; tên việc mobile giữ 16px. CSS chỉ giới hạn trong `#view-tasks`, giữ màu hạn/ưu tiên, bố cục và chức năng.

## 5. Kho trong phiếu cân bằng mới

Mọi lần mở form mới đều có option rỗng Chọn kho… (kể cả mở từ thẻ kho). Không kế thừa kho lọc, kho đầu danh sách hoặc kho của phiếu trước. HTML `required` và kiểm tra trong submit cùng chặn gửi nếu chưa chọn kho hợp lệ. Lần gửi chưa rõ kết quả vẫn giữ payload cũ để thử lại; không cấp lại mã hoặc đổi kho khi replay.

## 6. Dấu và màu Sổ kho

Nhập kho hiện + và xanh lá; xuất kho hiện − và đỏ; tồn sau hiện xanh lơ đậm đủ tương phản. Dòng tổng dùng cùng cách hiển thị; ô không phát sinh vẫn là dấu gạch trung tính, tổng 0 vẫn là 0. Không đổi số backend hoặc số liệu trong file xuất. Tồn âm vẫn giữ dấu âm theo số thật.

## Kiểm chứng

- Typecheck và `git diff --check`.
- 67 test liên quan UI POS, phân bổ, sinh đơn, chống bấm trùng/giữ revision, bộ lọc và quyền điều chuyển.
- 5 test board/domain/API: hơn 500 đơn vẫn tính đủ trước phân trang; source/cửa hàng/nhân viên/ngày; không bị lọc thanh toán/trạng thái bóp méo; đơn đang xử lý; mẫu số 0; lý do POS; lý do audit web mới nhất; trạng thái hoàn/thất bại và lý do còn thiếu.
- Chromium 1280px/390px với module UI và `confirmBox` thật, dữ liệu giả: hàng bị ẩn trước khi chọn/được xoá khi bỏ kho, đổi kho có tồn đúng; xác nhận bị khoá đủ 3 giây; bỏ huỷ 0 ghi; xác nhận 1 ghi đúng ID/revision; báo cáo hiển thị 100/50/30/20, 50%, 37,5%; không lỗi JS. Bổ sung cảnh báo ngân sách, font Công việc weight 500 cùng Be Vietnam Pro, form cân bằng để trống kho/không gửi khi trống/ghi đúng kho đã chọn/mở phiếu tiếp lại trống, và dấu/màu Sổ kho. Chặn mọi origin ngoài localhost.
- Browser script: `PLAYWRIGHT_MODULE=<module Playwright> node scripts/testing/warehouse-and-transfer-guards.mjs`; cần Chromium ở `/usr/bin/chromium`. Test dữ liệu WASM dùng `node --import tsx --test --test-isolation=none --test-reporter=spec ...` trong môi trường có giới hạn native worker.

[Browser results](results.json) · [Chưa chọn kho](before-390.png) · [Xác nhận huỷ](confirm-390.png) · [Báo cáo trên mobile](analytics-390.png) · [Chữ Công việc trước](tasks-before-1280.png) / [sau](tasks-after-1280.png) · [Chọn kho cân bằng](inventory-empty-390.png) · [Dấu/màu Sổ kho](ledger-390.png).

Không migration; không truy vấn/chỉnh dữ liệu production; không merge/deploy; không thay đồng bộ GHN/Sapo hoặc cron.

Bổ sung sau phản hồi: nhóm 55 test POS/analytics/task-cache/cards/điều chuyển đạt; browser kiểm cả 1280px và 390px. Script dùng CSS tại commit b7303b8 làm mốc ảnh trước, cần checkout có lịch sử commit này.
