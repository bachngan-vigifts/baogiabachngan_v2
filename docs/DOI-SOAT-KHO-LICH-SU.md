# Đối soát kho lịch sử (legacy)

Tách riêng khỏi phần ngăn lỗi mới (docs/SO-KHO.md › Chống ghi trùng, hàng đang giữ, trả hàng, giao thất bại).

Nguyên tắc:
- Không bù tồn tự động.
- Không sửa dữ liệu trực tiếp trong database.
- Không đổi trạng thái hay huỷ chứng từ để "cho khớp".
- Mỗi đơn có hồ sơ riêng, Anh Thái duyệt từng đơn. Sau duyệt mới xử lý, và chỉ qua chứng từ trong ứng dụng.

## 1. Lập hồ sơ (chỉ đọc)

```bash
DATABASE_URL=postgres://… npx tsx scripts/stock-reconciliation-dossier.ts > doi-soat-kho.md
```

- Chạy trong giao dịch `READ ONLY`: Postgres từ chối mọi lệnh ghi (có test kiểm tra).
- Thêm `--json` để lấy dữ liệu thô.
- Không commit file kết quả có dữ liệu thật vào repo.
- Code: `src/app/stock-reconciliation.ts`. Test: `tests/app/stock-reconciliation-dossier.test.ts`.

Hồ sơ gồm:

| Mục | Nội dung |
|---|---|
| A. Đơn CRM thiếu bằng chứng xuất | Đơn đang / đã giao có SKU mà `crmStockFulfilment` chưa thấy đủ phiếu xuất / trừ kiểu cũ. Mỗi đơn: chuyến giao, kho bán, phiếu điều chỉnh nhắc số đơn / số chuyến, từng dòng thiếu |
| B. Đơn web | Đơn website chưa có bút toán sổ kho: đơn cũ (`legacy`) đã hoàn thành sau ngày chốt tồn của kho quầy, và đơn bị chặn (`blocked`) do mã / tồn |
| C. Tồn âm | Cặp mã × kho có số dư âm |

## 2. Phân loại từng dòng thiếu (mục A)

| Phân loại | Điều kiện | Đề xuất (chờ duyệt) |
|---|---|---|
| Đã bù (điều chỉnh) | Có phiếu điều chỉnh đã duyệt, lý do / số phiếu nhắc đúng số đơn hoặc số chuyến, đã trừ đủ mã đó | Không bù thêm. Khách trả hàng: chọn căn cứ "phiếu điều chỉnh" này |
| Giao trước chốt tồn | Mọi chuyến đã giao của dòng trước ngày chốt tồn đầu kỳ (kho bán; chưa có kho thì mốc chốt sớm nhất). Đơn không có chuyến: đơn lập trước ngày chốt | Không bù: tồn chốt từ Sapo đã phản ánh. Khách trả hàng: chọn căn cứ "giao trước chốt tồn" |
| Cần xác minh | Còn lại (giao sau chốt, chưa thấy bù) | Xác minh kho thực xuất và chứng từ. Nếu xác nhận hàng đã ra khỏi kho sau chốt: Manager lập phiếu điều chỉnh ghi rõ số đơn / chuyến, rồi duyệt |

Phân loại là gợi ý dựa trên dữ liệu, không phải bằng chứng cuối cùng. Người duyệt vẫn kiểm hồ sơ thật (phiếu giao, ảnh, Sapo).

Phiếu điều chỉnh không được coi là bằng chứng xuất của đơn chỉ vì "gần giống":
- Hồ sơ chỉ ghép phiếu nhắc đúng số đơn / số chuyến.
- Khi trả hàng, căn cứ "phiếu điều chỉnh" bị giới hạn theo lượng đã trừ, cộng dồn qua mọi phiếu trả.

## 3. Sau khi duyệt

| Quyết định | Làm trong ứng dụng |
|---|---|
| Đồng ý "không bù" | Không làm gì với tồn. Ghi chú đối soát vào đơn (Ghi chú đơn) để lần sau không rà lại |
| Cần bù xuất thiếu | Manager lập phiếu điều chỉnh (Sổ kho → Phiếu điều chỉnh): đúng kho thực xuất, số âm, lý do ghi số đơn + số chuyến, rồi duyệt |
| Đơn web | Đơn mới tự trừ theo GHN. Đơn `legacy`: sau kiểm kê, phiếu điều chỉnh ghi số đơn web. Đơn `blocked`: sửa mã / nhập hàng rồi đồng bộ GHN để tự trừ |
| Tồn âm | Kiểm kê thực tế, tìm chứng từ nguồn; phiếu điều chỉnh có duyệt. Không nâng về 0 khi chưa kiểm |

Mọi phiếu điều chỉnh đều qua `postMoves`: một giao dịch, chống gửi lặp bằng mã bắt buộc, có nhật ký.

## 4. Số liệu tham khảo (CHƯA kiểm lại)

Theo báo cáo đối soát của Codex lúc 19:18 ngày 28/10/2026, giờ Việt Nam. Đây là ảnh chụp tại thời điểm đó, không phải số hiện tại. Chạy lại mục 1 trước khi duyệt.

- 29 đơn CRM lập trước 24/10, đã giao, chưa gắn kho bán, thiếu bằng chứng xuất:
  - 20 đơn giao trước chốt tồn;
  - 9 đơn giao sau chốt. Trong 9 đơn này, 1 đơn đã bù đủ (DH_20261020_005 bằng DC-GH_002_23102026), 8 đơn chưa thấy bù.
- 5 đơn web Minh Long hoàn thành sau chốt tồn: 7 mã, tổng 10.
- 11 cặp mã × kho tồn âm.
