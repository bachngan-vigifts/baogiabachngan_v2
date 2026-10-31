/**
 * THAM SỐ LƯƠNG CÔNG TY (sheet "Tham số" của file Bảng lương mẫu) – một chỗ duy nhất.
 * Lưu theo "áp dụng từ tháng" (bảng hr_payroll_settings); tháng nào không có thì dùng bản gần nhất trước đó, chưa có bản nào thì dùng DEFAULT_PARAMS.
 * Thêm tham số mới = thêm một dòng vào PARAM_FIELDS (khoá, nhóm, nhãn, mặc định, kiểu) – API, giao diện và kiểm tra tự theo.
 */
export type ParamKind = 'money' | 'number' | 'percent' | 'ratio';
export interface ParamField { key: string; group: string; label: string; value: number; kind: ParamKind; note?: string }

export const PARAM_FIELDS = [
  {key:'saleKpiNetFrom',group:'Thưởng KPI Sale — doanh số net',label:'Tháng áp dụng doanh số net (YYYYMM; 0 = chính sách cũ)',value:202610,kind:'number'},
  {key:'saleKpiNetLowRate',group:'Thưởng KPI Sale — doanh số net',label:'Thưởng từ 60% đến dưới 90%',value:0.005,kind:'percent'},
  {key:'saleKpiNetHighRate',group:'Thưởng KPI Sale — doanh số net',label:'Thưởng từ 90% đến hết 120%',value:0.01,kind:'percent'},
  {key:'saleKpiNetOverRate',group:'Thưởng KPI Sale — doanh số net',label:'Thưởng trên 120%',value:0.012,kind:'percent'},
  {key:'salesAutomationFrom',group:'KPI công việc – Sale',label:'Tháng bắt đầu KPI Sale từ CRM (YYYYMM; 0 = tắt)',value:0,kind:'number',note:'KH mới: đơn CRM đã duyệt đầu tiên trong toàn bộ lịch sử; giao dịch: liên hệ hợp lệ; HĐ: tháng ký. Dữ liệu cũ chưa xác nhận không tự tính giao dịch.'},
  {key:'salesAutomationApply',group:'KPI công việc – Sale',label:'Áp dụng KPI từ CRM (0 = đối chiếu; 1 = áp dụng)',value:0,kind:'number'},
  {key:'contractBonusFrom',group:'Thưởng HĐKT',label:'Tháng bắt đầu thưởng HĐKT (YYYYMM; 0 = tắt)',value:0,kind:'number'},
  {key:'contractBonusApply',group:'Thưởng HĐKT',label:'Áp dụng thưởng sao / thanh lý (0 = đối chiếu; 1 = áp dụng)',value:0,kind:'number'},
  {key:'contractStar1From',group:'Thưởng HĐKT',label:'Cận dưới 1 sao (trước VAT)',value:2000000,kind:'money'},
  {key:'contractStar1Amount',group:'Thưởng HĐKT',label:'Thưởng 1 sao',value:20000,kind:'money'},
  {key:'contractStar2From',group:'Thưởng HĐKT',label:'Cận dưới 2 sao (trước VAT)',value:20000000,kind:'money'},
  {key:'contractStar2Amount',group:'Thưởng HĐKT',label:'Thưởng 2 sao',value:50000,kind:'money'},
  {key:'contractStar3From',group:'Thưởng HĐKT',label:'Cận dưới 3 sao (trước VAT)',value:100000000,kind:'money'},
  {key:'contractStar3Amount',group:'Thưởng HĐKT',label:'Thưởng 3 sao',value:100000,kind:'money'},
  {key:'contractStar4From',group:'Thưởng HĐKT',label:'Cận dưới 4 sao (trước VAT)',value:500000000,kind:'money'},
  {key:'contractStar4Amount',group:'Thưởng HĐKT',label:'Thưởng 4 sao',value:200000,kind:'money'},
  {key:'contractStar5From',group:'Thưởng HĐKT',label:'Cận dưới 5 sao (trước VAT)',value:1000000000,kind:'money'},
  {key:'contractStar5Amount',group:'Thưởng HĐKT',label:'Thưởng 5 sao',value:500000,kind:'money'},
  {key:'contractLiquidationAmount',group:'Thưởng HĐKT',label:'Thưởng Manager duyệt thanh lý / HĐKT',value:10000,kind:'money'},
  // Lương cơ bản & công
  { key: 'standardDays', group: 'Lương cơ bản & công', label: 'Công chuẩn / tháng (ngày)', value: 26, kind: 'number', note: 'Lương theo công = LCB × ngày làm ÷ công chuẩn' },
  { key: 'minWageDay', group: 'Lương cơ bản & công', label: 'LCB vùng II / ngày', value: 183_000, kind: 'money', note: 'LCB vùng / tháng = mức này × công chuẩn (mức mua BHXH)' },
  { key: 'capacityUnit', group: 'Lương cơ bản & công', label: 'Đơn giá 1 hệ số năng lực', value: 200_000, kind: 'money' },
  { key: 'responsibilityDay', group: 'Lương cơ bản & công', label: 'Trách nhiệm / ngày (Bách Ngân, Lock)', value: 20_000, kind: 'money' },
  // Phụ cấp & tăng ca
  { key: 'mealDay', group: 'Phụ cấp & tăng ca', label: 'Phụ cấp cơm / ngày', value: 25_000, kind: 'money', note: 'Thứ 7 tính 1/2 ngày; thử việc không hưởng' },
  { key: 'fuelDay', group: 'Phụ cấp & tăng ca', label: 'Phụ cấp xăng / ngày', value: 25_000, kind: 'money' },
  { key: 'overtimeDays', group: 'Phụ cấp & tăng ca', label: 'Số ngày chuẩn tính giờ tăng ca', value: 24, kind: 'number', note: 'Tiền TC = LCB ÷ 24 ÷ 8 × giờ × hệ số' },
  { key: 'hoursPerDay', group: 'Phụ cấp & tăng ca', label: 'Số giờ / ngày', value: 8, kind: 'number' },
  { key: 'overtimeRate', group: 'Phụ cấp & tăng ca', label: 'Hệ số tăng ca', value: 2, kind: 'number' },
  { key: 'mealOffSale', group: 'Phụ cấp & tăng ca', label: 'Số ngày trừ cơm – Sale & VP', value: 0, kind: 'number' },
  { key: 'mealOffBn', group: 'Phụ cấp & tăng ca', label: 'Số ngày trừ cơm – Bách Ngân', value: 1, kind: 'number' },
  { key: 'mealOffLock', group: 'Phụ cấp & tăng ca', label: 'Số ngày trừ cơm – Lock', value: 0, kind: 'number' },
  // Thưởng KPI – Sale
  { key: 'kpiHigh', group: 'Thưởng KPI Sale — chính sách cũ', label: 'Ngưỡng KPI CV mức cao', value: 0.9, kind: 'percent' },
  { key: 'kpiHighRate', group: 'Thưởng KPI Sale — chính sách cũ', label: 'Tỷ lệ thưởng DS – mức cao', value: 0.012, kind: 'percent', note: 'Chỉ dùng cho kỳ trước chính sách doanh số net.' },
  { key: 'kpiLow', group: 'Thưởng KPI Sale — chính sách cũ', label: 'Ngưỡng KPI CV mức thấp', value: 0.6, kind: 'percent' },
  { key: 'kpiLowRate', group: 'Thưởng KPI Sale — chính sách cũ', label: 'Tỷ lệ thưởng DS – mức thấp', value: 0.005, kind: 'percent', note: 'Dưới ngưỡng thấp: không thưởng' },
  // KPI công việc – Sale (sheet "KPI CV")
  { key: 'kpiNewCustomers', group: 'KPI công việc – Sale', label: 'Chỉ tiêu KH mới / tháng', value: 96, kind: 'number' },
  { key: 'kpiNewCustomersWeight', group: 'KPI công việc – Sale', label: 'Trọng số KH mới', value: 0.1, kind: 'percent' },
  { key: 'kpiNewCustomersOver', group: 'KPI công việc – Sale', label: 'Điểm KH mới khi vượt chỉ tiêu', value: 0.2, kind: 'percent' },
  { key: 'kpiTransactions', group: 'KPI công việc – Sale', label: 'Chỉ tiêu giao dịch / tháng', value: 260, kind: 'number' },
  { key: 'kpiTransactionsWeight', group: 'KPI công việc – Sale', label: 'Trọng số giao dịch', value: 0.3, kind: 'percent' },
  { key: 'kpiContracts', group: 'KPI công việc – Sale', label: 'Chỉ tiêu số hợp đồng / tháng', value: 8, kind: 'number' },
  { key: 'kpiContractsWeight', group: 'KPI công việc – Sale', label: 'Trọng số số hợp đồng', value: 0.1, kind: 'percent' },
  { key: 'kpiRevenue', group: 'KPI công việc – Sale', label: 'Chỉ tiêu DS cá nhân / tháng (mặc định)', value: 415_000_000, kind: 'money', note: 'Dùng khi hồ sơ nhân viên chưa đặt chỉ tiêu riêng' },
  { key: 'kpiRevenueWeight', group: 'KPI công việc – Sale', label: 'Trọng số DS cá nhân', value: 0.5, kind: 'percent', note: 'Không giới hạn tối đa' },
  { key: 'kpiCustomersPerExtraDay', group: 'KPI công việc – Sale', label: 'Cộng KH mới / ngày làm hàng hoặc công tác', value: 4, kind: 'number' },
  { key: 'kpiTransactionsPerExtraDay', group: 'KPI công việc – Sale', label: 'Cộng giao dịch / ngày làm hàng hoặc công tác', value: 10, kind: 'number' },
  // Thưởng quý – team Sale
  { key: 'quarterRate', group: 'Thưởng quý – team Sale', label: 'Tỷ lệ thưởng (% DS team quý)', value: 0.005, kind: 'percent' },
  { key: 'quarterTeamMin', group: 'Thưởng quý – team Sale', label: 'ĐK 1: DS team đạt ≥ % chỉ tiêu', value: 0.9, kind: 'percent' },
  { key: 'quarterMemberMin', group: 'Thưởng quý – team Sale', label: 'ĐK 2: mỗi thành viên đạt ≥ % chỉ tiêu', value: 0.6, kind: 'percent' },
  // Thưởng DS – Bách Ngân
  { key: 'bnMinRevenue', group: 'Thưởng DS – Bách Ngân', label: 'DS tối thiểu để xét thưởng', value: 300_000_000, kind: 'money', note: 'DS tháng ≤ mức này: không thưởng' },
  { key: 'bnLevel1', group: 'Thưởng DS – Bách Ngân', label: 'Mức 1: DS tháng ≥ … × DS TB 6 tháng', value: 1, kind: 'ratio' },
  { key: 'bnLevel1Rate', group: 'Thưởng DS – Bách Ngân', label: 'Mức 1: tỷ lệ thưởng', value: 0.01, kind: 'percent' },
  { key: 'bnLevel2', group: 'Thưởng DS – Bách Ngân', label: 'Mức 2: DS tháng ≥ … × DS TB 6 tháng', value: 0.85, kind: 'ratio', note: 'File gốc 85% (chính sách ghi 80%)' },
  { key: 'bnLevel2Rate', group: 'Thưởng DS – Bách Ngân', label: 'Mức 2: tỷ lệ thưởng', value: 0.005, kind: 'percent' },
  { key: 'bnSplit', group: 'Thưởng DS – Bách Ngân', label: 'Số người chia thưởng', value: 2, kind: 'number' },
  // Thưởng DS – Lock (team)
  { key: 'lockTarget', group: 'Thưởng DS – Lock', label: 'Chỉ tiêu DS team / tháng', value: 300_000_000, kind: 'money' },
  { key: 'lockFloor', group: 'Thưởng DS – Lock', label: 'Sàn xét thưởng (% chỉ tiêu)', value: 0.85, kind: 'percent', note: 'Dưới sàn: không thưởng' },
  { key: 'lockHigh', group: 'Thưởng DS – Lock', label: 'Ngưỡng DS mức cao', value: 310_000_000, kind: 'money' },
  { key: 'lockHighRate', group: 'Thưởng DS – Lock', label: 'Thưởng mức cao (% DS)', value: 0.015, kind: 'percent' },
  { key: 'lockRate', group: 'Thưởng DS – Lock', label: 'Thưởng mức thường (% DS)', value: 0.01, kind: 'percent' },
  { key: 'lockSplit', group: 'Thưởng DS – Lock', label: 'Số người chia thưởng', value: 2, kind: 'number' },
  // Khấu trừ
  { key: 'socialInsurance', group: 'Khấu trừ', label: 'BHXH người lao động (mặc định)', value: 496_650, kind: 'money', note: 'Gợi ý khi đặt mức lương từng người' },
] as const satisfies readonly ParamField[];

