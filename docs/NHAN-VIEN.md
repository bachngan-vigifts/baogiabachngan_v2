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
| "Ẩn lương trước ngày 10" | Nhân viên tự xem: lương tháng M chỉ hiện từ ngày 10/M giờ VN (`SALARY_OPEN_DAY`); trước đó (và mọi tháng sau) API overview trả `payroll: null`, `access.salaryOpensOn` và `salaryAccount` (chỉ tài khoản nhận lương để vẫn điền / đổi được). Tháng trước xem bình thường; Manager luôn thấy. | `salaryOpensOn` |
| "Tài khoản nhận lương" (nhân viên tự điền) | Hồ sơ của tôi → thẻ **Tài khoản nhận lương** → Điền / Đổi tài khoản (`PUT /hr/me/bank`). Chỉ sửa ngân hàng, số TK (6–19 chữ số), tên chủ TK (IN HOA, bỏ dấu) của chính mình, áp cho mọi bản hồ sơ lương; cần có hồ sơ lương trước. Ghi nhật ký "nhân viên tự đổi" (không ghi số TK) và báo mọi Manager. Thẻ hiện mã VietQR: số tiền = thực nhận tháng đang xem, nội dung `Chuyen luong T<tháng>`; phiếu đã chốt dùng tài khoản lúc chốt (`transfer.fromSnapshot`). | `normalizeBank`, `payrollOf().transfer` |
| "Chỉ tiêu DS" | Chỉ tiêu DS cá nhân / tháng trong hồ sơ lương (mặc định 415tr ở Tham số) | – |
| "Chỉ tiêu KH mới / giao dịch / số HĐ" | Chỉ tiêu KPI riêng trong hồ sơ lương (Sale tính KPI). Để trống = mức chung của tháng ở Tham số; không nhận 0. Trọng số, bậc thưởng dùng chung. Đổi chỉ tiêu (cả DS) bắt buộc lý do; mỗi lần sửa hồ sơ lương ghi nhật ký trước → sau (không ghi số tài khoản), xem ở "Lịch sử sửa hồ sơ lương". Chỉ tiêu đã dùng lưu trong bản chụp phiếu lương (`kpi.targets`); KPI cố định / KPI chốt tay vẫn thay kết quả tính. Migration `20261105030000_hr_member_kpi_targets.sql` (chạy tay; cổng `scripts/sql/assert-hr-member-kpi-targets.sql`). | – |

Nhân viên **chưa có hồ sơ lương** vẫn hiện ở tab theo chức vụ (NVBH ML → tab NVBH ML, NVBH LOCK → tab NVBH Lock, còn lại → Sale & VP) trong khung "Chưa có hồ sơ lương", chưa tính vào tổng / chốt. Form hồ sơ lương điền sẵn mặc định theo chức vụ (`defaultProfileFor`): NVBH, trách nhiệm theo ngày, chuyên cần 200.000, hưởng thưởng DS nhóm.

### Công thức
**Chung cả 3 bảng:**
- Lương theo công = LCB × ngày làm ÷ công chuẩn. LCB trống thì lấy LCB vùng = LCB/ngày × công chuẩn.
- Năng lực = hệ số × 200.000.
- Trách nhiệm: cố định (Sale), theo tỷ lệ ngày làm (VD kho làm 18/26 ngày), hoặc theo ngày (Bách Ngân, Lock: 20.000 × ngày làm).
  Từ **11/2026**, Sale / Sale Admin: trách nhiệm × ngày công ÷ công chuẩn × điểm 4 báo cáo tuần ÷ 4 – xem [BAO-CAO-TUAN-SALE.md](BAO-CAO-TUAN-SALE.md).
- Cơm + xăng = 50.000 × MAX(0, ngày làm − ngày trừ cơm của nhóm). Thử việc: bỏ chọn "hưởng cơm + xăng".
- Tăng ca = LCB ÷ 24 ÷ 8 × giờ × 2.

**Sale & VP:**
- Thưởng KPI DS = DS tháng × (KPI CV ≥ 90% → 1,2%; ≥ 60% → 0,5%).
- Thưởng sản lượng = sản lượng × đơn giá / tỷ lệ (kho 15.000/đơn, TK 30.000/lượt, IT 0,005 × DS web).
- Thực nhận = Tổng − BHXH − vi phạm − MAX(tạm ứng ĐT, PC điện thoại) − tạm ứng.

