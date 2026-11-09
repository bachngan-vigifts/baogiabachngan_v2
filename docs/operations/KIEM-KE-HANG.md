# Kiểm kê hàng và cân bằng kho

Menu Kho & Giao hàng có hai trang:

- **Kiểm kê hàng** (`#/stocktake`): nhập số thực đếm theo kho, lưu nháp trên thiết bị, gửi phiếu chờ Manager duyệt.
- **Cân bằng kho** (`#/inventory`): đối chiếu CRM/Sapo và xem, xét duyệt phiếu cân bằng; thay tên Đối chiếu tồn Sapo.

## Quyền và thời điểm ghi kho

`inventory.view` cho phép xem; `inventory.manage` cho phép lập đề nghị. Chỉ tài khoản có vai trò Manager được duyệt/từ chối và chốt tồn đầu kỳ; cấp quyền lập đề nghị cho nhân viên không cho phép tự ghi tồn.

Phiếu kiểm kê luôn ở trạng thái chờ duyệt lúc gửi, kể cả Manager lập. Chỉ khi Manager duyệt hoàn thành, chênh lệch thực đếm trừ tồn đối chiếu mới được ghi vào sổ kho. Số 0 là một kết quả kiểm đếm hợp lệ; ô chưa đếm phải được nhập, không tự coi là 0. Dòng không lệch vẫn lưu trong phiếu nhưng không sinh bút toán 0.

Sử dụng bảng phiếu điều chỉnh và JSON dòng hiện có, không thêm bảng hoặc migration. Phiếu kiểm kê lưu `source: stocktake`, số tồn đối chiếu, số thực đếm và chênh lệch. Số phiếu theo `KK_NNN_DDMMYYYY`; lịch sử đã gửi lọc riêng phiếu kiểm kê. Audit và bút toán dùng luồng điều chỉnh hiện có.

## Chống ghi nhầm, ghi lặp

- Cần chốt tồn đầu kỳ cho kho trước khi kiểm kê.
- Khi gửi và khi duyệt, máy chủ so tồn hiện tại với số đối chiếu. Khác nhau (bán / nhập sau lúc đếm) mặc định trả `STOCKTAKE_STOCK_CHANGED`, phiếu đang chờ chưa ghi tồn. Gửi kèm `applyDelta: true` thì duyệt **theo chênh lệch**: ghi đúng (thực đếm − tồn lúc đếm) vào tồn hiện tại, giữ nguyên phát sinh sau lúc đếm; audit ghi `appliedDelta` và danh sách mã đổi tồn. Màn duyệt hiện Tồn hiện tại / Tồn sau duyệt, tô vàng mã đổi tồn và đổi nút thành "Duyệt theo chênh lệch và ghi kho"; Manager vẫn có thể từ chối để kiểm đếm lại.
- So sánh số đối chiếu và ghi kho trong transaction, dùng khoá sổ kho độc quyền để không chen giữa bút toán khác, kể cả SKU chưa có dòng số dư.
- Mỗi lần gửi có client key cố định. Mạng lỗi hoặc 5xx giữ nguyên nội dung và key, khoá chỉnh sửa, cho kiểm tra lại đúng lần gửi. Gửi/duyệt lặp không ghi thêm tồn.
- Điều chuyển kho: khoá toàn bộ thao tác trong drawer, ẩn nút khác, hiện tiến trình và chặn đóng/mở/refresh thay drawer đến khi ghi và tải trạng thái xong; lỗi khôi phục điều khiển. Áp dụng cả gửi mới và lưu chỉnh sửa.

## Tốc độ và giới hạn

