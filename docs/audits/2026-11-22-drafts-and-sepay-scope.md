# Kiểm toán D2 / E1 — chỉ báo cáo, chưa thay đổi chính sách hoặc form

Cơ sở: main `f0a48ea6`, ngày 22/11/2026. Chỉ đọc mã và dùng fixture cục bộ. Không truy vấn production; không biết danh sách nhân viên/quyền thực tế ở production. Không gọi dịch vụ bên ngoài. Các phát hiện về form dưới đây là rà mã, không phải xác nhận đã thử toàn bộ đường đi trên thiết bị thật.

## D2 — Nháp và cảnh báo rời form

| Form | Đã có trong mã | Khoảng trống / điều cần giữ khi bổ sung |
|---|---|---|
| Báo giá | `trial-ui/quote-device-draft.js`: nháp theo user + ID + revision, TTL 7 ngày, tối đa 2 MB; chỉ đề nghị khôi phục khi revision trùng. `app.js`: markDirty/schedule; hashchange, beforeunload, logout có cảnh báo. Lưu thành công/xuất phiên xóa nháp. | Đây là mẫu tốt cho hồ sơ có revision. Khôi phục chỉ đưa vào form, không tự gửi; server vẫn phải so revision tại lúc lưu. Cần kiểm tra lại sau đổi quyền/đăng nhập, không dùng nháp người khác. |
| Sinh đơn hàng / HĐKT và sửa thông tin đơn | `order-create.js`: xác nhận trước khi sinh, khóa nút khi đang gửi, giữ lỗi trong form. `order-submit.js` dùng revision/quoteRevision ở bước gửi duyệt. | Chưa thấy nháp thiết bị hoặc dirty guard dành riêng cho các ô đang nhập trong form sinh đơn; xác nhận sinh không phải cảnh báo mất dữ liệu. Cần lưu cả revision báo giá nguồn và revision đơn (khi sửa), không khôi phục bản cũ lên bản mới. |
| Hồ sơ khách | `app.js` customerRevision/customerOpened; PUT gửi profileRevision, có đối chiếu xung đột và giữ ô người dùng nhập khi 409. Ghi chú khách / công nợ có revision riêng (`customer-detail.js`). | Chưa thấy nháp/dirty guard cho hồ sơ khách trước khi bấm lưu. Nếu thêm, phải gắn user + customerId + profileRevision + bản gốc để merge có kiểm soát, không tự thay revision nháp thành revision mới. |
| Phiếu thu/chi | `cash.js` có khóa quyền/ca và kiểm tra trước gửi. `loading-feedback.js` chỉ cảnh báo đóng tab khi request ghi đang chạy. | Chưa có nháp/cảnh báo riêng cho dữ liệu đã gõ nhưng chưa gửi. Nếu thêm chỉ lưu ý định (số tiền, chứng từ), tuyệt đối không tự phát lại thu/chi khi mở trang. Revalidate két, ca, quyền, trạng thái chứng từ, số dư; lưu clientKey ổn định cho lần gửi chưa biết kết quả. |
| Trả hàng CRM / POS | `crm-returns.js`, `pos-returns.js`: form trong dialog, khóa khi xử lý; lỗi thường giữ form. CRM finalize là giao dịch nguyên khối. | Chưa có nháp lâu dài hoặc cảnh báo dirty khi đóng dialog/rời route. Mọi khôi phục phải tải lại lượng còn được trả, khoản hoàn, phân bổ đổi hàng, revision đơn và trạng thái phiếu; không phục hồi nút xác nhận đã nhận/đã chi tiền. |
| Đơn mua NCC | `purchases.js`: đơn nháp đã lưu trên server, sửa/giá/duyệt kèm revision. `purchase-order-create.js` dùng sendOnce để giữ intent khi mất phản hồi. `purchase-restock.js`: nháp danh sách mới ở localStorage, khôi phục và làm mới tồn. | Nháp restock là danh sách tạo mới, chưa gắn revision bản ghi; key v1 dùng chung trình duyệt, không thấy gắn user. Không nên tái dùng để sửa đơn đã có. Form sửa đơn/giá chưa thấy dirty guard riêng. Cần user-scope, TTL, kiểm nguồn/NCC/quyền và revision lúc lưu, giữ nguyên intent cho lần gửi chưa rõ kết quả. |
| Điều chuyển | `stock-ops.js`: revision khi sửa/nhận; receiveDirty ngăn refresh ghi đè khi đang nhập; các bước nhận/huỷ có xác nhận nghiệp vụ. | Chưa thấy lưu nháp thiết bị hoặc dirty guard khi đóng form tạo/sửa/rời route. receiveDirty bảo vệ refresh, không phải cơ chế phục hồi sau đóng trang. Nháp mới cần clientKey + mode; nháp sửa cần ID + revision gốc; lượng giữ/tồn phải kiểm lại server. |
| Kiểm kê | `stocktake.js`: localStorage theo user, hasDraft/beforeLeave; app nối hashchange/logout/beforeunload. Giữ pending intent để kiểm tra kết quả sau mất mạng, refresh tồn khi mở lại, thông báo tồn đổi sau khi đếm. | Đây là phiếu mới từ số thực đếm, không phải tự ghi đè bản ghi đã duyệt. Khi phát triển sửa phiếu đã lưu cần thêm revision gốc của phiếu; không coi refresh tồn mới là sự đồng ý thay số người đã đếm. Không tái dùng baseline cũ để tự duyệt. |
| Cân bằng kho (bổ sung) | `inventory.js` / `inventory-adjustments.js`: kiểm tra đầu vào và đối soát/duyệt, busy guard trên dialog. | Không tìm thấy nháp/dirty guard dùng chung cho form cân bằng. Nên dùng cùng nguyên tắc số thực đếm/revision, không tự áp delta tồn cũ sau khi dữ liệu thay đổi. |

