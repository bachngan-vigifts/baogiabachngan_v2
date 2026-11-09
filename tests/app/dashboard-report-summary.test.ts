import {test} from 'node:test';
import assert from 'node:assert/strict';
const {reportScoreOverview}=await import(new URL('../../trial-ui/report-scores.js',import.meta.url).href);
const {dashboardScorePeople}=await import(new URL('../../trial-ui/dashboard.js',import.meta.url).href);
test('report summary keeps server points, excludes pre-rollout weeks and distinguishes submission from review',()=>{
 const w=(state:string,review:string|null=null)=>({state,review,period:'2026-11-02',deadline:'2026-11-09T03:00:00Z',score:0});
 const summary=reportScoreOverview({basis:{points:3.5,required:5,weeks:[w('exempt'),w('on_time','ok'),w('late','pending'),w('missing','excused'),w('not_due')],monthly:w('late','pending')}});
 assert.deepEqual(summary,{submitted:2,total:4,onTime:1,late:1,missing:0,notDue:1,excused:1,pending:2,monthly:'Chờ duyệt · Nộp trễ',points:'3,5 / 5 điểm'});
 assert.equal(reportScoreOverview({basis:null}),null,'unavailable historical snapshot is not a zero score');
 assert.equal(reportScoreOverview({basis:{points:0,required:4,weeks:[]}}).monthly,'Chưa áp dụng');
 assert.equal(reportScoreOverview({basis:{points:0,required:5,weeks:[w('missing')],monthly:w('missing','rejected')}}).missing,1);
});
test('employee picker merges only authorized current-month projections, retaining report-only Sale Admin and stable KPI order',()=>{
 const k={month:'2026-11',members:[{id:'sale',name:'Sale',total:0.2}]},r={month:'2026-11',members:[{id:'sale',name:'Sale'},{id:'admin',name:'Sale Admin'}]};
 assert.deepEqual(dashboardScorePeople(k,r,'2026-11'),[{id:'sale',name:'Sale'},{id:'admin',name:'Sale Admin'}]);
 assert.deepEqual(dashboardScorePeople(k,r,'2026-10'),[]);
 assert.deepEqual(dashboardScorePeople(null,{...r,members:[r.members[1]]},'2026-11'),[{id:'admin',name:'Sale Admin'}]);
});

test('report-only presentation is limited to the authenticated Sale Admin role, without enabling payroll KPI',async()=>{
 const {dashboardReportsOnly}=await import(new URL('../../trial-ui/dashboard.js',import.meta.url).href);
 assert.equal(dashboardReportsOnly({role:'employee',positionId:'sale-admin'}),true);
 for(const user of [null,{}, {role:'manager',positionId:'sale-admin'},{role:'employee',positionId:'sale'},{role:'customer',positionId:'sale-admin'}])assert.equal(dashboardReportsOnly(user),false);
});
