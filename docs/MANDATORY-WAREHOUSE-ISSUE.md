# Bắt buộc nhập kho trước khi xuất giao

Quy tắc Anh Thái xác nhận ngày 25/10/2026: mọi hàng từ NCC, đại lý, cửa hàng khác, điều chuyển hoặc nguồn khác phải có tại kho thực xuất trước khi giao. Nguồn bổ sung không phải ngoại lệ ghi sổ kho. Không tự tạo phiếu nhập/điều chuyển để làm đủ tồn.

## Hành vi source

- Phiếu đóng gói có SKU bắt buộc chọn kho stock đang hoạt động, đúng kho bán/quầy nếu đơn đã gắn kho. Áp dụng mọi source: warehouse/supplier/agent/store/other. Source cũ vẫn giữ làm thông tin nguồn; stockWarehouseId ghi kho thực xuất.
- Xác nhận ghi trạng thái, ảnh, phát sinh xuất và số dư cùng transaction. postMoves khóa số dư, chặn thiếu tồn và chống ghi lặp. Thiếu hàng ở kho xuất vẫn bị chặn dù kho khác có hàng.
- Bước xuất/hoàn thành CRM chỉ tính lượng có bút toán thực đúng kho, không tin nhãn packed của NCC/đại lý. Không giải phóng giữ hàng chỉ từ nhãn đó.
- Chứng từ legacy đã ghi sales_order được dùng đúng lượng còn lại, không miễn trừ cả phiếu vì thấy một bút toán. Legacy xuất trực tiếp đầy đủ trước khi có packing vẫn được công nhận bằng ledger thật; không ép trừ lần hai.
- UI điện thoại/desktop luôn yêu cầu kho cho hàng có SKU. Dòng dịch vụ không SKU không tự tạo bút toán kho.
- POS vẫn xuất từ kho quầy; test prepaid/COD/GHN kiểm tra không trừ lặp khi đã có packing issue.
- Đơn website đang là mirror, chưa có liên kết xuất kho CRM đã xác minh: chặn thao tác complete thủ công với WAREHOUSE_EXPORT_REQUIRED; UI hiện cần đối soát kho. Trạng thái GHN/website thực tế vẫn được giữ, không giả vờ hãng chưa giao. **Chưa bổ sung hệ thống liên kết kho cho mirror website**; việc này được ghi rõ là tồn đọng, không gọi trạng thái completed bên ngoài là bằng chứng xuất kho.
- Báo cáo /warehouse-workflow-audit mở rộng cho phiếu confirmed có đóng/ghi chú đối soát; thêm negativeBalances riêng vì ledger có thể khớp số dư nhưng vẫn âm.

## Dữ liệu thật đã xử lý theo yêu cầu rà toàn bộ đơn cũ

Không deploy hoặc merge source trong quá trình đối soát. Không gọi Sapo/n8n/GHN hoặc retry vận đơn. Các sửa dữ liệu có khóa giao dịch, kiểm revision và audit_logs, dựa vào yêu cầu trực tiếp của Anh Thái “tra lại các đơn cũ… chỉnh hết”.

1. DG_20261021_005 của DH_20261021_003 / HĐKT Phước Đức: PNH_20261025_001 đã nhập 29 bộ trà vào KHO VIGIFTS trước xác nhận đóng hàng. Phiếu cũng có 29 túi giấy; hàng túi đã có trong tồn đầu kỳ của chính kho đó. Bổ sung issue −29 cho mỗi SKU theo chính packing_slip, đặt kho thực xuất, giữ nguyên nguồn NCC và bằng chứng gốc. Không tạo phiếu nhập mới. Kết quả SKU 01503802103 còn 8 bộ; BBTGVUGYNM113 còn 12.032. Audit action repair_packing_stock ngày 25/10 lúc 10:31 UTC.
2. Sáu phiếu sau kỳ tồn chưa có ledger: mở lại sent, yêu cầu xuất từ kho, bảo toàn nguồn cũ trong sourceNote và toàn bộ bản ghi trước trong audit_logs. Không bịa kho, không đổi dữ kiện giao hàng/công nợ. Ba phiếu auto-packed không người xác nhận và ba phiếu nguồn NCC/đại lý cùng được xử lý.
3. Sáu phiếu trước kỳ tồn 18/10: gắn ghi chú cần đối soát hồ sơ; không trừ bù vào số dư kỳ hiện tại để tránh ghi hai lần.
4. Tạo 4 công việc thủ công ưu tiên cao cho Anh Thái: thiếu chứng từ sau kỳ tồn; hồ sơ trước kỳ tồn;15 dòng tồn âm; liên kết kho cho đơn website. auto_key null để bộ tự sinh không tự đóng các việc này. Không gửi tin nhắn/email bên ngoài.

