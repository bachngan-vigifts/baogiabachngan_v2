import { isCalendarDate, vietnamToday } from './anniversary.ts';
import { AppError } from '../../../core/errors.ts';
/** Customer directory and POS share field limits and payment-term parsing. */
export function customerInput(body:Record<string,unknown>,requirePhone=false,options:{requireProfile?:boolean;allowBlankName?:boolean}={}) {
  const text=(key:string,max=500)=>{const v=body[key]??'';if(typeof v!=='string'||v.length>max)throw new AppError(400,'Thông tin khách hàng không hợp lệ.');return v.trim();};
  const name=text('name');if(!name&&!options.allowBlankName)throw new AppError(400,'Vui lòng nhập tên khách hàng.');
  const fields={name,contact:text('contact'),phone:text('phone',40),email:text('email'),address:text('address',2000),taxCode:text('taxCode'),customerCode:text('customerCode')};
  if(options.requireProfile)for(const [key,label] of [['contact','người liên hệ'],['phone','số điện thoại'],['taxCode','mã số thuế'],['address','địa chỉ']] as const)
    if(!fields[key])throw new AppError(400,`Vui lòng nhập ${label} khách hàng.`,'CUSTOMER_PROFILE_REQUIRED');
  if(requirePhone&&!fields.phone)throw new AppError(400,'Vui lòng nhập số điện thoại khách.');
  if(fields.email&&!/^\S+@\S+\.\S+$/.test(fields.email))throw new AppError(400,'Email chưa đúng định dạng.');
  const num=(key:string,max:number,label:string)=>{const v=body[key];if(v===undefined)return undefined;if(v===null||v==='')return null;
    const n=Number(String(v).replace(/\./g,'').replace(',','.'));if(!Number.isFinite(n)||n<0||n>max)throw new AppError(400,`${label} không hợp lệ.`);return n;};
  const depositRate=num('depositRate',100,'Tỷ lệ đặt cọc'),creditLimit=num('creditLimit',1e13,'Giới hạn công nợ');
  const paymentTerm=body.paymentTerm===undefined?undefined:(text('paymentTerm')||null);
  if(paymentTerm&&/^\d+(?:\s*ngày)?$/i.test(paymentTerm)&&parseInt(paymentTerm,10)>3650)throw new AppError(400,'Hạn thanh toán tối đa 3650 ngày.');
  const establishedDate = body.establishedDate === undefined ? undefined : body.establishedDate === null || body.establishedDate === '' ? null : body.establishedDate;
  if (establishedDate !== undefined && establishedDate !== null && (!isCalendarDate(establishedDate) || establishedDate > vietnamToday())) throw new AppError(400, 'Ngày thành lập phải là ngày hợp lệ, không ở tương lai.');
  const customerType=body.customerType===undefined?undefined:(text('customerType')||null);
  const paymentDays=num('paymentDays',3650,'Số ngày công nợ');
  if(paymentDays!==undefined&&paymentDays!==null&&!Number.isInteger(paymentDays))throw new AppError(400,'Số ngày công nợ phải là số nguyên từ 0 đến 3650.');
  const terms=Object.fromEntries(Object.entries({depositRate,paymentTerm,creditLimit,establishedDate,customerType,paymentDays}).filter(([,v])=>v!==undefined));
  return {fields,terms};
}
