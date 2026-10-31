/** KPI counts actual contact, not follow-up completion or number of chat messages. */
export type ActivityKpiRow={id:string;ownerId:string;customerId:string;type:string;occurredAt:string;createdAt:string;completion:string|null;purpose:string|null;quoteId:string|null;quoteRevision:number|null;kpiExtraApproved:boolean;kpiReviewReason:string;content:string;contactName:string};
export const activityDay=(iso:string)=>new Date(Date.parse(iso)+7*3600_000).toISOString().slice(0,10);
export function activityKpi(rows:readonly ActivityKpiRow[]){
 const seen=new Set<string>(),quotes=new Set<string>(),out=new Map<string,{counted:boolean;reason:string}>();
 // Keep the winner stable when the list is sorted or paged differently.
 for(const a of [...rows].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))){
  let reason='';
  if(a.completion!=='completed')reason=a.completion==='not_completed'?'Chưa thực hiện / chưa kết nối':'Lịch sử chưa xác nhận kết quả';
  else if(!a.content.trim()||!a.contactName.trim())reason='Thiếu nội dung hoặc người liên hệ';
  else if(a.type==='quote'&&(!a.quoteId||a.quoteRevision===null))reason='Chưa gắn bản báo giá đã gửi';
  const key=JSON.stringify([a.ownerId,a.customerId,a.type,activityDay(a.occurredAt)]),quote=JSON.stringify([a.quoteId,a.quoteRevision]);
  if(!reason&&a.type==='quote'&&quotes.has(quote))reason='Bản báo giá này đã được tính';
  if(!reason&&seen.has(key)&&!a.kpiExtraApproved)reason='Trùng khách / hình thức trong ngày; cần Manager xét bổ sung';
  if(!reason){seen.add(key);if(a.type==='quote')quotes.add(quote);}
  out.set(a.id,{counted:!reason,reason:reason|| (a.kpiExtraApproved?'Manager duyệt bổ sung: '+a.kpiReviewReason:'Hoạt động hợp lệ')});
 }
 return out;
}
