# Cổng NCC, liên kết phiếu và lọc danh mục POS

Một PR gồm 4 yêu cầu, từ main `4b4dc12`.

1. Cổng NCC có nút quay về. Manager có link tên SP → thẻ tồn/lịch sử CRM, số đơn CRM/NCC → đơn mua, số phiếu → trang Lấy hàng trước. Dưới trạng thái là nút Xem chi tiết: tab toàn bộ đơn mua của NCC trên phiếu, phiếu xin hàng (đi hết phân trang), tồn các mã trên phiếu. Đóng hoặc bấm liên kết không giữ dialog che trang mới. NCC thật không có chức năng/truy vấn này; quyền API giữ nguyên theo xác nhận của chủ repo.
2. Tiêu đề nhóm `NCC: DDLT...` ở CRM mở thẳng đơn mua. Nếu cùng số NCC có nhiều đơn CRM thì hiện riêng từng mã đơn để chọn; không chọn nhầm một đơn mặc định.
3. Cột Đã nhận trên từng dòng hàng đơn mua hiển thị **nhận đạt** (`good`) đã có từ API. Bấm số mở những phiếu xin hàng có `receivedQty > 0` đúng SKU và orderId. Không dùng số xin/đồng ý thay số thực nhận. Phần nhận thường/nhập cũ không có provenance được ghi rõ; nhận bị huỷ không được liệt kê khi API trả receivedQty=0. Không đổi cách nhận, tồn kho hoặc tính số lượng.
4. POS: quầy Lock ẩn nhóm Minh Long/LYS/Healthy Cook/sứ dưỡng sinh; quầy Minh Long ẩn Lock/LocknLock/Lock&Lock. Dựa trên tên quầy rõ ràng và nhãn hàng/tên SP. Tên quầy chung hoặc chưa xác định, sản phẩm dùng chung/chưa nhận diện giữ như cũ. Lọc trong truy vấn catalog **trước limit/offset**, cả barcode và skus; xem thêm/trang tiếp và Tìm tất cả SP không đưa lại nhãn hàng đối diện. Preview gõ tìm dùng cùng hàm/pattern được build; cache tách theo quầy/bảng giá, gắn request cũ đúng quầy khi đổi quầy trong lúc tải. Không xoá dòng giỏ đang có hoặc đổi quyền checkout.

Không thêm endpoint, tham số API, schema, dependency hoặc quyền. Có thay WHERE của endpoint POS catalog hiện có để thực hiện yêu cầu lọc theo quầy; không thay công thức tiền/thuế/CK, trừ tồn, Sapo/GHN/cron. Các chức năng Manager dùng endpoint staff hiện có, NCC thật vẫn được server chặn truy cập dữ liệu nội bộ.

## Validation

- Typecheck, UI build, diff check đạt; [87 test liên quan đạt](tests.txt), gồm catalog filter trước phân trang, barcode bị ẩn không còn exactSku; hydration đúng SKU; preview không chớp nhãn hàng khác lúc đang tải; scope/quyền quầy và tồn giữ nguyên; early request/receiving API và UI.
- Browser router thật + PGlite: Manager/NCC ở 390/1280px; back, link đơn từ tiêu đề, 3 tab chi tiết, số thực nhận 4 với liên kết phiếu nguồn; bấm phiếu đóng dialog và điều hướng đúng. NCC không có truy vấn purchase-orders/products. Không tràn trang hoặc pageerror; browser không ghi dữ liệu nghiệp vụ. Chỉ fixture local được seed/nhận thử, không gọi production.
- POS browser regression: cuộn chạm grid → giỏ, phân trang/retry, chọn khách, resize desktop/mobile. 375x667,390x844,768x1024,844x390 và desktop.

[Manager 390](portal-mgr-390.png) · [Manager 1280](portal-mgr-1280.png) · [Đơn mua](detail-orders-390.png) · [Tồn](detail-stock-390.png) · [Đã nhận 390](received-390.png) · [Đã nhận 1280](received-1280.png) · [NCC thật](portal-ncc-390.png).

Dừng ở PR để chủ repo duyệt; không merge/deploy.

## Bổ sung theo các yêu cầu tiếp theo

### Nút trở lại toàn cục

- Một nút `‹ <tên trang trước>` trên thanh đầu CRM; mọi trang cùng dùng một phần tử. Giữ Back/Forward thật của trình duyệt, kiểm tra lại quyền khi quay về và không dùng lịch sử của tài khoản trước.
- Link chi tiết mở trực tiếp dùng trang danh sách làm đích dự phòng. Vẫn hỏi xác nhận khi rời báo giá đang sửa; nút giữ lại luôn hiện trực tiếp trong hộp xác nhận.
- Thanh đầu hiện cả POS desktop để có nút trở lại như yêu cầu mới. Drawer chừa chỗ thanh đầu để nút không bị lớp phủ che. Các thay đổi desktop này được yêu cầu sau phạm vi mobile ban đầu.
- Browser local/router thật ở 360/390/430/768/1280px: 28 trang, Back/Forward, link sâu, giữ/rời bản nháp, 5 lần chạy lại route không thêm nút, không lỗi JS hoặc tràn thanh đầu. Không phải phép thử 5 lần auto-refresh toàn bộ dữ liệu. [Kết quả](page-back-results.json).
- [POS 390](pos-390.png) · [POS 1280](pos-1280.png) · [Kho 390](inventory-390.png) · [Kho 1280](inventory-1280.png).

