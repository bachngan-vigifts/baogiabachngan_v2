import { AppError } from '../../../core/errors.ts';
const labels: Record<string,string> = {ghn:'GHN',anh_chinh:'Xe anh Chinh',chanh_xe:'Chành xe',nhat_tin:'Nhất Tín',other:'Đơn vị khác'};
export function posDeliveryMethod(input: Record<string,unknown>) {
  const method=input.deliveryMethod??'ghn';
  if(typeof method!=='string'||!Object.hasOwn(labels,method))throw new AppError(400,'Chọn hình thức giao hợp lệ.');
  const text=(key:string,max:number)=>{const value=input[key]??'';if(typeof value!=='string'||value.length>max)throw new AppError(400,'Thông tin đơn vị giao không hợp lệ.');return value.trim();};
  const name=text('carrierName',200),phone=text('carrierPhone',100),trackingCode=text('trackingCode',100);
  if(method!=='ghn'&&(input.ghnOrderCode||input.ghnDistrictId||input.ghnWardCode))throw new AppError(400,'Đơn giao thủ công không dùng thông tin vận đơn GHN.');
  if(['chanh_xe','other'].includes(method)&&!name)throw new AppError(400,'Nhập tên nhà xe / đơn vị giao.');
  return {method,name:method==='ghn'?'GHN':name||labels[method]!,phone,trackingCode};
}
export function manualPosDelivery(snapshot: string|null|undefined) {
  try {const method=JSON.parse(snapshot||'{}').deliveryMethod?.method;return !!method&&method!=='ghn';}catch{return false;}
}
