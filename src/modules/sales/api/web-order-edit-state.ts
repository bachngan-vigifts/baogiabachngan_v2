import {sha256Hex} from '../../staff/domain/session.ts';
import {webStoreOrders as web} from '../pos-schema.ts';
import {sql} from 'drizzle-orm';
import {webOrderBucket} from '../domain/web-order-outcome.ts';
import {readWebEdit} from '../domain/web-order-edit.ts';
type Row=typeof web.$inferSelect;
/** List views need flags, never the potentially large original/source/cart audit snapshots. */
export const webEditFlags=sql<string>`jsonb_build_object('revision',${web.crmEditSnapshot}::jsonb->'revision','sourceConflict',${web.crmEditSnapshot}::jsonb->'sourceConflict','ghnCartReviewRequired',${web.crmEditSnapshot}::jsonb->'ghnCartReviewRequired')::text`;
export const webSourceHash=(o:Row)=>sha256Hex(JSON.stringify([o.lines,o.total,o.financialSnapshot,o.crmEditSnapshot,o.customerName,o.phone,o.address]));
export const webEditBlocked=(o:Row)=>o.ghnOrderCode||o.ghnStatus.trim()?'Đơn đã có vận đơn/trạng thái GHN; không sửa sản phẩm hoặc giá.':readWebEdit(o.crmEditSnapshot).confirmationStartedAt?'Đang tạo / đối soát GHN; không sửa hàng cho đến khi có kết quả.':
 ['cancelled','completed'].includes(webOrderBucket(o.status,o.ghnStatus))||['issued','returned','legacy'].includes(o.stockStatus)?'Đơn đã kết thúc hoặc đã có lịch sử xuất kho; không sửa trực tiếp.':'';