Tìm sản phẩm từ danh mục đã tải và cache hiện có; chỉ fallback sang tìm API khi chưa có danh mục. Không tải toàn bộ danh mục lại theo mỗi phím gõ. Chọn sản phẩm hiện ngay tồn có sẵn, rồi lấy lại tồn tất cả dòng bằng một request theo lô, gộp các lượt thêm gần nhau. Mỗi phiếu tối đa 300 mã, khớp ràng buộc CSDL hiện có (UI cũ cho 1.000 nên các phiếu trên 300 dòng có thể lỗi). Nháp cũ nhiều hơn giới hạn vẫn giữ để xem/bỏ bớt, không tự cắt mất số đếm. Không gọi giá hoặc tồn theo từng dòng trong vòng lặp.

Nháp kiểm kê tự lưu trong localStorage theo tài khoản, chỉ trên thiết bị/trình duyệt đang dùng; chưa có phiếu nháp trên máy chủ. Không nhập đè số thực đếm khi lấy lại tồn; sau phát sinh kho phải kiểm tra lại số thực tế.

## Popup tạo phiếu và xem nhanh sổ kho

- Nút **+** tạo phiếu mới trong popup, không tự mở tiếp phiếu cũ. Nếu đang có nháp, hỏi rõ trước khi bỏ; **Tiếp tục phiếu đang nhập** là thao tác riêng. Không tạo chứng từ máy chủ chỉ vì mở popup.
- Chọn kho đã chốt đầu kỳ, gõ tên/SKU/barcode để lọc danh mục ngay trên máy; khi chưa có cache, tìm API với debounce 180 ms. Bấm kết quả là thêm dòng, không cần nút thêm thứ hai. Chọn theo tên chưa tự coi là đã đếm; quét SKU/barcode vẫn cộng 1 như luồng cũ.
- Bảng nhập số thực đếm, tồn lúc đếm, chênh lệch, tồn sổ kho hiện tại từng kho được phép xem và phiếu chờ duyệt. `POST /inventory/count-stock` nhận thêm `includeWarehouses: true`, trả `warehouseStock[sku][warehouseId]`. Kho chưa mở sổ là `null` (hiển thị —), kho đã mở nhưng mã chưa có số dư là 0. Kho bị ẩn không xuất hiện trong dữ liệu. Không gửi danh sách kho do trình duyệt tự chỉ định; máy chủ dùng phạm vi sổ kho hiện có. Client cũ không bật cờ giữ nguyên phản hồi cũ.
- Tồn mọi dòng/mọi kho được đọc theo lô; không gọi API theo từng ô hoặc từng phím gõ. Các cột tồn kho chỉ để xem, không nhập tay, không lưu vào nháp thiết bị. Tồn được làm mới không thay ô số đếm đang nhập.
- **Sổ kho** trên từng dòng mở cửa sổ riêng từ API `/stock-moves` theo đúng SKU/kho, 20 phát sinh mỗi trang, có chọn kho và chuyển trang. Chỉ tải module khi bấm; xem xong số đếm vẫn nguyên. Link SKU cũ tiếp tục mở lịch sử kiểm kê.
- Đóng popup, Esc, chuyển trang hoặc đăng xuất khi có nội dung đều dùng xác nhận đếm ngược **3 giây**. Huỷ xác nhận giữ nguyên phiếu; đồng ý rời giữ nháp trên thiết bị. Nếu không lưu được thiết bị, thông báo nói rõ nguy cơ mất nội dung. Refresh/đóng tab dùng cảnh báo gốc của trình duyệt (trình duyệt không cho tự đổi thành đếm ngược 3 giây).
- Chặn thoát trong lúc đang gửi; chưa rõ kết quả vẫn giữ request key để kiểm tra lại, không tạo phiếu khác. Khi đã gửi thành công mới đóng popup và xoá nội dung nháp. Phiếu vẫn chờ Manager duyệt, chưa đổi sổ kho. Camera và xem nhanh được đóng theo popup; kết quả tìm/stock đến muộn bị bỏ qua sau khi đóng/đổi kho.
- Mobile dùng popup theo thiết kế hiện có và các dòng dạng thẻ, không thêm thanh điều hướng. Cơ chế trang chỉ đọc trên mobile không được ẩn nút kiểm kê trong lúc hash chuyển trang đang chờ xác nhận.

