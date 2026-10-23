# Rà soát huỷ đơn/HĐKT, giao hàng, hoàn tiền và hàng trả — 22/10/2026

## Kết luận

Quy trình trước bản sửa có lỗi. Sáu ca kiểm thử tái hiện ban đầu đều fail trên main trước sửa. Không nên coi đổi nhãn “đã huỷ” là đã nhận lại hàng hoặc đã hoàn tiền.

Báo cáo này chỉ chứa phân tích code/test, không công bố danh sách chứng từ hoặc thông tin khách hàng từ production. Đối chiếu live được lưu riêng trong workspace và gửi trực tiếp cho người yêu cầu; không sửa dữ liệu lịch sử.

## Lỗi và cách sửa

| Điểm | Hành vi trước sửa | Hành vi sau sửa |
| --- | --- | --- |
| Huỷ qua `PUT /contracts/:id` | Chỉ đổi nhãn HĐKT, đơn vẫn hoạt động và chưa hoàn kho; có thể lách điều kiện đã thu/đã giao | Cùng transaction kiểm tra điều kiện, huỷ đơn + HĐKT, đồng bộ sổ kho và chứng từ con |
| Huỷ đơn gốc của HĐKT | HĐKT còn Nháp/Đã ký | Đồng bộ HĐKT sang cancelled |
| Huỷ khi đang vận chuyển | Chưa có deliveredQty nên có thể hoàn tồn tự động dù hàng đã rời kho | Trả 409 RETURN_REQUIRED; yêu cầu quy trình thu hồi/nhận hàng thực tế |
| Lùi nhãn giao hàng | Có thể lùi in_transit/failed về planned rồi lách huỷ | Lưu dispatch trong audit cùng transaction và kiểm cả lịch sử; không xoá dấu vết bàn giao khi đổi nhãn |
| COD thường đã xuất chưa giao | Không lập được thu hồi như đơn trả trước | API và UI detail cùng nhận biết after_issue; dùng duyệt → nhận hàng → hoàn/tất toán hiện có |
| Hai đường nhận hàng POS | Phiếu trả restock xong vẫn dùng nút nhận hoàn đơn huỷ, cộng kho lần nữa | Chặn đường legacy nếu có phiếu trả/đổi còn hiệu lực, ẩn nút nhận legacy, cùng cash lock |
| GHN trong khi thu hồi/đã huỷ | Có thể tiếp tục giao/ghi nhận thu trong luồng không kiểm phiếu thu hồi | Chặn tiếp tục giao khi có thu hồi; không hồi sinh đơn đã huỷ, không ghi thu/xuất mới |
| Huỷ đóng gói đọc trạng thái cũ | UPDATE vô điều kiện có thể ghi đè Đã đóng thành Đã huỷ | Lock đơn + update có điều kiện và kiểm kết quả; không mất phát sinh kho/ảnh |
| Ghi thu đọc trạng thái cũ | Chỉ kiểm trạng thái trước transaction, có thể ghi thu sau khi đơn vừa bị huỷ | Kiểm lại trạng thái sau lock đơn, không tạo phiếu thu |
| Giao thất bại | API thiếu cạnh in_transit → failed dù mô tả cho phép | Cho phép đánh dấu thất bại từ planned hoặc in_transit, giữ dấu vết bàn giao |

| Nhận hoàn đơn POS đã huỷ | Nút chỉ có ở bảng POS, thiếu tại chi tiết đơn | Thêm nút tại chi tiết, đọc phần còn xuất theo mã + kho, yêu cầu xác nhận hàng thực tế; giữ quyền theo quầy |
| Xoá đơn có lịch sử kho | Có thể mất chứng từ nguồn của hàng còn chờ về | Chặn xoá khi có lịch sử kho/phiếu trả còn hiệu lực |
| Thu hồi COD chưa thanh toán phí | Có thể huỷ đơn trong khi còn khoản phí phải thu | Duyệt trả 409 RETURN_FEES_UNSETTLED cho tới khi phí được thanh toán hoặc đưa vào yêu cầu giảm được Manager duyệt |

## Quy trình an toàn hiện có sau sửa

1. Đơn/HĐKT nháp hoặc đã duyệt nhưng chưa thu, chưa giao, chưa bàn giao vận chuyển: người có quyền huỷ; các thay đổi trạng thái/sổ kho/chứng từ con phải cùng transaction. Hàng đã đóng nhưng còn tại kho được đảo đúng phần đã ghi xuất. Không tự tạo phiếu chi.
2. Huỷ lịch giao chưa bàn giao chỉ đóng lịch, không tự tạo tiền hoàn hoặc coi hàng đã quay về. Đơn vẫn hoạt động thì có thể lên lịch khác.
3. Đã bàn giao/đã giao: không huỷ thẳng để cộng tồn. POS dùng yêu cầu thu hồi/trả hàng; CRM/HĐKT còn thiếu luồng chuyên biệt (xem giới hạn).
4. Phiếu POS trả/thu hồi: lập yêu cầu → duyệt → xác nhận nhận đủ hàng thật tại đúng quầy/ca → giảm công nợ/nhập lại phần bán được → xác nhận thực hoàn hoặc dùng tín dụng đổi hàng → hoàn tất.
5. Duyệt không nhập hàng hoặc chi tiền. Hàng hỏng có nhận nhưng không cộng tồn bán. Tiền hoàn bị chặn theo thực thu còn hiệu lực, giá trị được hoàn và phần tín dụng đang giữ; replay không chi hai lần. Tiền mặt ghi chi ở ca thực hoàn, chuyển khoản cần tham chiếu; không tự chuyển tiền qua ngân hàng.
6. Huỷ cọc/trả trước khi chưa xuất là before_fulfillment: giải phóng giữ, đóng khoản chờ, lập yêu cầu duyệt hoàn nếu có thực thu; không nhập hàng giả.
7. Huỷ phiếu thu ghi nhầm là sửa chứng từ thu, không phải hoàn tiền cho khách. Phiếu hoàn tiền đã thực chi không được huỷ qua màn chi thông thường. Ca đã kết giữ snapshot và mở tra soát theo cơ chế hiện có.