### Đối soát tiến trình các đơn đã giao

Đã kiểm tra 142 đơn đã giao (49 CRM, 93 POS). Có 50 đơn tiến trình xuất chưa đủ bằng chứng theo luồng hiện có.

- **21 POS COD đã cập nhật trực tiếp:** kiểm tra đủ lượng xuất ròng từng SKU, đúng kho từ snapshot lúc bán và đúng đơn/phiếu giao; thêm dấu export và nhật ký đối soát. Không phát sinh bút toán kho, phiếu giao, thu/chi hoặc sửa trạng thái đơn.
- **DH_20261017_001 và DH_20261017_002:** chủ repo xác nhận hàng đã trừ tại **KHO VIGIFTS** trong chat. Hai đơn giao trước kỳ mở sổ 18/10, không có chứng từ xuất cũ liên kết. Đã lưu xác nhận lịch sử và snapshot từng dòng vào audit, kèm dấu export; không giả lập phiếu xuất/Sapo. Bản sửa chỉ dùng xác nhận này để hiển thị tiến trình khi đơn vẫn đóng, đủ lượng đã giao, dữ liệu không đổi và mark khớp audit. **Cần merge/deploy bản sửa sau duyệt mới thay đổi hiển thị cho hai đơn này.**
- **27 CRM còn lại:** giữ trạng thái cần đối soát vì chưa đủ bằng chứng liên kết; không tự gán kho hoặc hoàn thành.
- `crmStockFulfilment`, chặn xuất/giao mới và chặn hoàn thành theo chứng từ thực tế giữ nguyên. Nếu mở lại đơn hoặc sửa dòng/số lượng, xác nhận lịch sử không còn được dùng. Test kiểm tra guard hoàn thành vẫn từ chối khi thiếu bằng chứng xuất.
- Các lần ghi đều có audit `support_automation`, không mạo danh nhân viên xác nhận. [Danh sách kết quả từng đơn](progress-reconciliation.csv).

Đối chiếu ngay trước/sau mỗi lần ghi:

| Lần đối soát | Số dòng sổ kho | Hash sổ kho trước = sau | Hash tồn trước = sau |
|---|---:|---|---|
| 21 POS | 2.975 | `fa84bb28db960606982b71c3987b1498` | `69501051c681f2cc69a6c02e55b83656` |
| 2 CRM lịch sử | 2.979 | `daa1a1f73a82a572c2da786cad323b26` | `3c1e408c1da3b3d43757b491f73981c1` |

Giữa hai lần có 4 bút toán adjustment từ thao tác khác trên hệ thống lúc `2026-10-27T02:30:39.079Z`, không thuộc đợt đối soát này. Không hoàn tác các bút toán đó.

### Kiểm tra bổ sung

- Typecheck, build UI và diff check đạt.
- 13 test trực tiếp đạt: page-back (2), legacy-stock-progress (1), order-progress (4), pos-counter-progress (1), trial-ui (5).
- Bộ test toàn repo đang chạy; chưa coi kết quả kiểm tra riêng là kết quả toàn bộ.

### Trả hàng CRM — chưa triển khai, chờ duyệt mở phạm vi

[Phương án cụ thể, điểm cần đổi API/schema và ví dụ đối trừ của DH_20261014_002](crm-return-proposal.md). Chưa tạo phiếu trả hoặc hoàn tiền thật. Đây là đề xuất để duyệt, không phải tính năng đã hoàn thành.

### HĐKT mở toàn trang như Đơn hàng

Theo yêu cầu mới, bỏ hẳn popup/drawer HĐKT cả desktop lẫn mobile. `#view-order` luôn ở nguyên trong `main`; không bọc các phần thông tin thành accordion, không giữ danh sách HĐKT làm nền. Giữ nút xem/tải hồ sơ, in phiếu và lịch sử hiện có. Không đổi dữ liệu hay API hợp đồng.

Browser router thật ở 360/390/430/768/1280px: bấm danh sách mở toàn trang, quay lại danh sách/Back, đổi kích thước, 5 lần render lại không nhân đôi chi tiết/nút hồ sơ; không popup, tràn trang hoặc lỗi JS. [Kết quả](contracts-full-page-results.json) · [390px](contract-390.png) · [1280px](contract-1280.png).