Các phiếu mở lại: DG_20261017_002, DG_20261021_007, DG_20261021_009, DG_20261021_001, DG_20261009_002, DG_20261009_003.

## Tồn đọng dữ liệu có danh sách đối soát

- 9 đơn sau kỳ tồn không có packing hoặc bút toán sales_order: cần xác minh kho nhận, phiếu nhập/điều chuyển và chứng từ xuất thực tế. Chưa đủ dữ liệu để tự trừ bù.
- 14 đơn trước kỳ tồn không có packing/ledger; 6 phiếu trước kỳ tồn nói trên; 5 phiếu nhận import lịch sử không có kho. Cần đối chiếu hồ sơ với số dư mở kỳ 18/10, không cộng lại các phiếu nhập lịch sử.
- 15 dòng tồn âm lịch sử. Tổng stock_moves khớp stock_balances; không có cơ sở tự nâng tồn về 0 hoặc tạo hàng nhập giả. Cần kiểm kê/chứng từ nguồn.
- 3 đơn website completed bên ngoài chưa có liên kết xuất kho CRM. Chưa thay đổi dữ liệu website/GHN hoặc phát sinh chứng từ mới.
- Các callback Sapo có ID đơn không phải bằng chứng hàng đã nhập/xuất; đã kiểm tra bảng chứng từ Sapo cache, product_movements và callback metadata cho nhóm đơn liên quan, chưa thấy đủ kho/phiếu xuất để tự sửa nhóm thiếu dữ liệu.

Đối soát POS ở lần đọc cuối: 70 đơn đã giao / 122 dòng SKU, không thiếu bút toán xuất; số lượng đơn thay đổi theo hoạt động bán hàng thực tế. Không coi toàn bộ kho đã sạch khi các khoản trên còn thiếu hồ sơ. Báo cáo JSON trước/sau và SQL đã thực thi được lưu riêng ở scratch, không commit bản dump production.

## Công cụ và kiểm thử

- packing-stock-repair.ts chỉ dựng SQL kế hoạch duyệt rõ ràng, không tự kết nối/chạy. Repair yêu cầu receipt đạt đã ghi ledger vào đúng kho trước packed, số dư khớp ledger/đủ hàng, manager, revision, khớp toàn bộ dòng, không có legacy hay partial issue mơ hồ. Replay no-op. Mỗi kế hoạch kiểm revision trước khi thay đổi.
- Review helper không ghi kho; phiếu trước opening chỉ annotate, sau opening mở lại bước kho. Bản gốc ở audit.
- PGlite: mọi nguồn phải nhập trước; 221+29 với kết quả 8; rollback khi thiếu hàng; lặp không trừ thêm; legacy partial/full; repair thiếu hàng/stale revision/receipt huỷ/pre-opening; review không thay tồn.
- Chromium: 390px/1280px × 5 nguồn, checkbox+ảnh chưa đủ nếu thiếu kho; request xác nhận có warehouseId. Mọi business API mock, không truy cập production.
- Hồi quy: packing, stock holds/per-warehouse, POS/COD/prepaid/GHN, website GHN và UI; typecheck, UI build.

Source phải qua PR/CI/review trước triển khai. Các việc đối soát thiếu bằng chứng cần hoàn tất bằng chứng từ thật; không có thao tác “đánh dấu xong tất cả” để bỏ qua kho.
