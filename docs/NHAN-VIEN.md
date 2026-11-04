# Chi tiết nhân viên: KPI, khách hàng, giao dịch, ngày công, lương thưởng

Trang `#/members/<id>?month=YYYY-MM`. Manager mở từ trang Nhân viên (bấm tên). Nhân viên mở hồ sơ của mình ở menu tài khoản → **Hồ sơ của tôi**.

## Quyền
| Ai | Xem | Sửa |
|---|---|---|
| Manager | Mọi nhân viên | Mức lương, chấm công, thưởng / phụ cấp / khấu trừ / tạm ứng, chốt lương, đánh dấu đã trả, mở lại phiếu |
| Nhân viên | Hồ sơ mình (gồm lương); hồ sơ nghiệp vụ đồng nghiệp cùng nhóm, không có lương/ngày công | Không sửa gì; chỉ đổi ảnh đại diện của mình |

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

## Lương – theo file "Bảng lương mẫu T9/2026"
Công thức lấy đúng file Excel mẫu và đã đối chiếu từng đồng với các dòng trong file (test `src/modules/hr/domain/payroll.test.ts`).

| Phần file Excel | Trong app | Code |
|---|---|---|
| Sheet "Tham số" | Bảng lương → **Tham số** (lưu theo "áp dụng từ tháng") | `hr/domain/params.ts` (`PARAM_FIELDS`) |
| "Lương Sale", "Lương Bách Ngân", "Lương Lock" | Mỗi người thuộc 1 **bảng lương** (hồ sơ lương) → tab **Sale & VP**, **NVBH ML** (cửa hàng ML – sheet "Lương Bách Ngân"), **NVBH Lock** | `hr/domain/payroll.ts` (`computePayslip`) |
| "KPI CV" | Số liệu tháng của nhân viên Sale (KH mới, giao dịch, HĐ, DS cá nhân, ngày làm hàng / công tác, KPI chốt) | `hr/domain/kpi-cv.ts` |
| "Thưởng quý" | Tự tính tháng cuối quý khi bật "Chi trả thưởng quý" | `computeQuarterBonus` |
| "Phiếu lương" | Tab **Lương & thưởng** ở trang nhân viên (nhân viên tự xem phiếu của mình) | `member-detail.js` |
| "DS tổng hợp", "Tổng hợp" | Bảng lương → **Tổng hợp** | `payroll.js` |
| "Chuyển khoản" (VietQR) | Bảng lương → **Chuyển khoản** + cột trong file Excel xuất ra | `vietQrUrl` |
| "Chỉ tiêu DS" | Chỉ tiêu DS cá nhân / tháng trong hồ sơ lương (mặc định 415tr ở Tham số) | – |

Nhân viên **chưa có hồ sơ lương** vẫn hiện ở tab theo chức vụ (NVBH ML → tab NVBH ML, NVBH LOCK → tab NVBH Lock, còn lại → Sale & VP) trong khung "Chưa có hồ sơ lương", chưa tính vào tổng / chốt. Form hồ sơ lương điền sẵn mặc định theo chức vụ (`defaultProfileFor`): NVBH, trách nhiệm theo ngày, chuyên cần 200.000, hưởng thưởng DS nhóm.

### Công thức
**Chung cả 3 bảng:**
- Lương theo công = LCB × ngày làm ÷ công chuẩn. LCB trống thì lấy LCB vùng = LCB/ngày × công chuẩn.
- Năng lực = hệ số × 200.000.
- Trách nhiệm: cố định (Sale), theo tỷ lệ ngày làm (VD kho làm 18/26 ngày), hoặc theo ngày (Bách Ngân, Lock: 20.000 × ngày làm).
- Cơm + xăng = 50.000 × MAX(0, ngày làm − ngày trừ cơm của nhóm). Thử việc: bỏ chọn "hưởng cơm + xăng".
- Tăng ca = LCB ÷ 24 ÷ 8 × giờ × 2.

**Sale & VP:**
- Thưởng KPI DS = DS tháng × (KPI CV ≥ 90% → 1,2%; ≥ 60% → 0,5%).
- Thưởng sản lượng = sản lượng × đơn giá / tỷ lệ (kho 15.000/đơn, TK 30.000/lượt, IT 0,005 × DS web).
- Thực nhận = Tổng − BHXH − vi phạm − MAX(tạm ứng ĐT, PC điện thoại) − tạm ứng.

**Bách Ngân:** thưởng DS cửa hàng
- DS > 300tr: DS/DS TB 6 tháng ≥ 100% → 1%, ≥ 85% → 0,5%.
- Rồi ÷ 2, chỉ cho người được chọn "hưởng thưởng DS nhóm".

