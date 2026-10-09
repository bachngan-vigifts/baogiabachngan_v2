import { and, eq, inArray } from 'drizzle-orm';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { quotations } from '../../quotes/schema.ts';
import { printingInfo } from '../../quotes/domain/quote-math.ts';
import { orderProgress, type OrderProgress, type ProgressMark, type ProgressStage } from '../domain/progress.ts';
import { orderProgressMarks, packingSlips, salesOrders } from '../schema.ts';

type Db = StaffEnv['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Đơn có phí in (B2B / VIGIFTS có dòng phí in) → có 2 bước "In mẫu" và "Sản xuất". Theo báo giá gốc của đơn. */
export async function printingOrders(db: Db | Tx, orderIds: string[]) {
  const ids = [...new Set(orderIds)];
  if (!ids.length) return new Set<string>();
  const rows = await db.select({ id: salesOrders.id, data: quotations.data }).from(salesOrders).innerJoin(quotations, eq(quotations.id, salesOrders.quoteId)).where(inArray(salesOrders.id, ids));
  return new Set(rows.filter(r => { try { return printingInfo(JSON.parse(r.data)).enabled; } catch { return false; } }).map(r => r.id));
}

/** Tiến trình sản phẩm của nhiều đơn / HĐKT (một lượt truy vấn mỗi loại). */
export async function progressOf(db: Db | Tx, orderIds: string[]): Promise<Map<string, OrderProgress>> {
  const ids = [...new Set(orderIds)];
  if (!ids.length) return new Map();
  const [orders, packed, printing, marks] = await Promise.all([
    db.select({ id: salesOrders.id, status: salesOrders.status }).from(salesOrders).where(inArray(salesOrders.id, ids)),
    db.selectDistinct({ orderId: packingSlips.orderId }).from(packingSlips).where(and(inArray(packingSlips.orderId, ids), eq(packingSlips.status, 'packed'))),
    printingOrders(db, ids),
    db.select({ orderId: orderProgressMarks.orderId, stage: orderProgressMarks.stage, source: orderProgressMarks.source, at: orderProgressMarks.markedAt, byName: employees.name })
      .from(orderProgressMarks).leftJoin(employees, eq(employees.id, orderProgressMarks.markedBy)).where(inArray(orderProgressMarks.orderId, ids)),
  ]);
  const packedSet = new Set(packed.map(p => p.orderId));
  return new Map(orders.map(o => {
    const m: Partial<Record<ProgressStage, ProgressMark>> = {};
    for (const x of marks) if (x.orderId === o.id) m[x.stage] = { source: x.source, at: x.at, byName: x.byName };
    return [o.id, orderProgress({ status: o.status, packed: packedSet.has(o.id), printing: printing.has(o.id), marks: m })];
  }));
}

/** Ghi các bước đã xong (bỏ qua bước đã có). `source`: 'task' (hoàn thành việc In mẫu / Sản xuất) hoặc 'manual' (Manager). */
export async function markProgress(db: Db | Tx, orderId: string, stages: ProgressStage[], source: 'task' | 'manual', by: string | null) {
  if (!stages.length) return;
  const now = new Date().toISOString();
  await db.insert(orderProgressMarks).values(stages.map(stage => ({ orderId, stage, source, markedBy: by, markedAt: now }))).onConflictDoNothing();
}

/** Bỏ đánh dấu tay của Manager (bước đó và các bước sau) – chỉ dấu tay, không đụng bước tự xong theo chứng từ / công việc. */
export async function unmarkProgress(db: Db | Tx, orderId: string, stages: ProgressStage[]) {
  if (!stages.length) return;
  await db.delete(orderProgressMarks).where(and(eq(orderProgressMarks.orderId, orderId), eq(orderProgressMarks.source, 'manual'),
    inArray(orderProgressMarks.stage, stages)));
}
