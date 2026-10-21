import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { notifyMany } from '../../notifications/api/routes.ts';

type PosCheckoutResult = {
  id: string;
  orderNo: string;
  customer?: string;
  total?: number;
  replayed?: boolean;
};

type PosActor = {
  id: string;
  name: string;
};

/**
 * Báo Manager khi Bán hàng nhanh vừa tạo đơn thật sự.
 * Checkout có idempotency nên tuyệt đối không báo lại khi request được replay.
 * Lỗi Web Push không được làm hỏng bill đã commit tại quầy.
 */
export async function notifyPosOrderCreated(env: StaffEnv, actor: PosActor, result: PosCheckoutResult) {
  if (result.replayed) return;
  await notifyMany(env, 'managers', {
    eventType: 'pos_order_created',
    title: 'Đơn Bán hàng nhanh mới',
    body: `${actor.name}: ${result.orderNo} – ${result.customer || 'Khách lẻ'} · ${new Intl.NumberFormat('vi-VN').format(Number(result.total) || 0)} đ`,
    url: `/index.html#/orders/${result.id}`,
    actorId: actor.id,
    data: { orderId: result.id, channel: 'pos' },
  }).catch((error) => console.error('POS_ORDER_WEB_PUSH_FAILED', result.id, error instanceof Error ? error.message : error));
}