**Lock:** thưởng DS team
- DS < 85% × 300tr → 0.
- DS ≥ 310tr → 1,5%.
- Còn lại → 1%.
- Kết quả ÷ 2.

**Bách Ngân / Lock:** Thực nhận = Tổng − BHXH − BHYT − TNCN − vi phạm − tạm ứng ĐT − tạm ứng.

**Làm tròn:** mỗi khoản được làm tròn tới đồng, nên tổng có thể lệch tối đa vài đồng so với Excel (Excel giữ số lẻ).

### Chỗ chuẩn hoá so với file gốc (theo sheet "Cách tính")
- Tăng ca: cả 3 bảng dùng một công thức là LCB ÷ 24 ÷ 8 × giờ × 2. Bảng Lock trong file mẫu lấy "lương theo công" thay vì LCB; app dùng LCB như sheet "Cách tính" ghi.
- Các điểm lệch chính sách (1,2% hay 1%, 85% hay 80%, mức BHXH) để nguyên như file mẫu và sửa được ở **Tham số**.

### Nhập nhanh toàn công ty

Manager mở **Bảng lương → Nhập nhanh** (`#/payroll?month=YYYY-MM`). Bảng liệt kê mọi nhân viên, lọc theo tên / bảng lương và có ba nhóm cột:

- **Chấm công & chỉ số:** ngày công, giờ tăng ca, doanh số, sản lượng, thưởng quý, BHYT, TNCN và các chỉ số KPI.
- **Lương & phụ cấp cố định:** LCB, hệ số năng lực, trách nhiệm, điện thoại, chuyên cần, BHXH, đơn giá sản lượng; thay đổi áp dụng từ tháng đang chọn. Nhấn tên nhân viên để sửa cấu hình đầy đủ như cơm/xăng, cách tính trách nhiệm, nhóm lương và ngân hàng.
- **Thưởng, phạt & tạm ứng:** khoản nhập nhanh bổ sung. Các khoản đã ghi riêng và lý do vẫn được giữ, hiển thị cạnh ô nhập; tổng lương cộng cả hai nguồn.

Dùng Tab/Enter hoặc dán vùng ô từ Excel theo thứ tự hàng/cột đang hiển thị. Số theo định dạng Excel Việt Nam: `15.000` = 15 nghìn (kể cả đơn giá và sản lượng), `24,5` = 24,5 và `0,005` = 0,005. Có thể nhập `24.5` / `0.005`; nếu phần lẻ có đúng ba chữ số và phần nguyên khác 0, dùng dấu phẩy để tránh nhầm với dấu chấm phân cách hàng nghìn. Định dạng sai như `1.23.456` bị từ chối; ô số được hiển thị lại với dấu phẩy thập phân. Ô trống “Tự động” khác với số 0 nhập tay. Bấm **Lưu thay đổi** để lưu mọi dòng đã sửa trong một giao dịch và tính lại tổng thu nhập/khấu trừ/thực nhận. Không nhập khẩu danh sách nhân viên từ file Excel mẫu.

Phiếu đã chốt/đã trả chỉ xem. Khi có người khác sửa dữ liệu, hệ thống từ chối ghi đè và giữ phần đang nhập để đối chiếu; **Tải lại / Bỏ thay đổi** lấy bản mới. Khi chuyển tháng, bảng cũ bị khóa và thay bằng trạng thái đang tải; chỉ phản hồi mới nhất đúng tháng mới được hiển thị. Dữ liệu chưa lưu được giữ riêng theo từng tháng và khôi phục khi quay lại, không chuyển sang tháng khác. Version phía API bao gồm tháng; payload chỉ rõ tháng khác với URL bị từ chối. Chưa có hồ sơ: nhập LCB rồi lưu để thiết lập hồ sơ theo mặc định chức vụ. API: `PUT /hr/payroll/:month/entries`, tối đa 100 dòng/lần, chỉ Manager, dùng khoá lương chung; không cần migration mới.

### Nhập liệu hằng tháng
1. **Bảng lương → Số liệu chung:** DS cửa hàng Bách Ngân, DS trung bình 6 tháng, DS team Lock. Tháng cuối quý thì bật "Chi trả thưởng quý".
2. **Trang nhân viên → Lương & thưởng → Nhập số liệu tháng:**
   - Ngày làm việc (trống = theo chấm công) và giờ tăng ca.
   - DS tháng (trống = DS đơn hàng trên hệ thống) và sản lượng.
   - KPI CV.
   - BHYT / TNCN.
   - Thưởng quý (trống = tự tính).
