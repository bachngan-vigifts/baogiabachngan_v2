import {and,eq,inArray} from 'drizzle-orm';
import type {WarehouseBonusOf,AssertWarehousePayrollOpen,WarehouseBonus} from '../core/contracts/warehouse-bonus.ts';
import {warehouseWorkMonths} from '../modules/warehouse-workspace/schema.ts';
import {hrPayslips} from '../modules/hr/schema.ts';
import {AppError} from '../core/errors.ts';
export const assertWarehousePayrollOpen:AssertWarehousePayrollOpen=async(db,id,month)=>{
 const [slip]=await db.select({id:hrPayslips.memberId}).from(hrPayslips).where(and(eq(hrPayslips.memberId,id),eq(hrPayslips.month,month))).limit(1);
 if(slip)throw new AppError(409,'Phiếu lương tháng này đã chốt. Mở lại phiếu chưa thanh toán trước khi duyệt thưởng Kho.');
};
export const warehouseBonusOf:WarehouseBonusOf=async(db,month,ids)=>{
 const result=new Map<string,WarehouseBonus>();if(!ids.length)return result;
 const rows=await db.select().from(warehouseWorkMonths).where(and(eq(warehouseWorkMonths.month,month),inArray(warehouseWorkMonths.memberId,[...ids])));
 for(const row of rows){let snap:any;try{snap=JSON.parse(row.snapshot);}catch{throw new AppError(503,'Bản chốt thưởng Kho không đọc được. Cần đối soát trước khi tính lương.');}
  const b=snap.payrollBonus;if(!b)continue;
  if(b.version!==1||!Number.isSafeInteger(b.amount)||b.amount<0||!Number.isFinite(b.score)||b.score<0||b.score>100||!Number.isSafeInteger(b.budget)||b.budget<0||!Number.isFinite(b.factor)||b.factor<0||b.factor>1||b.amount!==Math.round(b.budget*b.factor))throw new AppError(503,'Bản chốt thưởng Kho không hợp lệ. Cần đối soát trước khi tính lương.');
  result.set(row.memberId,{...b,month,approvedAt:row.approvedAt});
 }return result;
};
