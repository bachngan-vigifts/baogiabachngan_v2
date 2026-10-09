import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Router } from '../core/http/router.ts';
import { json } from '../core/http/router.ts';
import { AppError } from '../core/errors.ts';
import type { SessionState, StaffEnv } from '../modules/staff/api/auth-routes.ts';
import { employees } from '../modules/staff/schema.ts';
import { quotations } from '../modules/quotes/schema.ts';
import { salesContracts, salesOrders } from '../modules/sales/schema.ts';
import { customers } from '../modules/customers/schema.ts';
import { products } from '../modules/catalog/schema.ts';

/** Loại việc cần duyệt (thứ tự hiển thị). */
export const APPROVAL_KINDS = ['quote', 'order', 'contract', 'customer', 'product'] as const;
export type ApprovalKind = typeof APPROVAL_KINDS[number];
export interface ApprovalItem { kind: ApprovalKind; id: string; title: string; sub: string; by: string; at: string; amount: number | null; link: string }

/**
 * HỘP "CẦN DUYỆT" (Manager, thẻ trong trang Công việc): gom mọi thứ đang chờ Manager duyệt vào một chỗ.
 *  - Báo giá `approval_status = pending` (nhân viên lập hoặc khách gửi)
 *  - Đơn hàng nháp chưa có HĐKT · HĐKT của đơn nháp (duyệt đơn = duyệt HĐKT)
 *  - Khách hàng nhân viên tạo chờ duyệt · Sản phẩm nhân viên thêm chờ duyệt
 * CHỈ ĐỌC – duyệt vẫn làm ở đúng màn hình của từng loại (giữ hộp kiểm tra như hiện nay); mỗi dòng có link mở thẳng màn hình đó.
 * Cũ nhất lên trước (chờ lâu nhất xử lý trước).
 */
export function registerApprovalRoutes(router: Router<StaffEnv>) {
  router.get('/approvals', async c => {
    if ((c.state.session as SessionState).member.role !== 'manager') throw new AppError(403, 'Chỉ Manager xem được hộp Cần duyệt.');
    const db = c.env.db, LIMIT = 200;
    const [qs, os, cs, ps] = await Promise.all([
      db.select({ id: quotations.id, quoteNo: quotations.quoteNo, customer: quotations.customer, createdAt: quotations.createdAt, updatedAt: quotations.updatedAt, by: employees.name, role: employees.role })
        .from(quotations).leftJoin(employees, eq(employees.id, quotations.creatorId)).where(eq(quotations.approvalStatus, 'pending')).orderBy(asc(quotations.updatedAt)).limit(LIMIT),
      db.select({ id: salesOrders.id, orderNo: salesOrders.orderNo, customerName: salesOrders.customerName, total: salesOrders.total, createdAt: salesOrders.createdAt, by: employees.name })
        .from(salesOrders).leftJoin(employees, eq(employees.id, salesOrders.createdBy)).where(eq(salesOrders.status, 'draft')).orderBy(asc(salesOrders.createdAt)).limit(LIMIT),
      db.select({ id: customers.id, name: customers.name, phone: customers.phone, taxCode: customers.taxCode, createdAt: customers.createdAt, by: employees.name })
        .from(customers).leftJoin(employees, eq(employees.id, customers.createdBy)).where(eq(customers.approvalStatus, 'pending')).orderBy(asc(customers.createdAt)).limit(LIMIT),
      db.select({ sku: products.sku, name: products.name, updatedAt: products.updatedAt, by: employees.name })
        .from(products).leftJoin(employees, eq(employees.id, products.createdBy)).where(eq(products.approvalStatus, 'pending')).orderBy(asc(products.updatedAt)).limit(LIMIT),
    ]);
    const contracts = os.length ? await db.select({ orderId: salesContracts.orderId, contractNo: salesContracts.contractNo }).from(salesContracts)
      .where(and(inArray(salesContracts.orderId, os.map(o => o.id)))) : [];
    const contractOf = new Map(contracts.map(k => [k.orderId, k.contractNo]));
    const items: ApprovalItem[] = [
      ...qs.map(q => ({ kind: 'quote' as const, id: q.id, title: `Báo giá ${q.quoteNo}`, sub: (q.role === 'customer' ? 'Khách gửi · ' : '') + (q.customer || 'Chưa nhập khách'),
        by: q.by ?? '', at: q.updatedAt || q.createdAt, amount: null, link: `#/quotes/${q.id}` })),
      ...os.map(o => { const k = contractOf.get(o.id);
        return { kind: k ? 'contract' as const : 'order' as const, id: o.id, title: k ? `HĐKT ${k} · đơn ${o.orderNo}` : `Đơn ${o.orderNo}`, sub: o.customerName,
          by: o.by ?? '', at: o.createdAt, amount: o.total, link: `#/orders/${o.id}` }; }),
      ...cs.map(k => ({ kind: 'customer' as const, id: k.id, title: `Khách hàng ${k.name}`, sub: [k.phone, k.taxCode && 'MST ' + k.taxCode].filter(Boolean).join(' · '),
        by: k.by ?? '', at: k.createdAt, amount: null, link: `#/customers/${encodeURIComponent(k.id)}` })),
      ...ps.map(p => ({ kind: 'product' as const, id: p.sku, title: `Sản phẩm ${p.name}`, sub: `Mã ${p.sku}`, by: p.by ?? '', at: p.updatedAt, amount: null, link: '#/products' })),
    ].sort((a, b) => (a.at || '').localeCompare(b.at || ''));
    const counts = Object.fromEntries(APPROVAL_KINDS.map(k => [k, items.filter(i => i.kind === k).length])) as Record<ApprovalKind, number>;
    return json({ counts: { ...counts, total: items.length }, items });
  }, 'business');
}
