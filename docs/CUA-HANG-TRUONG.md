# Báo cáo Cửa hàng trưởng (CHT) – giai đoạn 1

Theo *Bản mô tả công việc CHT* và *Quy định chính sách lương CHT* (2026).

## Ai dùng
- **Manager** gán CHT cho từng cửa hàng (quầy POS) ở trang **Báo cáo CHT → Gán CHT**. Mỗi cửa hàng một CHT, mỗi người tối đa một cửa hàng.
- **CHT** thấy mục *Báo cáo CHT* trong menu, nộp báo cáo, giải trình; nhận **hộp nhắc việc 30 phút / lần** khi còn báo cáo chưa nộp.
- **Người duyệt**: Manager, hoặc chức vụ được cấp quyền *Duyệt báo cáo Cửa hàng trưởng* (`store.review`).

**Hướng dẫn cho CHT (PDF, có ảnh minh hoạ):** `trial-ui/guides/huong-dan-bao-cao-cua-hang-truong.pdf` – nút **Hướng dẫn (PDF)** trên trang Báo cáo CHT và trong hộp nhắc việc. Sửa nội dung thì thay file và tăng `?v=` ở `GUIDE_URL` (`trial-ui/store-reports.js`).

## Báo cáo và hạn nộp (giờ Việt Nam)
| Báo cáo | Kỳ | Hạn | CRM tự điền |
|---|---|---|---|
| Ngày | ngày có mở ca POS | trước 22h00 | doanh số, tiền mặt / CK / khác, chênh lệch quỹ theo từng ca |
| Tuần | thứ Hai → Chủ nhật | trước 10h00 thứ Hai tuần sau | doanh số tuần, 10 mã bán chạy, 10 mã tồn không bán 30 ngày |
| Tháng | tháng | trước ngày 02 tháng sau | doanh số, mã bán chạy, ngày / ca của từng người theo ca POS |
| Kiểm tồn kho | tháng | trước ngày 02 tháng sau | phiếu kiểm kê kho cửa hàng, số mã lệch, giá trị lệch (giá nhập gần nhất) |

Nộp lại được khi chưa duyệt; giờ nộp lần đầu dùng để xét đúng hạn. Đã duyệt thì khoá (CHT dùng *Giải trình*).

## Tiền Trách nhiệm (4 ngạch × 250.000)
- Ngày: 0 lần chưa đạt 250k · 1–2: 150k · 3–4: 50k · ≥ 5: 0. Chưa đạt = trễ / thiếu; *sai số liệu sổ quỹ* tính 2 lần.
- Tuần: 0: 250k · 1: 150k · 2: 50k · ≥ 3: 0. Chưa đạt = trễ / thiếu / *đề xuất đặt hàng sai*.
- Tháng: đúng hạn 250k · trễ ≤ 2 ngày 100k · còn lại 0.
- Kiểm tồn kho: đúng hạn 250k · trễ ≤ 2 ngày 150k · còn lại hoặc *có chênh lệch nhưng không báo* 0.
- Duyệt *Miễn (lý do khách quan)* → không tính chưa đạt.

Trang hiện số tạm tính theo tháng. Giai đoạn 2 đưa vào bảng lương CHT (năng lực, thưởng Sale-out chia hệ số CHT 1,5 / NVBH 1, thưởng Sale-in × H_QL, cơm + xăng theo ngày công).

## Kỹ thuật
- Module `src/modules/store` (domain thuần: `domain/reports.ts`). API `/store/*` – xem đầu file `api/routes.ts`.
- Migration `20261111100000_store_manager_reports.sql` (chạy tay) + cổng `scripts/sql/assert-store-manager-reports.sql`.
