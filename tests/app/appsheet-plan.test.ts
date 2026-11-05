import { contractTest as test, assert } from '../TEST_TEMPLATE.ts';
import { planAppsheet, type AppsheetState } from '../../src/modules/customers/api/appsheet-plan.ts';
import { parseAppsheetInput } from '../../src/modules/customers/domain/appsheet-input.ts';
import { customers } from '../../src/modules/customers/schema.ts';
const stamp='2026-10-01T00:00:00.000Z';
const empty=():AppsheetState=>({customers:[],contacts:[],customerLinks:[],contactLinks:[]});
const customer=(i:number):typeof customers.$inferSelect=>({id:'existing-'+i,name:'Doanh nghiệp thử '+i,contact:'',phone:'',email:'',address:'',taxCode:'',customerCode:'',sourceVersion:0,syncedAt:'',createdAt:'',approvalStatus:'approved',isRetail:false,establishedDate:null,customerType:null,dataSource:null,search:'',createdBy:null,approvedBy:null,approvedAt:null,depositRate:null,paymentTerm:null,creditLimit:null});
const input=(rows:unknown[],contacts:unknown[]=[])=>parseAppsheetInput({format:'appsheet-customers-v1',appId:'fake-plan',customersTable:'KH',contactsTable:'LH',customers:rows,contacts});
const row=(id:string,over:Record<string,unknown>={})=>({rowId:id,updatedAt:stamp,fields:{name:'Khách mới '+id,approvalStatus:'approved',...over}});
test('AppSheet planner handles a 200-row batch against 8,200 customers without mutating state; preview hash ignores clock/actor',()=>{
  const state={...empty(),customers:Array.from({length:8200},(_,i)=>customer(i))},snapshot=JSON.stringify(state);
  const batch=input(Array.from({length:200},(_,i)=>row('new-'+i)));
  const start=performance.now(),plan=planAppsheet(batch,state,stamp,'mgr');
  assert.equal(plan.summary.create,200);assert.equal(plan.customerWrites.length,200);assert.equal(JSON.stringify(state),snapshot);
  const again=planAppsheet(batch,state,'2026-10-02T00:00:00.000Z','another-manager');assert.equal(plan.planHash,again.planHash);
  console.log('appsheet_planner_8200_customers_200_rows_ms',Math.round(performance.now()-start));
});
test('AppSheet indexes include earlier rows in the same batch, including customer codes and parent-scoped contacts',()=>{
  const batch=input([row('A',{customerCode:'CODE'}),row('B',{customerCode:' code '})],[
    {rowId:'L1',customerRowId:'A',updatedAt:stamp,fields:{name:'Người thử',phone:'0901234567'}},
    {rowId:'L2',customerRowId:'A',updatedAt:stamp,fields:{name:'Tên khác',phone:'+84901234567'}},
  ]);
  const p=planAppsheet(batch,empty(),stamp,'mgr');assert.deepEqual(p.reports.map(r=>r.action),['create','conflict','create','conflict']);
  assert.ok(p.reports[1]!.candidates![0]!.reasons.includes('customerCode'));
  assert.equal(p.customerWrites.length,1);assert.equal(p.contactWrites.length,1);
});
test('AppSheet status changes clear prior approval metadata, and unusual row keys do not inherit resolutions',()=>{
  const first=input([row('constructor')]);const p=planAppsheet(first,empty(),stamp,'mgr');assert.equal(p.reports[0]!.action,'create');
  assert.equal(p.customerWrites[0]!.approvedBy,'mgr');
  const next=input([{...row('constructor',{approvalStatus:'pending'}),updatedAt:'2026-10-02T00:00:00Z'}]);
  const result=planAppsheet(next,{...empty(),customers:p.customerWrites,customerLinks:p.customerLinkWrites},stamp,'mgr');
  assert.equal(result.customerWrites[0]!.approvalStatus,'pending');assert.equal(result.customerWrites[0]!.approvedBy,null);assert.equal(result.customerWrites[0]!.approvedAt,null);
});