Điểm dùng chung: `app.js` chỉ chặn hashchange do nháp kiểm kê và báo giá dirty. Cảnh báo `loading-feedback.js` cho request đang ghi không bảo vệ nội dung chưa bấm gửi. Chưa nên tuyên bố các form còn lại đã được bảo vệ bởi một guard toàn cục.

### Đề xuất, chưa triển khai

1. Thêm một registry dirty-form cho route/dialog, hỏi trước đóng/rời/logout; để nguyên form nếu người dùng chọn ở lại. Không thay đổi việc kiểm quyền hay giới hạn tiền/tồn.
2. Nháp theo `[userId, loại, recordId, baseRevision]`, bản gốc, phiên bản định dạng, TTL và giới hạn dung lượng. Tạo mới phải ghi rõ nguồn/revision nguồn; xóa nháp khi lưu thành công hoặc đăng xuất theo chính sách. Không lưu token, dữ liệu chi ngân hàng vượt quyền hoặc file lớn vào localStorage.
3. Khôi phục luôn tải bản server hiện tại: revision khác thì trình bày đối chiếu từng ô, yêu cầu người dùng xác nhận lại. Không âm thầm gắn revision mới vào dữ liệu nháp cũ. Server dùng profileRevision/revision có sẵn để chặn stale write ngay cả khi người dùng giả request.
4. Chưa biết kết quả request: kiểm tra theo intent/clientKey trước khi gửi lại. Không tự hoàn tiền, duyệt, nhận/xuất kho hoặc gọi tích hợp khi mở nháp. Trạng thái xác nhận thực nhận/chi tiền không khôi phục tự động.
5. Khi triển khai sau: test hai tab, cùng/khác ô, quyền vừa bị thu, logout/login người khác, tab đóng/offline/storage đầy, nguồn đã đổi, pending intent có/không commit. Kiểm cả 390/1280; Safari và thiết bị thật cần vòng riêng.

## E1 — phạm vi SePay cho nhân viên không gắn cửa hàng

**Đã tái hiện bằng test** `tests/app/sepay-unassigned-store-audit.test.ts`: nhân viên chức vụ Sale Admin, không khớp nhóm cửa hàng, có hai quyền được cấp rõ `page.sepay` và `sepay.reconcile-incoming`. Hai đơn web QR mẫu có register/kho Lock và Minh Long riêng. Tìm kiếm trả cả hai; GET xem đối soát và POST xác nhận từng khoản thu đều 200. Mỗi khoản đúng tổng tiền/tài khoản; các kiểm tra chống COD/sai tiền vẫn hoạt động. Đây là xác nhận hành vi hiện tại, không phải test khẳng định chính sách đó nên được giữ.

