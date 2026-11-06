# Báo cáo tuần Sale / Sale Admin → Tiền trách nhiệm

Trang `#/weekly-reports` (menu *Công việc → Báo cáo tuần*; chỉ hiện với Sale, Sale Admin và Manager). Mô-đun `src/modules/staff-reports/`.

## Quy định

- **Ai nộp:** nhân viên đang làm có chức vụ `sale` hoặc `sale-admin`. Chức vụ khác nhận 403 ở máy chủ.
- **Tuần:** thứ Hai → Chủ nhật (giờ Việt Nam). Trong tuần chỉ **lưu nháp**; **nộp chính thức** từ 00h00 thứ Hai tuần sau, **hạn 10h00 thứ Hai** tuần sau. Nháp không tính điểm.
- **Tuần thuộc tháng nào:** tuần có *thứ Hai hạn nộp* rơi vào tháng đó. Thường 4 tuần; tháng có 5 thứ Hai thì có 5 tuần và **lấy 4 tuần điểm cao nhất**.
- **Nội dung:** CRM tự điền (tính ở máy chủ lúc nộp, bỏ qua số client gửi): doanh số tuần, số đơn, KH mới, giao dịch chăm sóc, báo giá gửi / chốt, HĐKT ký, luỹ kế tháng / chỉ tiêu. Nhân viên **bắt buộc** nhập 3 mục: kết quả nổi bật, khách trọng điểm & bước tiếp, kế hoạch tuần tới (thêm mục *khó khăn / cần hỗ trợ* không bắt buộc).
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

## Tiền trách nhiệm (áp dụng từ bảng lương **12/2026**)

```
Tiền trách nhiệm = mức trách nhiệm (hồ sơ lương từng người) × ngày công ÷ công chuẩn × điểm ÷ 4
```

- Chỉ áp dụng cho người thuộc bảng lương **Sale & VP** có chức vụ Sale / Sale Admin; tháng trước 12/2026 và các chức vụ khác giữ cách tính cũ.
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
