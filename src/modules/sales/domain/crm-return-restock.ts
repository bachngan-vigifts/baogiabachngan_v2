import {AppError} from '../../../core/errors.ts';
/** Server-recorded quantity excluded from saleable stock; financial return quantity is unchanged. */
export function restockPortion(line:{requestedQty:number;disposition:string}, damaged=0):number {
 if(!Number.isFinite(damaged)||damaged<0||damaged>line.requestedQty+1e-9)throw new AppError(409,'Phần hàng hỏng trên phiếu không hợp lệ; cần đối soát trước khi nhập kho.','RETURN_STOCK_SPLIT_INVALID');
 return line.disposition==='restock'?Math.max(0,Math.round((line.requestedQty-damaged)*1000)/1000):0;
}