**Bách Ngân (ML) và Lock – kỳ có nguồn doanh số CRM + POS:** cùng một thang thưởng DS chung cửa hàng
- DS chung = DS CRM net của NV thuộc bảng lương cửa hàng + DS bán quầy POS; chỉ tiêu 300tr/tháng/cửa hàng.
- Dưới 85% → 0 · từ 85% → 0,5% · từ 100% → 1% · trên 120% → 1,5% (đúng 120% vẫn 1%) × DS chung.
- Rồi ÷ số người chia (mặc định 2), chỉ cho người được chọn "hưởng thưởng DS nhóm".
- Mức % sửa ở Tham số lương, nhóm "Thưởng DS cửa hàng (CRM + POS)". Cách xét cũ ("threshold" / "tiers") không còn ảnh hưởng.

**Kỳ cũ chưa có nguồn CRM + POS (nhập tay):**
- Bách Ngân: DS > 300tr: DS/DS TB 6 tháng ≥ 100% → 1%, ≥ 85% → 0,5%; ÷ 2.
- Lock: DS < 85% × 300tr → 0; DS ≥ 310tr → 1,5%; còn lại → 1%; ÷ 2.

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

Mặc định là **Bảng tổng thể như Excel**: tiêu đề hai tầng, nhóm màu Năng lực/KPI/Phụ cấp/Các khoản trừ, cột Tổng thu nhập màu cam và Thực nhận màu xanh. Mỗi người một hàng gồm LCB, ngày công, lương theo công, hệ số cũ/mới, tiền năng lực, KPI, doanh số, thưởng, phụ cấp, tạm ứng và QR nhận lương. STT/họ tên cố định khi cuộn ngang; tiêu đề giữ trên cùng khi cuộn dọc. **Hệ số cũ** đọc từ hồ sơ lương gần nhất có tháng áp dụng trước tháng đang xem, không có dữ liệu thì hiện “—”. **KPI CV (%)** ở bảng tổng thể nhập 115,72 tương ứng tỷ lệ 1,1572 phía máy chủ. Cột Thưởng cho nhập thưởng khác bổ sung và hiển thị riêng tổng thưởng đã tính; các cột kết quả không sửa trực tiếp. QR của phiếu đã chốt lấy ngân hàng trong snapshot, không dùng hồ sơ ngân hàng mới.

Vẫn có thể chọn các nhóm nhập chuyên sâu bên dưới. Dán dữ liệu chỉ vào ô nhập liền nhau; vùng chạm cột tự tính bị từ chối toàn bộ để không đẩy lệch dữ liệu sang cột khác.

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
5. **Xuất Excel:** một sheet Bảng lương, cùng thứ tự cột, nhóm màu và dòng tổng với bảng Nhập nhanh.
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

### Thử việc và nhập bảng lương từ Excel

Trong bảng tổng thể, nhập/chọn **THỬ VIỆC** (hoặc **TV**) ở cột Vị trí rồi lưu. Vị trí này chỉ tính LCB × ngày công / ngày công chuẩn; không tính năng lực, trách nhiệm, KPI, thưởng, sản lượng, tăng ca, phụ cấp, BHXH / BHYT / TNCN. **Vẫn trừ** tiền đã ứng hoặc đã ghi phạt: tạm ứng, tạm ứng điện thoại, vi phạm / bể hàng (05/11/2026). Giá trị các chỉ số cũ vẫn được giữ để đối chiếu nhưng không đưa vào thực nhận. Đổi lại vị trí chính thức từ tháng phù hợp sẽ áp dụng công thức thông thường. Phiếu đã chốt giữ nguyên bản chụp.

Các ô tiền dùng dấu phẩy hàng nghìn, ví dụ **4,758,000**, sau khi rời ô. Ngày công, hệ số vẫn cho nhập số lẻ.

**Tải file mẫu** tạo `.xlsx` đúng tháng đang xem, chỉ có 11 cột: STT, Họ và tên, Ngày công, Nhân viên làm bể hàng/đền hàng, Số giờ làm thêm, Phiếu file sản xuất/phiếu giao hàng/phiếu làm hàng, Số lần đi trễ, Điện thoại Sale, Số giờ nghỉ trong ngày, BHXH, Tạm ứng. Không có cột LCB, KPI hay cài đặt lương. Sheet ẩn giữ kỳ lương và liên kết nhân viên; giữ nguyên STT/họ tên, có thể sắp xếp cả hàng. Người trùng tên được phân biệt bằng STT của file mẫu.

