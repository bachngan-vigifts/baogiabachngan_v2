# Ai bấm được nút nào trên đơn NCC

> File này được **sinh tự động** từ `src/modules/suppliers/domain/workflow.ts` (`npm run docs:ncc`). Đừng sửa tay.
> Luật mặc định: `freezeAfterReceipt`=true, `lockSignatureAfterConfirm`=true, `receiveRequiresApproval`=true, `depositRequiresConfirmation`=false.

| Trạng thái đơn | Giai đoạn | Manager | Nhân viên | NCC của đơn | NCC khác |
|---|---|---|---|---|---|
| Chờ Manager duyệt | chờ duyệt | Duyệt đơn | — | — | — |
| Đã duyệt, NCC chưa làm gì | chờ NCC xác nhận | Nhập số phiếu NCC, Tải bản ký, Yêu cầu cọc, Nhập kho | — | Nhập số phiếu NCC, Tải bản ký, Yêu cầu cọc | — |
| Đã tải bản ký, chưa xác nhận | chờ NCC xác nhận | Nhập số phiếu NCC, Tải bản ký, Xoá bản ký, Xác nhận đơn, Yêu cầu cọc, Nhập kho | — | Nhập số phiếu NCC, Tải bản ký, Xoá bản ký, Xác nhận đơn, Yêu cầu cọc | — |
| Đã xác nhận | đã xác nhận | Nhập số phiếu NCC, Yêu cầu cọc, Báo sẵn sàng giao, Nhập kho | — | Nhập số phiếu NCC, Yêu cầu cọc, Báo sẵn sàng giao | — |
| Đã xác nhận + đã yêu cầu cọc | đã xác nhận | Nhập số phiếu NCC, Yêu cầu cọc, Ghi nhận cọc, Báo sẵn sàng giao, Nhập kho | — | Nhập số phiếu NCC, Yêu cầu cọc, Báo sẵn sàng giao | — |
| Đã xác nhận + đã nhận cọc | đã xác nhận | Nhập số phiếu NCC, Ghi nhận cọc, Báo sẵn sàng giao, Nhập kho | — | Nhập số phiếu NCC, Báo sẵn sàng giao | — |
| Đã xác nhận + báo sẵn sàng giao | đã xác nhận | Nhập số phiếu NCC, Yêu cầu cọc, Báo sẵn sàng giao, Bỏ báo sẵn sàng giao, Nhập kho | — | Nhập số phiếu NCC, Yêu cầu cọc, Báo sẵn sàng giao, Bỏ báo sẵn sàng giao | — |
| Đã nhập kho | đã nhập kho | Nhập số phiếu NCC, Ghi nhận cọc | — | Nhập số phiếu NCC | — |
