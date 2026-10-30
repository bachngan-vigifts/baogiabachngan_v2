# HĐKT → Biên bản bàn giao & nghiệm thu

Phạm vi đã được chủ repo xác nhận: bảng trong **Biên bản bàn giao & nghiệm thu** lấy từ HĐKT, áp dụng cả Bách Ngân và VIGIFTS. Sửa thêm ngày ký VIGIFTS và địa điểm giao hàng mục 5.2.

## Lỗi trước thay đổi

- Biên bản dùng bảng riêng: mẫu Bách Ngân đảo vị trí mô tả/tên; mẫu VIGIFTS có cột đóng gói riêng. Cả hai thiếu các dòng tổng tiền trước VAT, VAT và tổng thanh toán như HĐKT.
- Các đoạn Word đã lưu có thể ghi đè ngày ký mới bằng ngày cũ. Bản xem áp chỉnh sửa trực tiếp theo cách khác với luồng tải Word.
- Mục 5.2 trong mẫu VIGIFTS có chữ hướng dẫn cố định; thay thế chuỗi nguyên văn không xử lý được khi Word chia chữ qua nhiều run.

## Thay đổi

- Dựng HĐKT đầy đủ, áp các đoạn Word đã sửa, rồi chép nguyên bảng sản phẩm và tiền sang biên bản. Bao gồm mô tả, số lượng, đơn giá, thành tiền, tổng trước VAT, VAT, tổng thanh toán, bằng chữ và định dạng bảng.
- Chép cả các style còn thiếu và style gốc mà chúng kế thừa. Giữ header, thông tin hai bên, phần ký và điều khoản của biên bản.
- Bảng biên bản chỉ đọc; hướng dẫn sửa ở tab HĐKT. Những sửa riêng cũ trong bảng biên bản nhường cho bảng HĐKT. Các sửa ngoài bảng được đối chiếu hash và chuyển đúng vị trí khi số đoạn thay đổi. Bản sửa không đối chiếu được được báo lỗi để dựng lại, không áp sang đoạn khác.
- Ngày ký và địa điểm giao hàng là trường lấy từ form; chữ cũ đã lưu không ghi đè lại. Chúng chỉ sửa qua form. Ngày ký cũng dùng khi dẫn chiếu HĐKT trong hai hồ sơ còn lại.
- Bản xem, tải Word riêng và tải ZIP dùng chung bước chuẩn bị nội dung và đối chiếu các đoạn đã sửa.

Không thay API, schema, quyền, công thức tiền/thuế/chiết khấu, tồn kho hoặc tích hợp. Không lưu hoặc thay hồ sơ thật khi kiểm thử.

## Kiểm tra

- `npm run typecheck` và `npm run ui:build`: đạt.
- Chạy trực tiếp bốn file test qua `node --import tsx`: contract-document, contract-terms-layout, contract-representative và quote-payment: **18 test đạt**, không lỗi.
- `PLAYWRIGHT_MODULE=/tmp/pos-browser/node_modules/playwright/index.mjs node scripts/testing/contract-document-consistency.mjs`: đạt cả hai bộ mẫu thật.
- Kiểm tra XML bảng biên bản giống nguyên bảng HĐKT đã áp mô tả Word; đủ các dòng tiền; chép style; giữ và chuyển vị trí đoạn ngoài bảng; mở lại đoạn đã chuyển; từ chối đoạn cũ không khớp.
- Kiểm tra ZIP kể cả khi đảo thứ tự ba mẫu; dựng preview; dùng editor thật để đổi ngày/địa chỉ, sửa mô tả HĐKT, chuyển tab biên bản và tải Word riêng. Không lỗi JavaScript. Có ảnh editor 1280px và 390px.
- Bấm tải ZIP khi bản xem đang nạp chậm: vẫn đợi đủ dữ liệu mô tả, không tạo file thiếu Bộ gồm/In ấn. Các lượt tải và preview chia sẻ một lần nạp dòng báo giá.
- Toàn bộ bộ test chạy tiếp trên CI của PR.

Các ảnh và `results.json` trong thư mục này lấy từ fixture cục bộ. File Word tải thử nằm trong `/workspace/scratch/contract-document-consistency`, không phải hồ sơ khách thật.

## Liên kết điều khoản và mẫu chung (30/10/2026)

- Chi tiết HĐKT nhận tỷ lệ cọc, hạn thanh toán theo số ngày, thời gian và địa chỉ giao hàng từ báo giá nguồn. Dữ liệu được nối vào truy vấn HĐKT hiện có, không thêm request hay truy vấn riêng khi mở đơn.
- Khi lưu hồ sơ, API cập nhật đúng các điều khoản đã thay đổi vào JSON báo giá, giữ nguyên sản phẩm, giá, VAT, địa chỉ pháp lý khách hàng và các ghi chú khác. Báo giá có bản lưu `quote_revisions` và audit chỉ rõ HĐKT nguồn.
- Kiểm tra cả phiên bản HĐKT và báo giá; báo giá vừa đổi thì trả 409, toàn bộ giao dịch HĐKT/báo giá/lịch phải thu được hoàn tác. Giữ quyền Manager đối với tỷ lệ cọc, số ngày thanh toán và báo giá đã duyệt.
- Lưu báo giá theo luồng hiện có cũng cập nhật các điều khoản tương ứng vào HĐKT và lịch phải thu. Nội dung hạn thanh toán dạng chữ được giữ khi chỉ sửa trường khác, không tự đổi thành 0 ngày. Không đổi các chuyến giao hàng thực tế.
- Hai pháp nhân dùng chung `trial-ui/mau-bien-ban-ban-giao-nghiem-thu.docx`, điền riêng tên công ty, địa chỉ, MST và người đại diện. Cả bộ hồ sơ dùng Times New Roman, kể cả bảng sao chép, bản xem và Word/ZIP.
- Các đoạn ngày ký, thời gian/địa chỉ giao hàng và điều khoản thanh toán trong HĐKT theo ô điền mẫu. Các sửa chữ trước khi đổi font được đối chiếu hash của đoạn cũ trước khi chuyển sang font mới; không bỏ kiểm tra hash.
- Biên bản cũ có sửa văn bản trực tiếp dựa trên mẫu riêng từng pháp nhân có thể cần **Dựng lại hồ sơ này** nếu không đối chiếu được đoạn với mẫu chung. Không tự xoá sửa chữ đã lưu hoặc áp sang đoạn khác; các file mẫu cũ vẫn được giữ trong repo.
- Không cần migration. Kiểm tra bằng `tests/app/contract-quote-terms.test.ts`, các test HĐKT hiện có và `scripts/testing/contract-document-consistency.mjs` (Chromium cục bộ, dữ liệu giả).

Ảnh bản xem mới: [Bách Ngân](shared-bbnt-bach-ngan.png) · [VIGIFTS](shared-bbnt-vigifts.png). Nội dung trong ảnh là dữ liệu giả để kiểm thử.