## Giới hạn chưa phải luồng hoàn chỉnh

- CRM/HĐKT đã thu tiền hoặc đã giao chưa có chứng từ trả hàng/hoàn tiền chuyên biệt như POS. Luồng huỷ được chặn an toàn; không lách bằng huỷ phiếu thu để giả làm hoàn tiền. Muốn xử lý đầy đủ cần thiết kế thêm chứng từ, phê duyệt và liên kết kho/quỹ/công nợ riêng.
- Huỷ chứng từ CRM không tự huỷ đơn Sapo hoặc xử lý hoá đơn VAT đã phát hành. Giữ nguyên luồng huỷ vận đơn GHN có sẵn trên main cho đơn/chuyến đủ điều kiện; lỗi huỷ bên GHN vẫn phải được đối chiếu. Những chứng từ bên ngoài cần được đối chiếu và xử lý ở hệ thống phát hành; trạng thái cancelled trên CRM không phải bằng chứng đã xử lý chúng.
- Xác nhận nhận hàng hiện là nhận đủ phiếu, không hỗ trợ nhận từng phần trên cùng phiếu. Nếu hàng về thiếu hoặc đổi tình trạng, cần xử lý/tách yêu cầu đúng số lượng trước khi xác nhận.
- Không sửa dữ liệu lịch sử. Nhãn cũ đã bị lùi và thiếu audit cần kiểm tra thực tế; bản sửa không thể tự dựng lại lịch sử bàn giao đã mất.
- Các kiểm thử tranh chấp trong báo cáo này chèn thao tác đã commit giữa lần đọc và transaction để tái hiện yêu cầu dùng trạng thái cũ. Không tuyên bố đây là thử cạnh tranh hai kết nối PostgreSQL thật.
- Không thay schema/migration, quyền, công thức giá/COD/lương, Sapo sync hay lịch cron. GHN chỉ thêm guard khi áp dụng trạng thái và audit bàn giao.

## Kiểm thử

- `npm run typecheck`: qua.
- `npm run ui:build`: qua.
- `npm test`: 851 test, 820 pass, 0 fail, 31 skip. Lượt này bắt đầu trước các bổ sung cuối về phí COD, nút nhận hoàn ở chi tiết và guard xoá; không coi là full suite trên toàn bộ bản cuối.
- Lượt bổ sung `cancellation-audit.test.ts` + `pos-audit.test.ts`: 19 pass, 0 fail, 0 skip trên bản có đủ các bổ sung cuối.
- Lượt bổ sung `order-delete.test.ts` + `warehouse-sales.test.ts`: 13 pass, 0 fail, 0 skip trước đồng bộ main.
- File mới `tests/app/cancellation-audit.test.ts`: 12 ca gồm huỷ HĐKT, đồng bộ huỷ đơn, chặn HĐKT đã thu, chặn hoàn ảo đang vận chuyển, thu hồi COD, chặn nhận hai đường, GHN trong thu hồi, lùi trạng thái giao, huỷ đóng gói dùng trạng thái cũ, ghi thu dùng trạng thái cũ, COD còn phí, chi tiết nhận hoàn/không xoá/không nhập hai lần.
- 31 skip gồm các đối chiếu repo legacy không có trong môi trường và kiểm thử tranh chấp PostgreSQL hai kết nối chưa có harness phù hợp. Không báo những ca đó đã qua.

Test cũ sửa có chủ đích: `kế hoạch báo giá: duyệt trước, xuất từng phần; thiếu nguồn bổ sung không làm âm kho` trong warehouse-sales.test.ts trước đây huỷ sau khi hai chuyến đã in_transit và kỳ vọng tự cộng 70 vào kho. Đổi thành 409 RETURN_REQUIRED, số dư giữ 0 vì hàng chưa được chứng minh đã về. Thêm test riêng huỷ hai phần đã đóng nhưng chưa bàn giao, hoàn đúng 10 về kho và không cộng lại khi gọi huỷ lần hai. Không nới guard hoặc đổi fixture sang tồn âm.

Đồng bộ main `7446b31`: giữ nguyên tạo/huỷ vận đơn GHN và cập nhật địa chỉ đơn web từ PR #243; giải quyết conflict huỷ đơn bằng cách giữ danh sách vận đơn cần huỷ và dùng cleanup chứng từ nguyên tử mới. Kiểm tra lại sau đồng bộ được ghi trong mô tả PR.