Ô trống giữ nguyên dữ liệu hiện tại; `0` ghi bằng 0. Ngày công nhập `Tự động` để lấy chấm công. Bể/đền hàng nhập số tiền khấu trừ; Điện thoại Sale là tạm ứng điện thoại; số phiếu là sản lượng, nhân đơn giá đã cài. BHXH cập nhật mức từ tháng đang xem. Khoản nhập nhanh cộng với các khoản đã ghi riêng. Số lần trễ và giờ nghỉ được lưu để đối chiếu, không tự tạo khoản trừ hoặc trừ thêm ngày công.

File mẫu có **đủ nhân viên trong bảng lương tháng đang chọn**, kể cả người đã chốt/đã trả lương; không phụ thuộc bộ lọc nhóm hay ô tìm kiếm trên màn hình. Dòng đã khóa tô xám và để trống số liệu. Khi nhập lại, các dòng đã khóa còn trống được bỏ qua; nhập bất kỳ số liệu nào (kể cả 0) vào dòng đã khóa sẽ bị từ chối.

**Xuất file bảng lương** trong thanh công cụ Nhập nhanh dùng cùng chức năng **Xuất Excel** ở đầu trang: xuất số liệu đã lưu của tháng đang chọn, một sheet duy nhất giống bảng Nhập nhanh tổng thể trên web; chi tiết khoản và trạng thái phiếu nằm trong ghi chú ô. Bộ lọc tìm kiếm/nhóm ở Nhập nhanh không giới hạn file xuất. Nếu có bản nháp chưa lưu, hệ thống yêu cầu lưu hoặc bỏ thay đổi trước khi xuất.

**Nhập file Excel** kiểm tra toàn bộ file trước khi tạo bản nháp; sai tháng, trùng/không tìm thấy nhân viên, tên lệch STT, sửa phiếu đã khóa hoặc ô lỗi bị từ chối. Không nhập công thức, không xóa sheet ẩn. Kiểm tra bảng rồi bấm **Lưu thay đổi** để ghi; file không tự lưu. Lưu/bỏ bản nháp trước khi nhập file mới. Tối đa 5 MB, 1.000 dòng, 100 nhân viên thay đổi mỗi lần. Chỉ số trễ/giờ nghỉ có thể xem/sửa tại chế độ Chấm công & chỉ số.

Migration `20261105042029_payroll_attendance_counters.sql` bổ sung `late_count` và `leave_hours` vào bảng chỉ số tháng; workflow API chạy trước khi deploy. Không thay đổi RLS hoặc các công thức khấu trừ hiện có.

## KPI chuẩn AppSheet từ kỳ 11/2026

Tham số `appsheetKpiFrom` (YYYYMM, 0 = chính sách cũ) kích hoạt theo kỳ. Cấu hình production được áp dụng từ 202611; không đổi bản chụp phiếu đã chốt. KH mới tối đa 10%, giao dịch 30%, HĐ hợp lệ 10%; doanh số ghi nhận / chỉ tiêu × 50% không có trần. Chỉ ngày làm hàng cộng bù 4 KH và 10 giao dịch mỗi ngày; công tác không cộng bù. Chỉ tiêu riêng từng nhân viên tiếp tục được áp dụng.

Khi bật lấy KPI từ CRM, các số đếm cũ nhập tay không ghi đè bộ đếm CRM. Doanh số ghi nhận là doanh số chưa VAT trừ hoa hồng khách hàng, theo ngày đơn trong kỳ và trạng thái đã duyệt; nháp/đợi duyệt/hủy không tính. HĐ tính theo tháng ký, HĐ đã ký/hoàn tất và đơn đủ điều kiện. Dữ liệu thiếu căn cứ hoa hồng được báo và chặn chốt theo chính sách mới. Trên bảng nhập nhanh, nguồn KPI/doanh số này chỉ đọc.

**KH mới:** mỗi hồ sơ khách doanh nghiệp do nhân viên tạo trên CRM, đã được duyệt, tính một lần cho `createdBy`; không cần báo giá, đơn hàng hay HĐKT. Kỳ tính là tháng được duyệt theo giờ Việt Nam; hồ sơ web cũ đã duyệt nhưng thiếu `approvedAt` dùng ngày tạo làm căn cứ dự phòng. Khách chờ duyệt/bị từ chối, khách lẻ/tiêu dùng dùng chung, hồ sơ đồng bộ Sapo/AppSheet và hồ sơ không xác định được người/ngày tạo không tự cộng điểm. Đổi phụ trách/chia sẻ hoặc tạo thêm đơn không cộng thêm hay chuyển điểm. Lương và bảng xếp hạng dùng cùng nguồn; phiếu đã chốt giữ nguyên bản chụp, không tự tính lại.

