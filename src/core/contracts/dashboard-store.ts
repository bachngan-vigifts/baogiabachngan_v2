import type { AnyDb } from '../db/client.ts';

/** Một mốc thưởng DS chung cửa hàng: đạt `at` đồng (DS CRM + POS; `strict` = phải vượt) thì thưởng `rate` × DS, chia đều `split` người. */
export interface DashboardStoreTier { at: number; rate: number; strict: boolean }
export interface DashboardStoreMember {
  id: string; name: string; active: boolean;
  /** Cửa hàng trưởng của cửa hàng này. */
  storeManager: boolean;
  /** DS CRM net (đơn đã duyệt, cùng cách tính bảng lương) và DS POS các ca người này mở. */
  crm: number; pos: number; total: number;
}
export interface DashboardStore {
  key: 'bn' | 'lock'; registerId: string; name: string;
  target: number; revenue: number; crm: number; pos: number;
  /** Số đơn chưa đối chiếu được (DS có thể còn thay đổi). */
  issues: number;
  bonusMode: 'threshold' | 'tiers'; split: number; tiers: DashboardStoreTier[];
  /** Tỷ lệ thưởng đang đạt (0 = chưa đạt mốc) và thưởng tạm tính mỗi người (đã chia `split`). */
  rate: number; bonusPerPerson: number;
  members: DashboardStoreMember[];
}
export interface DashboardStoreBoard { month: string; policyMonth: string; stores: DashboardStore[] }
/** App lắp từ HR + bán hàng: cùng công thức thưởng DS cửa hàng của bảng lương; dashboard không import HR. */
export type DashboardStoreOf = (db: AnyDb, month: string) => Promise<DashboardStoreBoard | null>;