export type ParamKey = typeof PARAM_FIELDS[number]['key'];
export type PayrollParams = Record<ParamKey, number>;
export const DEFAULT_PARAMS = Object.fromEntries(PARAM_FIELDS.map(f => [f.key, f.value])) as PayrollParams;
/** Các tham số phải > 0 (dùng làm số chia). */
const POSITIVE: readonly ParamKey[] = ['standardDays', 'overtimeDays', 'hoursPerDay', 'kpiNewCustomers', 'kpiTransactions', 'kpiContracts', 'kpiRevenue', 'bnSplit', 'lockSplit'];

/** Ghép tham số đã lưu (JSON) với mặc định; bỏ khoá lạ, giá trị hỏng dùng mặc định. */
export function mergeParams(saved: unknown): PayrollParams {
  const src = saved && typeof saved === 'object' ? saved as Record<string, unknown> : {};
  const out = { ...DEFAULT_PARAMS };
  for (const f of PARAM_FIELDS) {
    const n = Number(src[f.key]);
    if (src[f.key] !== undefined && src[f.key] !== '' && Number.isFinite(n) && n >= 0 && !(POSITIVE.includes(f.key) && n <= 0)) out[f.key] = n;
  }
  // Existing saved policies used one switch for both. Preserve that policy until explicitly separated.
  if(src.contractBonusApply===undefined)out.contractBonusApply=out.salesAutomationApply;
  if(src.contractBonusFrom===undefined)out.contractBonusFrom=out.salesAutomationFrom;
  return out;
}

