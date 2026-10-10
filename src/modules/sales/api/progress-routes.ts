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
    if (viewer(c).role !== 'manager') throw new AppError(403, 'Chỉ Manager được đánh dấu nhanh tiến trình.');
    const body = await readJson(c.req, 1_024), stage = body.stage as ProgressStage | 'all';
    if (stage !== 'all' && !(PROGRESS_STAGES as readonly string[]).includes(stage)) throw new AppError(400, 'Bước tiến trình không hợp lệ.');
    const [order] = await c.env.db.select({ id: salesOrders.id, status: salesOrders.status }).from(salesOrders)
      .where(and(eq(salesOrders.id, c.params.id!), orderScopeFor(viewer(c)))).limit(1);
    if (!order) throw new AppError(404, 'Không tìm thấy đơn hàng / HĐKT.');
    if (order.status === 'cancelled') throw new AppError(409, 'Đơn / HĐKT đã huỷ.');
    const printing = (await printingOrders(c.env.db, [order.id])).has(order.id), list = stagesFor(printing);
    if (stage !== 'all' && !list.includes(stage)) throw new AppError(400, 'Đơn này không có bước đó (đơn không in thì không có In mẫu / Sản xuất).');
    if (body.done === false) {
      if (stage === 'all') throw new AppError(400, 'Chọn bước cần bỏ đánh dấu.');
      await unmarkProgress(c.env.db, order.id, list.slice(list.indexOf(stage)));
    } else {
      await markProgress(c.env.db, order.id, stagesUpTo(printing, stage), 'manual', viewer(c).id);
      // Manager đánh dấu đã giao hàng → phiếu đóng gói còn treo tự hoàn tất.
      if (stage === 'all' || stage === 'delivered') await closeSlipsOfDeliveredOrders(c.env.db, [order.id]);
    }
    return json({ progress: (await progressOf(c.env.db, [order.id])).get(order.id) });
  }, 'business');
}
