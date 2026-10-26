import { assertCrmOrderCompletion, crmStockFulfilment } from './crm-stock-lifecycle.ts';
import { invoiceTasksChanged } from './invoice-task-hooks.ts';
import { and, eq } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { PROGRESS_STAGES } from '../domain/statuses.ts';
import { stagesFor, stagesUpTo, type ProgressStage } from '../domain/progress.ts';
import { salesOrders } from '../schema.ts';
import { markProgress, printingOrders, progressOf, unmarkProgress } from './progress.ts';
import { closeSlipsOfDeliveredOrders } from './packing-close.ts';
import { orderScopeFor } from './routes.ts';

/**
 * Tiến trình sản phẩm – Manager bấm hoàn thành nhanh (lối tắt): `POST /orders/:id/progress { stage, done }`.
 *  - `done: true` (mặc định): đánh dấu xong bước `stage` và mọi bước trước nó; `stage: 'all'` = hoàn thành cả đơn.
 *  - `done: false`: bỏ dấu tay ở bước `stage` và các bước sau (bước tự xong theo chứng từ / công việc giữ nguyên).
 * Chỉ ghi tiến trình để mọi người theo dõi – không đổi trạng thái đơn, giao hàng, công nợ.
 */
type Ctx = RouteContext<StaffEnv>;
const viewer = (c: Ctx) => (c.state.session as SessionState).member;

export function registerProgressRoutes(router: Router<StaffEnv>) {
  router.post('/orders/:id/progress', async c => {
    const manager=viewer(c).role==='manager',saleAdmin=viewer(c).role==='employee'&&viewer(c).positionId==='sale-admin';
    if (!manager&&!saleAdmin) throw new AppError(403, 'Chỉ Manager hoặc Sale Admin được thao tác nhanh tiến trình.');
    const body = await readJson(c.req, 1_024), stage = body.stage as ProgressStage | 'all';
    if (stage !== 'all' && !(PROGRESS_STAGES as readonly string[]).includes(stage)) throw new AppError(400, 'Bước tiến trình không hợp lệ.');
    if(!manager&&!['sample','production'].includes(stage))throw new AppError(403,'Duyệt đơn, xuất kho và giao hàng phải thao tác trên chứng từ tương ứng.');
    const [order] = await c.env.db.select({ id: salesOrders.id, status: salesOrders.status }).from(salesOrders)
      .where(and(eq(salesOrders.id, c.params.id!), orderScopeFor(viewer(c)))).limit(1);
    if (!order) throw new AppError(404, 'Không tìm thấy đơn hàng / HĐKT.');
    if (order.status === 'cancelled') throw new AppError(409, 'Đơn / HĐKT đã huỷ.');
    const printing = (await printingOrders(c.env.db, [order.id])).has(order.id), list = stagesFor(printing);
    if (stage !== 'all' && !list.includes(stage)) throw new AppError(400, 'Đơn này không có bước đó (đơn không in thì không có In mẫu / Sản xuất).');
    await c.env.db.transaction(async tx => {
      const [fresh] = await tx.select({ status: salesOrders.status }).from(salesOrders).where(eq(salesOrders.id, order.id)).for('update');
      if (!fresh || fresh.status === 'cancelled') throw new AppError(409, 'Đơn / HĐKT đã huỷ hoặc vừa thay đổi.');
      if (body.done === false) {
        if (stage === 'all') throw new AppError(400, 'Chọn bước cần bỏ đánh dấu.');
        await unmarkProgress(tx, order.id, list.slice(list.indexOf(stage)).filter(s=>manager||['sample','production'].includes(s)));
      } else {
        if (stage === 'all' || stage === 'delivered') await assertCrmOrderCompletion(tx, order.id);
        const physical=(await crmStockFulfilment(tx,[order.id])).get(order.id);
        if(physical?.lines.length&&physical.status==='draft')throw new AppError(409,'Duyệt đơn bằng thao tác duyệt chứng từ, không đánh dấu tiến trình để thay bước duyệt.','ORDER_NOT_APPROVED');
        if(physical?.lines.length&&!physical.complete&&stagesUpTo(printing,stage).includes('export'))
          throw new AppError(409,'Chưa xuất đủ hàng. Xác nhận phiếu xuất đúng kho/nguồn trước; đánh dấu tiến trình không ghi xuất kho.','STOCK_NOT_PACKED');
        await markProgress(tx, order.id, stagesUpTo(printing, stage).filter(s=>manager||['sample','production'].includes(s)), 'manual', viewer(c).id);
        // Manager đánh dấu đã giao hàng → phiếu đóng gói còn treo tự hoàn tất.
        if (stage === 'all' || stage === 'delivered') {
          await closeSlipsOfDeliveredOrders(tx, [order.id]);
        }
      }
    });
    if (body.done !== false && (stage === 'all' || stage === 'delivered')) await invoiceTasksChanged(c.env, { orderId: order.id }, viewer(c).id);
    return json({ progress: (await progressOf(c.env.db, [order.id])).get(order.id) });
  }, 'business');
}