Kiểm tra: `tests/app/stocktake-cross-stock.test.ts`, `stocktake-list-ui.test.ts` cùng các bộ kiểm kê/di động/kiến trúc hiện có. Browser: `node --import tsx scripts/testing/stocktake-quick-editor.mjs after`; dùng `STOCKTAKE_UI_DIR` và `before` để đo UI gốc, `flows` để chạy riêng các luồng. Tất cả dùng API/CSDL thử cô lập, chặn request ngoài localhost; không chạy kiểm kê trên dữ liệu thật. Không thêm migration hay dependency.

Bộ lọc điều chuyển gồm số phiếu/SKU, kho đi, kho đến, người xin, trạng thái và khoảng ngày lập theo giờ Việt Nam. Lọc phía máy chủ trước giới hạn 300 phiếu; danh sách người xin chỉ lấy từ các phiếu người dùng được thấy. Chỉ khi bấm Lọc hoặc Enter mới gửi request; có nút xoá về bộ lọc Đang mở.

## Xác minh

- Test API: bộ lọc trước giới hạn 300, ranh giới ngày Việt Nam, kho riêng và danh sách người xin.
- Test giao diện điều chuyển: chống gửi trùng, ẩn nút khác, giữ khoá trong lúc tải trạng thái, phục hồi sau lỗi; giữ nguyên sao chép/sửa/tìm sản phẩm.
- Test kiểm kê: quyền Manager, gửi/duyệt lặp, số 0, dòng không lệch, chặn tồn đối chiếu cũ, giữ phiếu chờ nếu duyệt thất bại.
- Kiểm tra Chromium với API giả lập: tìm từ danh mục, tồn theo lô, nháp khôi phục sau reload, lỗi gửi không rõ kết quả và retry cùng key, giao diện desktop/mobile không lỗi JavaScript.

## Danh sách phiếu và kiểm tra trùng mã

Trang Kiểm kê mở ở danh sách phiếu; nút dấu + góc phải tạo phiếu mới. Có thể quay lại danh sách rồi tiếp tục nội dung chưa gửi. Tồn và phiếu chờ duyệt tự lấy theo lô khi thêm mã, mở lại phiếu đang nhập hoặc nối mạng/quay lại cửa sổ; không có nút Lấy lại tồn các mã.

Cột Phiếu kiểm kê chờ duyệt hiển thị các số phiếu theo đúng mã và kho. Bấm mở popup xem nhanh (và Manager có thể duyệt) ngay trên trang hiện tại, không cần lưu hoặc rời phiếu đang nhập. Phản hồi cập nhật tồn chỉ thay ô hiển thị liên quan, không dựng lại ô thực đếm đang gõ.

Nhân viên được xem phiếu kiểm kê của đồng nghiệp trong phạm vi kho được phép; quyền xem phiếu điều chỉnh thường của đồng nghiệp vẫn giữ nguyên. API riêng `/inventory/stocktakes/:id` chỉ trả phiếu kiểm kê trong phạm vi kho, không trả phiếu điều chỉnh thường hoặc kho riêng bị ẩn.

Khi có phiếu kiểm kê chờ duyệt cho cùng (kho, SKU), không gửi phiếu thứ hai. Máy chủ kiểm tra dưới khoá sổ kho độc quyền để hai người gửi đồng thời chỉ tạo được một phiếu; gửi lại cùng client key vẫn trả đúng phiếu cũ. Phiếu đã duyệt/từ chối và các phiếu thuộc kho khác không chặn nhau. Các phiếu điều chỉnh thường chờ duyệt không bị coi là kiểm kê trùng.

