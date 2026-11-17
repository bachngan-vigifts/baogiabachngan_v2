import {z} from 'zod';
import {addDays,industryOf} from './weekly.ts';

export const SECTORS=['bank','credit','agri','aqua','public','existing','enterprise'] as const;
export const SECTOR_LABELS:Record<typeof SECTORS[number],string>={bank:'Ngân hàng',credit:'Quỹ tín dụng',agri:'Nông nghiệp',aqua:'Thuỷ sản',public:'Cơ quan nhà nước',existing:'Khách hàng cũ',enterprise:'DN lớn – năm chẵn'};
const line=z.string().trim().max(500).default(''),note=z.string().trim().max(2000).default('');
const date=z.string().refine(v=>v===''||/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v,'Ngày không hợp lệ').default('');
const amount=z.number().finite().min(0).max(1e12).default(0),integer=z.number().int().min(0).max(1e6).default(0);
const id=z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),sector=z.enum(SECTORS);
const keyed=<T extends z.ZodTypeAny>(value:T)=>z.record(z.string().min(1).max(100),value).refine(v=>Object.keys(v).length<=1000,'Tối đa 1.000 dòng').default({});
export const workspaceSchema=z.object({workspaceVersion:z.literal(2),overview:note,
 commitments:keyed(z.object({status:z.enum(['done','partial','missed']).nullable().default(null),note:line})),
 sectors:z.array(z.object({key:sector,actions:note,result:z.enum(['won','potential','none']).nullable().default(null)})).max(7).default([]),
 quoteFollowups:keyed(z.object({feedback:line,probability:z.union([z.literal(0),z.literal(.2),z.literal(.5),z.literal(.8),z.literal(1)]).nullable().default(null),signThisWeek:z.boolean().default(false)})),
 opportunities:z.array(z.object({id,customer:line,sector:sector.default('existing'),amount,need:line,occasion:line,dueDate:date})).max(20).default([]),
 events:z.array(z.object({id,customer:line,occasion:line,date,type:z.enum(['anniversary','congress','conference','tet','other']).default('other'),note:line})).max(20).default([]),
 debtPromises:keyed(z.object({date,amount,method:z.enum(['transfer','cash','installments']).default('transfer'),contact:line})),
 productionNotes:keyed(z.object({status:z.enum(['on_time','risk','rescheduled']).nullable().default(null),note:line})),
 planTargets:z.object({revenue:amount,contracts:integer,quotes:integer,contacts:integer}).default({}),priority:note,
 sectorPlans:z.array(z.object({key:sector,approach:note,customers:z.array(z.string().trim().min(1).max(160)).max(30).default([]),calls:integer,quotes:integer})).max(7).default([]),
 planTasks:z.array(z.object({id,title:line,customer:line,date})).max(30).default([]),
 supportTeams:z.array(z.enum(['manager','production','accounting','design'])).max(4).default([]),supportPriority:z.enum(['urgent','week','later']).default('week'),
 selfScore:z.number().int().min(1).max(5).nullable().default(null),best:line,lesson:note,
 highlights:note,nextWeekPlan:note,support:note,quoteNotes:keyed(line),
});
export type WorkspaceInputs=z.infer<typeof workspaceSchema>;
export interface WorkspaceFacts{
 quotes:readonly{id:string;quoteNo:string;total:number;won?:boolean}[];
 receivables?:readonly{orderId?:string;orderNo:string;overdue:number;balance:number}[];
 commitments?:readonly{id:string;title:string}[];
 deliveries?:readonly{id?:string}[];
}
export function workspaceProgress(v:WorkspaceInputs,f:WorkspaceFacts){
 const commitments=(f.commitments||[]).every(c=>!!v.commitments[c.id]?.status&&(v.commitments[c.id]!.status==='done'||v.commitments[c.id]!.note.length>=3));
 const sectors=v.overview.length>=3&&new Set(v.sectors.filter(s=>s.actions.length>=3&&s.result).map(s=>s.key)).size>=3;
 const quotes=f.quotes.filter(q=>!q.won).every(q=>(v.quoteFollowups[q.id]?.feedback.length??0)>=3&&v.quoteFollowups[q.id]?.probability!==null&&v.quoteFollowups[q.id]?.probability!==undefined);
 const debts=(f.receivables||[]).filter(d=>d.overdue>0).every(d=>!!v.debtPromises[d.orderId||d.orderNo]?.date);
 const plan=v.priority.length>=3&&v.planTasks.filter(t=>t.title.length>=3&&t.date).length>=3;
 return{commitments,sectors,quotes,debts,plan,self:v.selfScore!==null};
}
export function workspaceProblems(v:WorkspaceInputs,f:WorkspaceFacts){
 const labels={commitments:'Đánh giá đầy đủ việc đã hứa tuần trước (việc chưa xong cần lý do).',sectors:'Nhập tổng quan và triển khai ít nhất 3 khối khách hàng.',quotes:'Ghi phản hồi và khả năng chốt cho từng báo giá đang mở.',debts:'Khoản quá hạn cần ngày hẹn thu.',plan:'Nhập ưu tiên số 1 và ít nhất 3 việc có hạn cho tuần tới.',self:'Chọn điểm tự đánh giá.'};
 const issues=Object.entries(workspaceProgress(v,f)).filter(([,ok])=>!ok).map(([key])=>labels[key as keyof typeof labels]);
 for(const [key,rows]of [['opportunities',v.opportunities],['events',v.events],['planTasks',v.planTasks]] as const)if(new Set(rows.map(r=>r.id)).size!==rows.length)issues.push('Trùng mã dòng '+key+'.');
 if(new Set(v.sectors.map(s=>s.key)).size!==v.sectors.length||new Set(v.sectorPlans.map(s=>s.key)).size!==v.sectorPlans.length)issues.push('Khối khách hàng bị trùng.');
 for(const o of v.opportunities)if(o.customer.length<2||o.need.length<3||!o.dueDate)issues.push('Cơ hội cần tên khách, nhu cầu và ngày cần báo giá.');
 for(const e of v.events)if(e.customer.length<2||e.occasion.length<3||!e.date)issues.push('Dịp khách cần tên khách, tên dịp và ngày diễn ra.');
 for(const d of f.receivables||[]){const p=v.debtPromises[d.orderId||d.orderNo];if(p&&p.amount>d.balance)issues.push('Số tiền hẹn thu vượt dư nợ của '+d.orderNo+'.');}
 const quoteIds=new Set(f.quotes.filter(q=>!q.won).map(q=>q.id)),debtIds=new Set((f.receivables||[]).map(d=>d.orderId||d.orderNo)),commitmentIds=new Set((f.commitments||[]).map(c=>c.id)),productionIds=new Set((f.deliveries||[]).map(d=>d.id));
 if(Object.keys(v.quoteFollowups).some(k=>!quoteIds.has(k))||Object.keys(v.quoteNotes).some(k=>!quoteIds.has(k)))issues.push('Báo giá đã thay đổi hoặc không thuộc nhân viên; cập nhật số liệu CRM.');
 if(Object.keys(v.debtPromises).some(k=>!debtIds.has(k))||Object.keys(v.commitments).some(k=>!commitmentIds.has(k))||Object.keys(v.productionNotes).some(k=>!productionIds.has(k)))issues.push('Dữ liệu liên kết đã thay đổi hoặc không thuộc phạm vi báo cáo.');
 return [...new Set(issues)];
}
export function workspaceForecast(v:WorkspaceInputs,quotes:WorkspaceFacts['quotes']){
 return quotes.filter(q=>!q.won).reduce((out,q)=>{const p=v.quoteFollowups[q.id];if(p){out.weighted+=Math.round(q.total*(p.probability??0));if(p.signThisWeek){out.selected+=q.total;out.count++;}}return out;},{selected:0,weighted:0,count:0});
}
export interface ReportAction{key:string;kind:'opportunity'|'event'|'plan'|'debt';title:string;description:string;dueDate:string|null;entryId:string}
export function workspaceActions(reportId:string,v:WorkspaceInputs,f:WorkspaceFacts):ReportAction[]{
 const prefix='weekly-report:'+reportId+':',out:ReportAction[]=[];
 for(const o of v.opportunities)out.push({key:prefix+'opportunity:'+o.id,kind:'opportunity',entryId:o.id,title:'Theo dõi cơ hội từ báo cáo tuần',description:`Khách: ${o.customer}\nKhối: ${SECTOR_LABELS[o.sector]}\nNhu cầu: ${o.need}\nGiá trị dự kiến: ${o.amount.toLocaleString('vi-VN')} đ\nDịp: ${o.occasion||'Chưa xác định'}`,dueDate:o.dueDate||null});
 for(const e of v.events)out.push({key:prefix+'event:'+e.id,kind:'event',entryId:e.id,title:'Nhắc chuẩn bị dịp khách hàng trước 45 ngày',description:`Khách: ${e.customer}\nDịp: ${e.occasion}\nNgày diễn ra: ${e.date}\n${e.note}`,dueDate:e.date?addDays(e.date,-45):null});
 for(const p of v.planTasks)if(p.title.trim())out.push({key:prefix+'plan:'+p.id,kind:'plan',entryId:p.id,title:'Việc đã cam kết trong báo cáo tuần',description:`${p.title}\nKhách / giá trị: ${p.customer||'—'}`,dueDate:p.date||null});
 for(const d of f.receivables||[]){const p=v.debtPromises[d.orderId||d.orderNo];if(p?.date)out.push({key:prefix+'debt:'+(d.orderId||d.orderNo),kind:'debt',entryId:d.orderId||d.orderNo,title:'Hẹn thu công nợ theo báo cáo tuần',description:`Đơn: ${d.orderNo}\nHẹn thu: ${p.amount.toLocaleString('vi-VN')} đ\nLiên hệ: ${p.contact||'—'}\nHình thức: ${p.method}\nHẹn nội bộ; không thay hạn thanh toán hợp đồng.`,dueDate:p.date});}
 return out;
}

export function sectorOf(customerType:string|null,name:string){
 const fold=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase();
 for(const text of [customerType||'',name]){const s=fold(text);if(/quy tin dung|qtdnd/.test(s))return 'credit';if(/co quan nha nuoc|uy ban|dang uy|ubnd|hdnd/.test(s))return 'public';if(/doanh nghiep lon|nam chan/.test(s))return 'enterprise';if(/khach hang cu/.test(s))return 'existing';}
 return industryOf(customerType,name);
}
