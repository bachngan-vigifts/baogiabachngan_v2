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

Tìm sản phẩm từ danh mục đã tải và cache hiện có; chỉ fallback sang tìm API khi chưa có danh mục. Không tải toàn bộ danh mục lại theo mỗi phím gõ. Chọn sản phẩm hiện ngay tồn có sẵn, rồi lấy lại tồn tất cả dòng bằng một request theo lô, gộp các lượt thêm gần nhau. Mỗi phiếu tối đa 1.000 mã. Không gọi giá hoặc tồn theo từng dòng trong vòng lặp.

Nháp kiểm kê tự lưu trong localStorage theo tài khoản, chỉ trên thiết bị/trình duyệt đang dùng; chưa có phiếu nháp trên máy chủ. Không nhập đè số thực đếm khi lấy lại tồn; sau phát sinh kho phải kiểm tra lại số thực tế.

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
- **Tạo nhanh danh sách mã** (`POST /inventory/count-candidates`): theo thương hiệu, mọi mã còn tồn trong kho, hoặc 50 mã lệch Sapo nhiều nhất; trả tồn sổ kho và phiếu kiểm kê chờ duyệt của từng mã, tối đa 1.000 mã/phiếu.
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