Nếu số thực đếm đã nhập mà tồn đối chiếu thay đổi khi cập nhật nền, giữ nguyên số đang nhập và đánh dấu "tồn đổi sau lúc đếm". Nhập lại số đếm thì dùng mốc tồn mới; gửi nguyên số cũ thì hỏi xác nhận rồi gửi theo chênh lệch (`applyDelta`). Dữ liệu phiếu chờ duyệt chưa tải được thì chưa cho gửi; lỗi tạm thời có một lần thử lại tự động.

## Công cụ khi kiểm đếm

- **Quét mã vạch** (ô "Quét mã vạch: mỗi lần quét +1"): máy quét gõ mã + Enter; khớp SKU hoặc barcode, cộng 1 vào thực đếm, mã chưa có trong phiếu thì tự thêm. Các lần quét xử lý lần lượt, không mất lượt khi quét nhanh.
- **Tạo nhanh danh sách mã** (`POST /inventory/count-candidates`): theo thương hiệu, mọi mã còn tồn trong kho, hoặc 50 mã lệch Sapo nhiều nhất; trả tồn sổ kho và phiếu kiểm kê chờ duyệt của từng mã, tối đa 300 mã/phiếu.
- **In phiếu đếm** (A4): mã, tên, ĐVT, tồn sổ kho, ô thực đếm trống (hoặc số đã đếm), chữ ký người đếm / Manager. Màn xem phiếu cũng có nút In phiếu.
- **Lịch sử kiểm kê theo mã** (`GET /inventory/stocktake-history?sku=&warehouseId=`): bấm SKU trong phiếu để xem các lần đếm, tồn lúc đếm, chênh lệch, trạng thái (trong phạm vi kho được xem).
- **Giá trị chênh lệch**: theo giá nhập gần nhất trong lịch sử sản phẩm (dòng Nhập hàng); chỉ Manager thấy (cột Giá trị lệch ở danh sách, cột Giá nhập / Giá trị lệch và tổng ở màn xem phiếu, file Excel). Mã chưa có giá nhập được đếm riêng, không tính vào tổng.

## Người được Cho / Từ chối phiếu điều chuyển

| Chức vụ người xin | Người được Cho / Từ chối |
| --- | --- |
| Sale Admin | NVBH Lock hoặc NVBH Minh Long; Manager được duyệt thay |
| NVBH Lock / NVBH Minh Long | Sale Admin; Manager được duyệt thay |
| Chức vụ khác, nhân viên xin đã ngừng hoạt động | Manager |

Manager là ngoại lệ duy nhất. Nhân viên không tự duyệt phiếu mình xin; cờ Được duyệt chung không vượt qua quy tắc đối ứng này. Quy tắc áp dụng cho cả nút thao tác và API. Kho riêng vẫn theo quyền xem kho hiện có.

Công việc tự sinh, thông báo tạo phiếu, nhắc sau một giờ và mục điều chuyển trong hộp Cần duyệt dùng cùng quy tắc. Không có người đối ứng được xem phiếu thì giao việc chờ Manager; không gửi thông tin kho riêng cho người không thấy kho đó. Chức vụ NVBH không có cờ duyệt chung vẫn xử lý qua phiếu/công việc/thông báo; hộp Cần duyệt chung giữ quyền truy cập hiện có cho các loại chứng từ khác.

Quyền xác nhận Đã chuyển và cách ghi sổ kho không thay đổi. Phần đầu phiếu tách trạng thái, kho đi/kho đến, người/ngày xin, lý do; chỉ hiện người duyệt/người chuyển khi có dữ liệu. Cột sản phẩm gộp tên và mã để tránh tên bị ép quá hẹp.

Đo Chromium lạnh 3 lần/viewport với API/CSDL cô lập: median sẵn sàng PC 3059 → 3079 ms, mobile 3030 → 3039 ms; số API lúc mở giữ 16, JS requests giữ 162, JS +5.070 byte. CLS giữ nguyên khoảng 0,00493 PC / 0,01892 mobile. Đây là số đo local, không phải tốc độ Supabase production. Chi tiết và luồng xác minh trong `docs/testing/stocktake-quick-performance.json`.
