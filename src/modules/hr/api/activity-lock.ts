import {and,eq} from 'drizzle-orm';
import type {AnyDb} from '../../../core/db/client.ts';
import {hrPayslips} from '../schema.ts';
import {AppError} from '../../../core/errors.ts';
/** App-injected into care. Freeze only months actually settled using automatic sales KPI. */
export async function assertActivityKpiOpen(db:AnyDb,ownerId:string,month:string){
 const [s]=await db.select({data:hrPayslips.data}).from(hrPayslips).where(and(eq(hrPayslips.memberId,ownerId),eq(hrPayslips.month,month))).limit(1);if(!s)return;
 let snapshot:any;try{snapshot=JSON.parse(s.data);}catch{throw new AppError(409,'Bản chụp lương cần Manager đối soát trước khi sửa nguồn giao dịch.','KPI_MONTH_CLOSED');}
 if(snapshot.salesCrm?.apply&&snapshot.kpi)throw new AppError(409,'Giao dịch thuộc tháng đã chốt KPI tự động. Manager cần đối soát hoặc mở lại phiếu chưa trả trước khi sửa.','KPI_MONTH_CLOSED');
}
