# Chi tiết nhân viên: KPI, khách hàng, giao dịch, ngày công, lương thưởng

Trang `#/members/<id>?month=YYYY-MM`. Manager mở từ trang Nhân viên (bấm tên). Nhân viên mở hồ sơ của mình ở menu tài khoản → **Hồ sơ của tôi**.

## Quyền
| Ai | Xem | Sửa |
|---|---|---|
| Manager | Mọi nhân viên | Mức lương, chấm công, thưởng / phụ cấp / khấu trừ / tạm ứng, chốt lương, đánh dấu đã trả, mở lại phiếu |
| Nhân viên | Chỉ hồ sơ của mình (gồm lương của mình) | Không sửa gì; chỉ đổi ảnh đại diện của mình |

## Màn hình
1. **Đầu trang:** ảnh, tên, chức vụ, chọn tháng (‹ tháng ›). Các nút: Sửa thông tin (Manager), Đổi ảnh.
2. **KPI tháng (8 thẻ):**
   - doanh số so với chỉ tiêu (thanh %);
   - số đơn và giá trị trung bình;
   - số báo giá và tỷ lệ chốt;
   - đã thu trong tháng và số HĐKT ký;
   - công nợ đang giữ và phần quá hạn;
   - số khách phụ trách và khách mới;
   - ngày công trên công chuẩn;
   - công việc xong, đang làm, trễ hạn.
3. **Doanh số 6 tháng** (cột = doanh số, chấm xanh = đã thu), **Thông tin**, **Lương tháng** (thực lĩnh, tạm tính hoặc đã chốt).
4. **Tabs:**
   - Khách hàng: phụ trách, được chia sẻ, hoặc có đơn; kèm số đơn, doanh số, còn nợ.
   - Báo giá.
   - Đơn hàng.
   - HĐKT.
   - Giao dịch: phiếu thu.
   - Công nợ.
   - Ngày công: lịch tháng. Manager bấm vào ngày để đổi trạng thái, hoặc "Chấm đủ công T2–T7 (tới hôm nay)".
   - Lương & thưởng: phiếu lương chi tiết, các khoản thưởng / trừ, mức lương áp dụng và lịch sử.

## Định nghĩa KPI (`src/modules/staff-hub/domain/kpi.ts`)
- **Doanh số tháng:** tổng giá trị (gồm VAT) các đơn nhân viên **phụ trách**, ngày đặt trong tháng. Chỉ tính đơn đã tính công nợ: đơn không huỷ, không còn nháp. Đơn nháp có HĐKT đã ký vẫn tính.
- **Đã thu tháng:** phiếu thu có ngày thu trong tháng, của các đơn nhân viên phụ trách.
- **Báo giá tháng:** báo giá nhân viên phụ trách (người được giao, không có thì người tạo), xếp vào tháng theo ngày báo giá (không có thì ngày tạo). **Tỷ lệ chốt** = số báo giá đã lên đơn / tổng báo giá tháng.
- **Công nợ đang giữ:** phần còn phải thu của mọi đơn nhân viên phụ trách (không riêng tháng).
- **Khách mới:** khách do nhân viên tạo trong tháng.

## Lương (`src/modules/hr/domain/payroll.ts`)
```
Lương theo ngày công = Lương cơ bản × Ngày công thực tế / Ngày công chuẩn
Hoa hồng            = Doanh số tháng × % hoa hồng
Tổng thu nhập       = Lương theo ngày công + Phụ cấp cố định + Phụ cấp thêm + Thưởng + Hoa hồng
Thực lĩnh           = Tổng thu nhập − Khấu trừ − Bảo hiểm (NV đóng) − Tạm ứng
```
- **Ngày công:** đủ công = 1, nửa công = 0,5, nghỉ có lương = 1, nghỉ không lương = 0, vắng = 0.
- **Mức lương theo tháng áp dụng:** tháng X dùng bản có `effective_month` mới nhất ≤ X. Tăng lương thì thêm bản mới, các tháng cũ không đổi.
- **Chốt lương:** lưu một bản chụp số liệu vào `hr_payslips` và khoá ngày công / thưởng phạt của tháng. Muốn sửa thì "Mở lại" (chỉ khi chưa trả). "Đánh dấu đã trả" thì không mở lại được nữa.

## Cấu trúc dữ liệu (migration `0027_hr_payroll.sql`, phân quyền `0028_supabase_access_hr_payroll.sql`)
| Bảng | Khoá | Nội dung |
|---|---|---|
| `hr_salary_profiles` | (member_id, effective_month) | Lương cơ bản, phụ cấp cố định, ngày công chuẩn, chỉ tiêu doanh số, % hoa hồng, bảo hiểm NV đóng |
| `hr_attendance` | (member_id, work_date) | Trạng thái ngày công, người chấm |
| `hr_adjustments` | id | Thưởng / phụ cấp thêm / khấu trừ / tạm ứng theo tháng, lý do, người nhập |
| `hr_payslips` | (member_id, month) | Phiếu lương đã chốt (mọi con số) + trạng thái đã chốt / đã trả |

Mọi bảng tham chiếu `staff_members`. Giá trị trạng thái và loại khoản có ràng buộc CHECK ở DB.

## Module
- `hr` (chỉ phụ thuộc `staff`): bảng, công thức, API ghi `/hr/*` (Manager). Hoa hồng cần doanh số: hàm `revenueOf` được truyền vào từ `src/app/router.ts`, nên `hr` không phụ thuộc module bán hàng.
- `staff-hub` (chỉ đọc; phụ thuộc staff, customers, quotes, sales, tasks, hr): `GET /members/:id/overview?month=` gom mọi thứ trong một lượt.
- Giao diện: `trial-ui/member-detail.js`. Thêm mục mới = thêm một phần tử vào `TABS`.

## API
| Route | Việc |
|---|---|
| `GET /members/:id/overview?month=YYYY-MM` | Trang chi tiết (Manager: mọi người; nhân viên: chính mình) |
| `PUT /hr/members/:id/salary` | Mức lương áp dụng từ `effectiveMonth` |
| `PUT /hr/members/:id/attendance/:month` | `{ days: { 'YYYY-MM-DD': 'present' \| 'half' \| 'paid_leave' \| 'unpaid_leave' \| 'absent' \| '' } }` (`''` = xoá) |
| `POST /hr/members/:id/adjustments` · `DELETE /hr/adjustments/:id` | Thưởng / phụ cấp / khấu trừ / tạm ứng |
| `POST /hr/members/:id/payslips/:month` · `POST …/paid` · `DELETE …` | Chốt lương · đã trả · mở lại |
