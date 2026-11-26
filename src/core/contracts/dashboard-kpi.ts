import type { AnyDb } from '../db/client.ts';

/** Một phần điểm KPI công việc của Sale (đúng các phần trên phiếu lương). */
export interface DashboardKpiPart {
  key: 'newCustomers' | 'transactions' | 'contracts' | 'revenue';
  label: string;
  /** Số thực tế dùng để chấm (null = phiếu để trống, không tính phần này). */
  actual: number | null;
  /** Cộng quy đổi từ ngày làm hàng / công tác (KH mới, giao dịch). */
  extra: number;
  target: number;
  /** Chỉ tiêu riêng trong hồ sơ lương (false = mức chung của tháng). */
  own: boolean;
  /** Điểm đạt được (tỷ lệ, 0,1 = 10%). */
  points: number;
  /** Điểm tối đa của phần này; null = không giới hạn. */
  max: number | null;
}
export interface DashboardKpiMember {
  id: string; name: string;
  /** estimate = tạm tính; confirmed / paid = theo phiếu lương đã chốt (bản chụp lúc chốt). */
  status: 'estimate' | 'confirmed' | 'paid';
  /** crm = KH mới / giao dịch / HĐ lấy tự động từ CRM; manual = nhập trên bảng lương. */
  source: 'crm' | 'manual';
  /** Tổng điểm thực tế từ các chỉ tiêu, dùng trên Tổng quan cho mọi nhân viên/chức vụ. */
  total: number;
  /** KPI dùng tính thưởng: bằng total, trừ khi có KPI chốt / KPI cố định. */
  used: number;
  adjustedBy: 'fixed' | 'override' | null;
  /** Tỷ lệ thưởng KPI tương ứng mức đạt (không phải số tiền). */
  bonusRate: number;
  /** Sale Admin: live tracking only; never a salary or bonus basis. */
  trackingOnly?: boolean;
  /** Chế độ đối chiếu: KPI tính từ CRM để so với số đang dùng (chưa áp dụng vào lương). */
  crmPreview: number | null;
  parts: DashboardKpiPart[];
  merchDays: number; tripDays: number;
  revenueBasis?: 'net-revenue' | 'invoice-total'; approvedOnly?:boolean;
}
/** App lắp từ HR: cùng cách tính với phiếu lương; dashboard không import HR / lương. */
export type DashboardKpiOf = (db: AnyDb, month: string, memberIds: readonly string[]) => Promise<DashboardKpiMember[]>;

export interface DashboardKpiDetailRow {id:string;date:string;label:string;customer:string;amount:number|null;href:string;note:string}
export interface DashboardKpiDetail {member:DashboardKpiMember;metric:DashboardKpiPart['key'];rows:DashboardKpiDetailRow[];total:number;sourceCount:number;page:number;pages:number;issues:number}
export type DashboardKpiDetailOf=(db:AnyDb,month:string,memberId:string,metric:DashboardKpiPart['key'],page:number)=>Promise<DashboardKpiDetail|null>;