/** Kiểm tra tham số gửi lên: trả lỗi đầu tiên (tiếng Việt) hoặc null. */
export function validateParams(input: unknown): string | null {
  if (!input || typeof input !== 'object') return 'Thiếu tham số.';
  const src = input as Record<string, unknown>;
  for (const f of PARAM_FIELDS) {
    if (src[f.key] === undefined) continue;
    const n = Number(src[f.key]);
    if (!Number.isFinite(n) || n < 0 || n > 1e13) return `${f.label}: giá trị không hợp lệ.`;
    if(f.kind==='money'&&!Number.isSafeInteger(n))return `${f.label}: nhập số tiền nguyên đồng.`;
    if (POSITIVE.includes(f.key) && n <= 0) return `${f.label} phải lớn hơn 0.`;
    if (f.kind === 'percent' && n > 1) return `${f.label}: nhập dạng tỷ lệ (0,012 = 1,2%).`;
  }
  const values=mergeParams(src);
  if(values.salesAutomationApply===1&&values.kpiNewCustomersOver>0.1)return 'Trần điểm KH mới phải tối đa 10% trước khi áp dụng KPI Sale từ CRM.';
  if(![0,1].includes(values.contractBonusApply))return 'Áp dụng thưởng HĐKT phải là 0 hoặc 1.';
  if(![0,1].includes(values.salesAutomationApply))return 'Áp dụng CRM phải là 0 hoặc 1.';
  if(values.salesAutomationFrom!==0&&!/^\d{4}(0[1-9]|1[0-2])$/.test(String(values.salesAutomationFrom)))return 'Tháng bắt đầu CRM nhập YYYYMM hoặc 0.';
  if(values.contractBonusFrom!==0&&!/^\d{4}(0[1-9]|1[0-2])$/.test(String(values.contractBonusFrom)))return 'Tháng bắt đầu thưởng HĐKT nhập YYYYMM hoặc 0.';
  for(let i=2;i<=5;i++)if(values[('contractStar'+i+'From') as ParamKey]<=values[('contractStar'+(i-1)+'From') as ParamKey])return 'Cận sao phải tăng dần.';
  if(values.saleKpiNetFrom!==0&&!/^\d{4}(0[1-9]|1[0-2])$/.test(String(values.saleKpiNetFrom)))return 'Tháng áp dụng doanh số net nhập YYYYMM hoặc 0.';
  return null;
}

/** LCB vùng / tháng (mức mua BHXH, LCB mặc định khi hồ sơ chưa đặt). */
export const minWageMonth = (p: PayrollParams) => p.minWageDay * p.standardDays;