3. **＋ Thêm khoản:** thưởng khác / tuyên dương, công tác, vi phạm, tạm ứng, tạm ứng điện thoại (mỗi khoản có lý do).
4. **Bảng lương → Chốt lương:** chốt cả bảng, hoặc chốt từng người ở trang nhân viên. Phiếu đã chốt lưu bản chụp toàn bộ chi tiết; sửa tham số hay dữ liệu sau đó không làm đổi phiếu. Tháng đã chốt thì khoá số liệu.
5. **Xuất Excel:** gồm các sheet Tổng hợp, Lương Sale, Lương Bách Ngân, Lương Lock, Chuyển khoản (có link VietQR).
6. **In phiếu lương:** nút "In phiếu lương" ở tab Lương & thưởng (Manager và chính nhân viên đó). Phiếu A4 dọc, lưu được PDF, có số tiền bằng chữ và chỗ ký. Phiếu đã chốt in đúng từng khoản lúc chốt.

## Cấu trúc dữ liệu
Migration theo thứ tự:
- `0027_hr_payroll`
- `0028_supabase_access_hr_payroll`
- `0029_hr_payroll_schemes`, `0030_supabase_access_hr_month_inputs`: bản tích hợp trước (PR #38), đã thay bằng bản này
- `0031_hr_payroll_reshape`: bỏ `hr_month_inputs`, `scheme`, `params`, `lines` và các cột của công thức cũ
- `0032_hr_payroll_template`
- `0033_supabase_access_hr_payroll_template`

| Bảng | Khoá | Nội dung |
|---|---|---|
| `hr_payroll_settings` | effective_month | Tham số công ty (JSON theo `PARAM_FIELDS`; thiếu khoá → mặc định file mẫu) |
| `hr_payroll_months` | month | DS Bách Ngân, DS TB 6 tháng, DS team Lock, chi thưởng quý |
| `hr_salary_profiles` | (member_id, effective_month) | Bảng lương, vị trí, LCB, hệ số năng lực, trách nhiệm (cách tính + tiền), cơm-xăng, điện thoại, chuyên cần, KPI, thưởng nhóm, đơn giá sản lượng, chỉ tiêu DS, BHXH, ngân hàng |
| `hr_attendance` | (member_id, work_date) | Chấm công từng ngày |
| `hr_payroll_inputs` | (member_id, month) | Số liệu tháng (null = lấy tự động) |
| `hr_adjustments` | id | Thưởng khác, công tác, vi phạm, tạm ứng, tạm ứng ĐT |
| `hr_payslips` | (member_id, month) | Phiếu đã chốt: bảng, ngày công, tổng thu nhập, khấu trừ, thực nhận + chi tiết JSON |

## Module
- **`hr`** (chỉ phụ thuộc `staff`):
  - `domain/` gồm tham số, KPI CV, công thức lương.
  - `api/payroll-data.ts`: một hàm `buildPayroll` tính lương cho trang nhân viên, bảng lương công ty và lúc chốt.
  - `api/routes.ts`: các API `/hr/*` (chỉ Manager).
  - DS đơn hàng (`revenueOf`) được truyền vào từ `src/app/router.ts`, nên `hr` không phụ thuộc module bán hàng.
- **`staff-hub`** (chỉ đọc): `GET /members/:id/overview?month=`.
- **Giao diện:** `trial-ui/member-detail.js` (hồ sơ nhân viên) và `trial-ui/payroll.js` (bảng lương công ty, `#/payroll`).

## API
| Route | Việc |
|---|---|
| `GET /members/:id/overview?month=YYYY-MM` | Trang chi tiết nhân viên (Manager: mọi người; nhân viên: chính mình) |
| `GET/PUT /hr/settings` | Tham số lương (áp dụng từ tháng) |
| `PUT /hr/months/:month` | Số liệu chung của nhóm |
| `GET /hr/payroll/:month` · `POST /hr/payroll/:month/confirm` | Bảng lương công ty · chốt cả bảng |
| `PUT /hr/members/:id/salary` | Hồ sơ lương áp dụng từ `effectiveMonth` |
| `PUT /hr/members/:id/inputs/:month` | Số liệu tháng |
| `PUT /hr/members/:id/attendance/:month` | `{ days: { 'YYYY-MM-DD': 'present' \| 'half' \| 'paid_leave' \| 'unpaid_leave' \| 'absent' \| '' } }` |
| `POST /hr/members/:id/adjustments` · `DELETE /hr/adjustments/:id` | Khoản cộng / trừ |
| `POST /hr/members/:id/payslips/:month` · `POST …/paid` · `DELETE …` | Chốt · đã trả · mở lại |


Đồng nghiệp cùng nhóm được xác định bằng `staff_members.position_id`, tài khoản đang hoạt động/chưa xoá. API overview trả `canViewPayroll: false` và `payroll: null` khi xem đồng nghiệp; không gọi `payrollOf` và không trả dữ liệu từ hồ sơ lương. Quyền các endpoint HR giữ nguyên.
