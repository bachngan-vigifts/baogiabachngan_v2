/** Operational facts confirmed by the submitter; never contains purchase costs or margin. */
export const SUBMISSION_PAYMENT_METHODS={transfer:'Chuyển khoản',cash:'Tiền mặt',cod:'Thanh toán khi nhận hàng (COD)',other:'Khác'} as const;
export const SUBMISSION_PRINT_MODES={sample:'Làm mẫu để khách duyệt trước',bulk:'Đã được phép sản xuất hàng loạt'} as const;
export interface SubmissionReview {
 deliveryDate:string;deliveryAddress:string;receiverName:string;receiverPhone:string;
 shippingPayer:'sender'|'receiver';paymentMethod:keyof typeof SUBMISSION_PAYMENT_METHODS;paymentOther:string;
 printMode:''|'sample'|'bulk';printInstructions:string;sampleDate:string;bulkConfirmed:boolean;
 confirmations:{products:boolean;delivery:boolean;payment:boolean;printing:boolean};
}
const obj=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown)=>typeof v==='string'?v.trim():'';
const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const fold=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase();
export function submissionReviewProblem(input:unknown,printing:boolean):string {
 if(!obj(input))return 'Điền và xác nhận thông tin trước khi gửi duyệt.';
 if(['deliveryAddress','receiverName','receiverPhone','paymentOther','printInstructions'].some(k=>typeof input[k]==='string'&&/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input[k])))return 'Thông tin có ký tự điều khiển không hợp lệ.';
 if(!date(input.deliveryDate))return 'Chọn ngày giao hàng hợp lệ.';
 if(!text(input.deliveryAddress)||text(input.deliveryAddress).length>2000||/^(theo thoa thuan|chua (co|nhap)|cap nhat sau)[.!]?$/i.test(fold(text(input.deliveryAddress))))return 'Nhập địa chỉ giao hàng cụ thể (tối đa 2.000 ký tự).';
 if(!text(input.receiverName)||text(input.receiverName).length>500)return 'Nhập tên người nhận hàng (tối đa 500 ký tự).';
 if(typeof input.receiverPhone!=='string'||!/^[+\d\s().-]+$/.test(input.receiverPhone)||!/^\d{8,15}$/.test(input.receiverPhone.replace(/\D/g,'')))return 'Nhập số điện thoại người nhận từ 8–15 chữ số.';
 if(!['sender','receiver'].includes(input.shippingPayer))return 'Chọn rõ công ty hay khách hàng trả phí giao hàng.';
 if(typeof input.paymentMethod!=='string'||!Object.hasOwn(SUBMISSION_PAYMENT_METHODS,input.paymentMethod))return 'Chọn hình thức thanh toán.';
 if(input.paymentMethod==='other'&&(!text(input.paymentOther)||text(input.paymentOther).length>1000))return 'Ghi rõ hình thức thanh toán khác (tối đa 1.000 ký tự).';
 if(printing){
  if(!['sample','bulk'].includes(input.printMode))return 'Chọn làm mẫu duyệt hoặc sản xuất hàng loạt.';
  if(!text(input.printInstructions)||text(input.printInstructions).length>2000)return 'Nhập nội dung / yêu cầu in logo (tối đa 2.000 ký tự).';
  if(input.printMode==='sample'&&(!date(input.sampleDate)||input.sampleDate>input.deliveryDate))return 'Chọn ngày duyệt mẫu hợp lệ, không sau ngày giao hàng.';
  if(input.printMode==='bulk'&&input.bulkConfirmed!==true)return 'Xác nhận khách đã cho phép sản xuất hàng loạt.';
 }
 const checks=input.confirmations;
 if(!obj(checks)||checks.products!==true||checks.delivery!==true||checks.payment!==true||(printing&&checks.printing!==true))return 'Đánh dấu đủ các thông tin đã kiểm tra trước khi gửi duyệt.';
 return '';
}
export function normalizeSubmissionReview(input:SubmissionReview,printing:boolean):SubmissionReview {
 return {deliveryDate:input.deliveryDate,deliveryAddress:text(input.deliveryAddress),receiverName:text(input.receiverName),receiverPhone:text(input.receiverPhone),shippingPayer:input.shippingPayer,paymentMethod:input.paymentMethod,paymentOther:input.paymentMethod==='other'?text(input.paymentOther):'',printMode:printing?input.printMode:'',printInstructions:printing?text(input.printInstructions):'',sampleDate:printing&&input.printMode==='sample'?input.sampleDate:'',bulkConfirmed:printing&&input.printMode==='bulk'&&input.bulkConfirmed===true,confirmations:{products:true,delivery:true,payment:true,printing}};
}
export interface SubmissionRecord extends SubmissionReview {version:1;printing:boolean;quoteFingerprint:string;deliveryFingerprint:string;submittedBy:string;submittedAt:string}
export function readSubmissionRecord(value:unknown):SubmissionRecord|null {
 try{const r=typeof value==='string'?JSON.parse(value):value;return obj(r)&&r.version===1&&typeof r.printing==='boolean'&&typeof r.submittedBy==='string'&&typeof r.submittedAt==='string'&&typeof r.quoteFingerprint==='string'&&typeof r.deliveryFingerprint==='string'&&!submissionReviewProblem(r,r.printing===true)?r as SubmissionRecord:null;}catch{return null;}
}
export function submissionPaymentLabel(review:Pick<SubmissionReview,'paymentMethod'|'paymentOther'>){return review.paymentMethod==='other'?review.paymentOther:SUBMISSION_PAYMENT_METHODS[review.paymentMethod];}
/** Stable business facts: internal cost edits and regenerated row IDs do not invalidate a staff review. */
export function submissionQuoteBasis(doc:Record<string,any>){
 const basis={type:doc.type,deliveryDate:doc.deliveryDate||doc.delivery_date||'',customer:doc.customer,customerAddress:doc.customerAddress,notes:doc.notes||'',paymentTerms:doc.paymentTerms||null,rows:(doc.rows||[]).map((r:Record<string,any>)=>Object.fromEntries(['sku','name','unit','qty','price','discount','discountType','printFee','printDescription','taxRate','manualLine','manualDescription','designImageKey'].map(k=>[k,r[k]??null])))};
 // New Sale specifications are customer-visible facts. Retain legacy fingerprints when those fields are absent.
 if(doc.template==='sale'&&(doc.rows||[]).some((r:Record<string,any>)=>['materialDescription','brandDescription','volumeDescription'].some(k=>r[k]!==undefined))){
  return JSON.stringify({...basis,saleSpecifications:(doc.rows||[]).map((r:Record<string,any>)=>[r.materialDescription??null,r.brandDescription??r.brand??null,r.volumeDescription??null,r.packagingDescription??null,r.bundleContents??null])});
 }
 return JSON.stringify(basis);
}
