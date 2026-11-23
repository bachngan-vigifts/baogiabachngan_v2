import {and,eq,sql} from 'drizzle-orm';
import {can} from '../../staff/domain/permissions.ts';
import {AppError} from '../../../core/errors.ts';
import type {SessionState} from '../../staff/api/auth-routes.ts';
import {canReconcileSepay} from '../domain/sepay-page.ts';
import {salesOrders} from '../schema.ts';
import {webStoreOrders} from '../pos-schema.ts';
import type {CashDb} from './cash-store.ts';
import {orderScopeFor} from './routes.ts';
import {posWebOrderStoreScope} from './pos-access.ts';
export type SepayReconcileMember=SessionState['member'];
export function assertSepayReconcileAccess(m:SepayReconcileMember){
 if(!canReconcileSepay(m))throw new AppError(403,'Bạn chưa được cấp quyền đối soát khoản thu SePay.');
}
/** SePay has an opt-in cross-store grant; an unassigned employee must never mean unrestricted web access. */
export function sepayWebOrderScope(m:SepayReconcileMember){
 if(m.role==='manager'||can(m,'sepay.reconcile-all-stores'))return;
 return posWebOrderStoreScope(m)??sql`false`;
}
export function sepayWebOrderScopeInfo(m:SepayReconcileMember){
 const webOrderScope=m.role==='manager'||can(m,'sepay.reconcile-all-stores')?'all':posWebOrderStoreScope(m)?'store':'unassigned';
 return {webOrderScope,webOrderScopeMessage:webOrderScope==='unassigned'?'Chưa được phân cửa hàng / cần quyền đối soát toàn công ty để xem và đối soát đơn website. Đơn CRM vẫn theo phạm vi được phân quyền.':''};
}
/** Same document/store boundaries as CRM orders and POS web orders. Never trust a browser-selected ID. */
export async function assertSepayReconcileTarget(db:CashDb,m:SepayReconcileMember,id:string){
 assertSepayReconcileAccess(m);
 const rows=id.startsWith('web:')
  ? await db.select({id:webStoreOrders.id}).from(webStoreOrders).where(and(eq(webStoreOrders.id,id.slice(4)),sepayWebOrderScope(m))).limit(1)
  : await db.select({id:salesOrders.id}).from(salesOrders).where(and(eq(salesOrders.id,id),orderScopeFor(m))).limit(1);
 if(!rows.length)throw new AppError(404,'Không tìm thấy đơn trong phạm vi được phân quyền.');
}
