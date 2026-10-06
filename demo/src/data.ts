/* eslint-disable @typescript-eslint/no-explicit-any */
import { cleanQuotation } from '../../src/modules/quotes/domain/quotation-schema.ts';
import type { Rules } from '../../src/modules/suppliers/domain/workflow.ts';
import { DEFAULT_RULES } from '../../src/modules/suppliers/domain/workflow.ts';
import type { QuoteShareTarget } from '../../src/modules/quotes/domain/access.ts';
import type { Role } from '../../src/modules/staff/domain/roles.ts';

/** Dữ liệu mẫu của bản demo. Chỉ nằm trong trình duyệt (localStorage), không kết nối cơ sở dữ liệu. */
export interface Member { id: string; name: string; title: string; role: Role; positionId: string; supplierId?: string }
export const MEMBERS: Member[] = [
  { id: 'lan', name: 'Lan', title: 'Manager', role: 'manager', positionId: 'manager' },
  { id: 'an', name: 'An', title: 'Sale', role: 'employee', positionId: 'sale' },
  { id: 'binh', name: 'Bình', title: 'Sale', role: 'employee', positionId: 'sale' },
  { id: 'chi', name: 'Chi', title: 'Kế toán', role: 'employee', positionId: 'accounting' },
  { id: 'ml', name: 'Minh Long', title: 'Tài khoản NCC', role: 'supplier', positionId: 'supplier', supplierId: 'S1' },
  { id: 'gv', name: 'Gốm Việt', title: 'Tài khoản NCC', role: 'supplier', positionId: 'supplier', supplierId: 'S2' },
];
export const SUPPLIERS = [{ id: 'S1', name: 'Minh Long', email: 'dathang@minhlong.example' }, { id: 'S2', name: 'Gốm Việt', email: 'kinhdoanh@gomviet.example' }];

export interface Quote { id: string; creatorId: string; assigneeId: string | null; data: any; revision: number; updatedAt: string; shares: QuoteShareTarget[]; log: string[] }
export interface OrderLine { sku: string; name: string; unit: string; quantity: number; price: number; taxRate: number; printFee: number; purchaseDiscount: number | null; confirmed?: { purchaseDiscount: number; promisedDate: string; supplierNote: string } }
export interface Order {
  id: string; ticket: string; quoteNo: string; supplierId: string; arrivalDate: string; approvalStatus: 'pending' | 'approved';
  supplierEmail: string; ccEmail: string; depositRate: number; paidAmount: number; internalNo: string; lines: OrderLine[];
  signature?: { fileName: string; mime: string; size: number; at: string }; signatureDownloaded?: boolean;
  confirmedAt?: string; dateChanges: any[]; discountChanges: any[]; depositRequestedAt?: string; depositPaidAt?: string;
  ready?: { mode: 'full' | 'partial'; date: string; rows: { sku: string; quantity: number }[] }; receivedAt?: string; log: string[];
}
export interface Persist { v: 1; meId: string; rules: Rules; seq: number; quotes: Quote[]; orders: Order[] }

const T0 = '2026-10-05T08:30:00.000Z';
let n = 0; const id = () => 'r' + (++n);
const clean = (o: object) => cleanQuotation(o, { newId: id, nowIso: () => T0 });
const row = (sku: string, name: string, brand: string, qty: number, price: number, discount: number, cost: number, extra: object = {}) => ({ sku, name, brand, unit: 'cái', qty, price, discount, costPrice: cost, ...extra });

