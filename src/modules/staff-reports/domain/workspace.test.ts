import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workspaceSchema,workspaceProblems,workspaceForecast,workspaceActions} from './workspace.ts';
const valid=()=>workspaceSchema.parse({workspaceVersion:2,overview:'Triển khai chăm sóc khách hàng',sectors:['bank','agri','aqua'].map(key=>({key,actions:'Gọi khách và gửi mẫu',result:'potential'})),priority:'Chốt các báo giá đã gửi',planTasks:[0,1,2].map(n=>({id:'plan-row-'+n,title:'Việc trọng tâm '+n,customer:'Khách thử',date:'2026-12-10'})),selfScore:4});
test('six required sections are enforced, including prior promises, current owned quotes and overdue debt',()=>{
 const v=valid(),f={quotes:[{id:'q1',quoteNo:'BG-1',total:123456}],receivables:[{orderId:'o1',orderNo:'DH-1',balance:100,overdue:100}],commitments:[{id:'prior',title:'Việc tuần trước'}]};
 assert.equal(workspaceProblems(v,f).length,3);
 v.commitments.prior={status:'partial',note:'Còn chờ khách duyệt'};v.quoteFollowups.q1={feedback:'Khách đã đồng ý mẫu',probability:.8,signThisWeek:true};v.debtPromises.o1={date:'2026-12-10',amount:100,method:'transfer',contact:'Kế toán'};
 assert.deepEqual(workspaceProblems(v,f),[]);v.commitments.prior.note='';assert.match(workspaceProblems(v,f).join(' '),/tuần trước/);
 v.commitments.prior.note='Còn chờ khách duyệt';v.debtPromises.o1.amount=101;assert.match(workspaceProblems(v,f).join(' '),/vượt dư nợ/);
});
test('forecast uses server quote totals and never treats probability or forecasts as actual orders',()=>{
 const v=valid();v.quoteFollowups.q1={feedback:'Đang thương lượng',probability:.8,signThisWeek:true};v.quoteFollowups.q2={feedback:'Chờ duyệt ngân sách',probability:.2,signThisWeek:false};
 assert.deepEqual(workspaceForecast(v,[{id:'q1',quoteNo:'1',total:100},{id:'q2',quoteNo:'2',total:300},{id:'q1',quoteNo:'closed',total:999,won:true}]),{selected:100,weighted:140,count:1});
 v.quoteFollowups.foreign={feedback:'Khóa không thuộc nhân viên',probability:1,signThisWeek:true};assert.match(workspaceProblems(v,{quotes:[]}).join(' '),/không thuộc nhân viên/);
});
test('event reminders use real calendar dates 45 days earlier; action keys are stable across retries',()=>{
 const v=valid();v.events=[{id:'event-row-1',customer:'Khách thử',occasion:'Kỷ niệm thành lập',date:'2028-03-15',type:'anniversary',note:'Hẹn tặng quà'}];v.opportunities=[{id:'opportunity-row-1',customer:'Khách thử',sector:'bank',amount:100,need:'100 ca sứ',occasion:'Hội nghị',dueDate:'2026-12-10'}];
 const actions=workspaceActions('report-1',v,{quotes:[]});assert.equal(actions.find(a=>a.kind==='event')!.dueDate,'2028-01-30');assert.deepEqual(actions,workspaceActions('report-1',v,{quotes:[]}));
 assert(!workspaceSchema.safeParse({...v,events:[{...v.events[0],date:'2026-02-30'}]}).success);
 assert(!workspaceSchema.safeParse({...v,selfScore:6}).success);assert(!workspaceSchema.safeParse({...v,opportunities:Array(21).fill(v.opportunities[0])}).success);
});