Nguyên nhân từ mã:

- `pos-access.ts/registerStoreMatch`: chỉ tạo giới hạn cửa hàng cho NVBH Lock/ML và chức danh CHT tương ứng. Với nhân viên khác, trả undefined.
- `posWebOrderStoreScope`: undefined trở thành không có điều kiện kho/cửa hàng, không phải “không được xem”.
- `sepay-page-routes.ts` tìm kiếm và `sepay-reconcile-access.ts/assertSepayReconcileTarget` dùng cùng helper này. Vì vậy kiểm quyền đối soát có chạy nhưng phạm vi đơn web vẫn toàn bộ với nhóm không gắn cửa hàng.
- Đơn CRM đi qua orderScopeFor riêng; phát hiện này không kết luận mọi đơn CRM cũng mở rộng.

**Ai có quyền theo mặc định repo:** `permissions.ts` khai `sepay.reconcile-incoming` với `defaults: []`; không chức vụ nhân viên nào tự có quyền này theo mặc định. Manager được `can()` cho phép mọi quyền. Employee phải được cấp quyền trang SePay và quyền đối soát trong cấu hình chức vụ; cờ “Được duyệt” không tự cấp quyền đối soát. Sale Admin, kế toán hoặc chức vụ tùy chỉnh không gắn cửa hàng mà được cấp cả hai quyền là nhóm có thể gặp phạm vi rộng. Không khẳng định ai ở production đang được cấp: chưa đọc cấu hình production.

### Hai phương án chờ Anh Thái chọn

| Phương án | Quy tắc đề xuất | Hệ quả / test cần có |
|---|---|---|
| Giới hạn theo cửa hàng | Employee chỉ tìm/xem/xác nhận đơn web thuộc danh sách cửa hàng được phân công rõ; chưa được gắn cửa hàng thì từ chối. Manager toàn bộ; kế toán liên cửa hàng cần quyền global riêng được cấp có chủ đích. Áp ở query và target check, không chỉ UI. | Cần mô hình assignment cho Sale Admin/kế toán và migration nếu hiện chưa có; test không assignment, nhiều assignment, thu hồi tức thì, giả ID, list/detail/confirm thống nhất. Có thể làm mất quyền liên cửa hàng mà kế toán đang cần nếu không chuẩn bị assignment. |
| Giữ phạm vi rộng có chủ đích | Quyền reconcile cho nhân viên không gắn cửa hàng mang nghĩa “đối soát thu toàn công ty”; NVBH có cửa hàng vẫn giới hạn như cũ. Ghi rõ phạm vi khi cấp quyền, cân nhắc một quyền global tách biệt để tránh hiểu nhầm. | Không sửa helper âm thầm. Cần review ai được cấp quyền, audit người đối soát/đơn/cửa hàng, test global có chủ đích. Vẫn giữ tiền ra chỉ Manager/kế toán và mọi kiểm tra phương thức/tiền/idempotency. |

**Chưa sửa E1; chưa thay quyền, chưa chạy migration hay deploy.** Test ghi nhận hành vi rộng để reviewer có bằng chứng và chờ quyết định chính sách.

## Giới hạn kiểm chứng

Rà form là đọc mã tại commit nêu trên; chưa thao tác mọi form ở PC/mobile. Test E1 dùng PostgreSQL 17 local với database fixture tách riêng; không mô phỏng tải nhiều phiên hoặc mạng di động. Trình duyệt Chromium không thay cho Safari/thiết bị thật. Test xanh không chứng minh an toàn tuyệt đối.

Kiểm tra đã chạy cho PR báo cáo: `tsc --noEmit`, `npm run ui:build`; 10 test E1/SePay reconcile/architecture đạt trên PostgreSQL local. `customer-profile-conflict.mjs`: 14 kiểm tra đạt ở 390/1280 (hai người sửa, xung đột từng ô, phản hồi về muộn không ghi đè form mới). Browser này xác minh cơ chế profileRevision đã có, không chứng minh các form khác đã có nháp/cảnh báo. Không có migration; rollback PR báo cáo chỉ bỏ tài liệu/test, không đổi nghiệp vụ.