Kết quả KPI lưu `policy` và `basis` (số liệu thật đã dùng) cùng bốn điểm/tổng điểm/điểm áp dụng. Hồ sơ nhân viên, bảng KPI và xếp hạng đọc cùng kết quả; phiếu đã chốt dùng bản chụp. KPI cố định theo mã nhân viên được ưu tiên hơn KPI chốt tháng; không so sánh tên hiển thị trong code. Ngoại lệ KPI 100% được đặt bằng trường KPI cố định ở đúng hồ sơ Sale đã được xác minh.

Kỳ số liệu luôn 01–ngày cuối tháng; thời gian chốt là 03–05 tháng kế tiếp. Trong ngày 03–05 theo giờ VN, trang Bảng lương không có kỳ chỉ định sẽ mặc định mở tháng trước; chọn kỳ trên URL hoặc màn hình vẫn được ưu tiên. Không có tác vụ tự chốt/trả lương hoặc chuyển tiền ngân hàng.

Hướng dẫn có ảnh minh họa: [PDF](../trial-ui/guides/huong-dan-cai-dat-luong.pdf), [Word](../trial-ui/guides/huong-dan-cai-dat-luong.docx). Ảnh dùng dữ liệu kiểm thử, không chứa bảng lương thật.

## Đăng ký doanh số năm

Manager mở Bảng lương → Đăng ký doanh số năm, hoặc nút cùng tên ở hộp Hồ sơ lương. Chỉ áp dụng chức vụ có mã `sale`: bảng chỉ liệt kê Sale, API từ chối ghi chỉ tiêu cho Sale Admin, NVBH/CHT cửa hàng, Manager, Kho, Kế toán và các vị trí khác. Mỗi người Sale có 12 chỉ tiêu theo từng tháng; nhập tiền nguyên >0, lý do rồi lưu. Chỉ tiêu đăng ký được ưu tiên cho đúng tháng trong hồ sơ/KPI/dashboard/xếp hạng, không kế thừa sang tháng/năm khác. Chỉ tiêu quý là tổng ba tháng (tháng chưa đăng ký giữ cách lấy chỉ tiêu cũ). Ô DS trong hồ sơ lương chỉ đọc; lưu lương/phụ cấp không chép chỉ tiêu đăng ký vào hồ sơ kế thừa.

Chưa đăng ký hoặc xóa đăng ký: dùng chỉ tiêu hồ sơ cũ, nếu 0 thì dùng tham số chung. Giao diện ghi rõ nguồn. Phiếu đã chốt không đổi và tháng đã chốt khóa chỉnh chỉ tiêu năm; yêu cầu cũ bị từ chối 409 nếu dữ liệu vừa đổi. Mọi thay đổi ghi audit với trước/sau, người sửa, lý do.

API Manager: `GET/PUT /hr/revenue-targets/:year`. PUT nhận version của GET, reason và changes [{memberId,month,amount}], amount=null để bỏ đăng ký. Cùng payroll advisory lock với chốt lương; toàn bộ batch rollback khi có lỗi. Bảng `hr_revenue_targets` bật RLS, không cấp anon/authenticated; chỉ backend staff truy cập. Migration cần áp dụng trước API; workflow kiểm tra schema chỉ đọc.

Khi một người đã dùng bảng đăng ký năm, API hồ sơ lương không cho thay chỉ tiêu kế thừa bằng giá trị mới từ cửa sổ cũ; trả 409 và yêu cầu sửa ở bảng năm. Chặn cả khi chuyển tháng hoặc đã xóa hết đăng ký (đối chiếu audit), tránh ô chỉ đọc đã resolve bị ghi ngược vào hồ sơ dùng cho tháng sau. Các trường lương/phụ cấp khác vẫn lưu bình thường.

Chỉ tiêu đăng ký năm chỉ được dùng trong phép tính khi nhân viên hiện có chức vụ Sale. Các bản đăng ký cũ ngoài Sale được giữ để bảo toàn lịch sử, nhưng không xuất hiện trong bảng và không ghi đè chỉ tiêu hồ sơ hiện tại; phiếu đã chốt vẫn dùng snapshot.