export function seed(): Persist {
  const quotes: Quote[] = [
    { id: 'q1', creatorId: 'an', assigneeId: null, revision: 2, updatedAt: T0, shares: [], log: ['An tạo báo giá.', 'An sửa báo giá (bản 2).'],
      data: clean({ type: 'B2B', quoteNo: 'BG-0001', date: '2026-10-02', customer: 'Công ty Hoàng Long', vat: 8, rows: [
        row('LLM-24', 'Nồi Lock&Lock 24cm', 'LocknLock', 50, 420000, 30, 176000), row('ML-LY', 'Bộ ly sứ Minh Long (in logo)', 'Minh Long', 100, 185000, 10, 138750, { printFee: 8000 })] }) },
    { id: 'q2', creatorId: 'binh', assigneeId: null, revision: 1, updatedAt: T0, shares: [{ targetType: 'position', targetId: 'accounting', permission: 'view' }], log: ['Bình tạo báo giá.', 'Bình chia sẻ cho chức vụ Kế toán (chỉ xem).'],
      data: clean({ type: 'HRC', quoteNo: 'BG-0002', date: '2026-10-03', customer: 'Khách lẻ Phú Mỹ Hưng', vat: 10, rows: [row('HC-30', 'Chảo Healthy Cook 30cm', 'Healthy Cook', 4, 890000, 5, 575000)] }) },
    { id: 'q3', creatorId: 'an', assigneeId: 'binh', revision: 1, updatedAt: T0, shares: [], log: ['An tạo báo giá.', 'An giao Bình phụ trách.'],
      data: clean({ type: 'VIGIFTS', quoteNo: 'BG-0003', date: '2026-10-04', customer: 'Ngân hàng ABC', vat: 8, rows: [row('VG-BOX', 'Hộp quà Tết 2027', 'VIGIFTS', 500, 650000, 12, 390000, { printFee: 15000 })] }) },
  ];
  const line = (sku: string, name: string, quantity: number, price: number, taxRate: number, purchaseDiscount: number | null, printFee = 0): OrderLine => ({ sku, name, unit: 'cái', quantity, price, taxRate, printFee, purchaseDiscount });
  const base = { signatureDownloaded: false, dateChanges: [], discountChanges: [], paidAmount: 0, depositRate: 30, internalNo: '', ccEmail: '' };
  const orders: Order[] = [
    { ...base, id: 'o1', ticket: 'PO-2610-01', quoteNo: 'BG-0001', supplierId: 'S1', arrivalDate: '2026-10-28', approvalStatus: 'pending', supplierEmail: '', log: ['An gửi đơn đặt hàng NCC, chờ Manager duyệt.'],
      lines: [line('ML-LY', 'Bộ ly sứ Minh Long', 100, 185000, 8, null, 8000), line('ML-DIA', 'Đĩa sứ 26cm', 60, 98000, 8, null)] },
    { ...base, id: 'o2', ticket: 'PO-2610-02', quoteNo: 'BG-0003', supplierId: 'S1', arrivalDate: '2026-10-30', approvalStatus: 'approved', supplierEmail: 'dathang@minhlong.example', log: ['An gửi đơn đặt hàng NCC.', 'Lan duyệt đơn và gửi cho NCC.'],
      lines: [line('VG-BOX', 'Hộp quà Tết 2027', 500, 390000, 8, 15, 15000), line('VG-THIEP', 'Thiệp chúc mừng', 500, 12000, 8, 5)] },
    { ...base, id: 'o3', ticket: 'PO-2610-03', quoteNo: 'BG-0002', supplierId: 'S2', arrivalDate: '2026-10-22', approvalStatus: 'approved', supplierEmail: 'kinhdoanh@gomviet.example', log: ['Bình gửi đơn đặt hàng NCC.', 'Lan duyệt đơn.', 'Gốm Việt tải bản ký và xác nhận đơn.', 'Gốm Việt yêu cầu đặt cọc 30%.'],
      signature: { fileName: 'ban-ky-gom-viet.pdf', mime: 'application/pdf', size: 480000, at: T0 }, confirmedAt: T0, depositRequestedAt: T0,
      lines: [{ ...line('GV-BAT', 'Bát gốm men ngọc', 200, 76000, 8, 20), confirmed: { purchaseDiscount: 20, promisedDate: '2026-10-22', supplierNote: '' } }] },
  ];
  return { v: 1, meId: 'an', rules: { ...DEFAULT_RULES }, seq: 4, quotes, orders };
}
