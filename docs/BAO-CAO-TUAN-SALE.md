# Báo cáo tuần Sale / Sale Admin → Tiền trách nhiệm

Trang `#/weekly-reports` (menu *Công việc → Báo cáo tuần*; chỉ hiện với Sale, Sale Admin và Manager). Mô-đun `src/modules/staff-reports/`.

## Quy định

- **Ai nộp:** nhân viên đang làm có chức vụ `sale` hoặc `sale-admin`. Chức vụ khác nhận 403 ở máy chủ.
- **Tuần:** thứ Hai → Chủ nhật (giờ Việt Nam). Trong tuần chỉ **lưu nháp**; **nộp chính thức** từ 00h00 thứ Hai tuần sau, **hạn 10h00 thứ Hai** tuần sau. Nháp không tính điểm.
- **Tuần thuộc tháng nào:** tuần có *thứ Hai hạn nộp* rơi vào tháng đó. Thường 4 tuần; tháng có 5 thứ Hai thì có 5 tuần và **lấy 4 tuần điểm cao nhất**.
- **Nội dung** (rút gọn từ mẫu báo cáo tuần đang dùng; số liệu CRM tính ở máy chủ lúc nộp, bỏ qua số client gửi):
  1. *Kết quả tuần* – CRM: doanh số tuần, số đơn, KH mới, giao dịch, báo giá gửi / chốt, HĐKT ký, luỹ kế tháng / chỉ tiêu đăng ký; bảng đơn chốt trong tuần (khách, sản phẩm chính, doanh số).
  2. *Báo giá trong tuần* – CRM liệt kê mọi báo giá gửi trong tuần; **mỗi báo giá chưa chốt bắt buộc ghi 1 dòng tình trạng / bước tiếp**.
  3. *Chăm sóc trong tuần* – CRM: số KH cũ chăm sóc tái ký (đã có đơn trước tuần) / KH mới mở rộng / số giao dịch (tính KPI), chia theo ngành Ngân hàng / Nông nghiệp / Thuỷ sản / Khác. Ngành lấy theo "Nhóm / loại khách" trên hồ sơ khách; trống thì đoán theo tên khách (Agribank, QTDND, Phân bón…). Muốn đúng thì cập nhật "Nhóm / loại khách".
  4. *Giao hàng sắp tới* – CRM: lịch giao chưa xong của đơn mình phụ trách, tới hết 2 tuần sau.
  5. *Công nợ* – CRM: mọi khoản còn nợ của đơn mình phụ trách (đã trừ hàng trả, như trang Công nợ), tô đỏ quá hạn.
  6. *Tự nhập*: **kế hoạch tuần tới (bắt buộc)**, kết quả nổi bật và khó khăn / đề xuất (không bắt buộc).
- **Nộp lại** trước khi duyệt: giữ giờ nộp lần đầu, lưu lịch sử phiên bản. **Đã duyệt thì khoá** cả nộp lại lẫn nháp.
- **Duyệt (Manager):** Đạt / Chưa đạt / Miễn; Chưa đạt và Miễn bắt buộc ghi lý do.

## Điểm

| Tình trạng | Điểm |
| --- | --- |
| Nộp đúng hạn (trước 10h00 thứ Hai) | 1 |
| Trễ dưới 1 ngày | 0,5 |
| Trễ từ 1 ngày / không nộp | 0 |
| Manager duyệt *Chưa đạt* | 0 |
| Manager duyệt *Miễn* | 1 |
| Hạn nộp trước ngày triển khai 06/11/2026 (tuần 26/10–01/11) | 1 – "Miễn – trước ngày triển khai" |

## Tiền trách nhiệm (áp dụng từ bảng lương **11/2026**)

```
Tiền trách nhiệm = mức trách nhiệm (hồ sơ lương từng người) × ngày công ÷ công chuẩn × điểm ÷ 4
```

- Chỉ áp dụng cho người thuộc bảng lương **Sale & VP** có chức vụ Sale / Sale Admin; tháng trước 11/2026 và các chức vụ khác giữ cách tính cũ.
- Thử việc: như cũ, không có tiền trách nhiệm.
- Ví dụ: mức 2.600.000, đủ 26/26 công, 4 tuần được 1 + 0,5 + 0 + 0 = 1,5 điểm → 2.600.000 × 26/26 × 1,5/4 = **975.000**.
- Phiếu lương ghi rõ: `2.600.000 × 26/26 công × 1,5/4 điểm báo cáo tuần`.

## Dữ liệu

| Bảng | Ghi chú |
| --- | --- |
| `staff_weekly_reports` | 1 dòng / (nhân viên, tuần). Giờ nộp đầu, số liệu + nội dung (JSON), kết quả duyệt |
| `staff_weekly_report_drafts` | Nháp (khoá chính nhân viên + tuần) |
| `staff_weekly_report_versions` | Lịch sử mỗi lần nộp chính thức |

Migration `migrations/postgres/20261113090000_staff_weekly_reports.sql` (chạy tay), cổng kiểm tra `scripts/sql/assert-staff-weekly-reports.sql` trong `deploy-api.yml`.

Bảng lương nhận điểm qua contract `src/core/contracts/weekly-report.ts` (`WeeklyReportPointsOf`), nối ở `src/app/router.ts` – mô-đun HR không import mô-đun báo cáo.
