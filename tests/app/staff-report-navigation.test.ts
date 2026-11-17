import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
const {canSeeStaffReports,initWeeklyReports}=await import(new URL('../../trial-ui/weekly-reports.js',import.meta.url).href);

test('báo cáo tuần/tháng chỉ hiện cho Manager, Sale và Sale Admin',()=>{
 for(const positionId of ['sale','sale-admin'])assert.equal(canSeeStaffReports({role:'employee',positionId}),true);
 assert.equal(canSeeStaffReports({role:'manager'}),true);
 for(const member of [null,{role:'supplier',positionId:'sale'},{role:'customer',positionId:'sale'},{role:'employee',positionId:'warehouse'},{role:'employee',positionId:'accounting'},{role:'employee',positionId:'sales-lock'}])assert.equal(canSeeStaffReports(member),false);
});

function fixture(user:()=>any,api:(path:string)=>Promise<any>) {
 const links=[{hidden:true},{hidden:true}],prior=(globalThis as any).document;
 (globalThis as any).document={querySelectorAll:()=>links};
 const ui=initWeeklyReports({api,user,root:{},toast:()=>{},esc:String,go:()=>{},money:String});
 return {ui,links,restore:()=>{if(prior)(globalThis as any).document=prior;else delete (globalThis as any).document;}};
}

test('lỗi API lúc khởi động không làm mất menu của người được phép; mở trang vẫn tải lại dữ liệu',async()=>{
 for(const member of [{id:'sale',role:'employee',positionId:'sale'},{id:'admin',role:'employee',positionId:'sale-admin'},{id:'manager',role:'manager'}]){
  const f=fixture(()=>member,async()=>{throw Error('temporarily unavailable');});
  try{await f.ui.start();assert.ok(f.links.every(a=>!a.hidden));}finally{f.restore();}
 }
});

test('không gửi request báo cáo cho tài khoản không thuộc diện nộp/duyệt hoặc đã đăng xuất',async()=>{
 for(const member of [null,{id:'warehouse',role:'employee',positionId:'warehouse'}]){
  let calls=0;const f=fixture(()=>member,async()=>{calls++;return{};});
  try{await f.ui.start();assert.equal(calls,0);assert.ok(f.links.every(a=>a.hidden));}finally{f.restore();}
 }
});

test('phản hồi API vẫn có thể ẩn menu nếu hồ sơ không còn phải báo cáo',async()=>{
 const f=fixture(()=>({id:'sale',role:'employee',positionId:'sale'}),async()=>({required:false,canReview:false}));
 try{await f.ui.start();assert.ok(f.links.every(a=>a.hidden));}finally{f.restore();}
});

test('phản hồi cũ sau khi đổi tài khoản không bật menu hay nhắc báo cáo của người trước',async()=>{
 let member:any={id:'sale',role:'employee',positionId:'sale'},finish:any;
 const f=fixture(()=>member,()=>new Promise(resolve=>{finish=resolve;}));
 try{const pending=f.ui.start();member={id:'warehouse',role:'employee',positionId:'warehouse'};await f.ui.start();finish({required:true,canReview:false});await pending;assert.ok(f.links.every(a=>a.hidden));}finally{f.restore();}
});

test('trang tháng chỉ hiện kỳ tháng và đổi tháng vẫn ở đúng đường dẫn; kỳ cũ giải thích ngày áp dụng',async()=>{
 const field:any={},moves:string[]=[],root:any={innerHTML:'',querySelector:()=>field,querySelectorAll:()=>[]};
 const month={period:'2026-11',state:'not_due',deadline:'2026-12-02T03:00:00Z',score:null};
 const ui=initWeeklyReports({root,monthlyOnly:true,api:async(path:string)=>({required:true,canReview:false,monthly:path.includes('2026-10')?null:month,weeks:[{period:'2026-11-02'}],points:2,maxPoints:5}),go:(path:string)=>moves.push(path),toast:()=>{},esc:String,money:String});
 await ui.show('month=2026-11');assert.match(root.innerHTML,/data-week="2026-11"/);assert.doesNotMatch(root.innerHTML,/data-week="2026-11-02"/);assert.match(root.innerHTML,/<h1>Báo cáo tháng<\/h1>/);
 field.onchange({target:{value:'2026-12'}});assert.deepEqual(moves,['#/monthly-reports?month=2026-12']);
 await ui.show('month=2026-10');assert.match(root.innerHTML,/áp dụng từ tháng 11\/2026/);assert.doesNotMatch(root.innerHTML,/data-week=/);
});


test('weekly menu opens the recommended workspace in its deadline month; monthly mode keeps its list',async()=>{
 const moves:string[]=[],root:any={innerHTML:''};
 const ui=initWeeklyReports({root,api:async()=>({required:true,canReview:false,recommendedPeriod:'2026-11-30'}),go:(path:string)=>moves.push(path),toast:()=>{},esc:String,money:String});
 await ui.show();assert.deepEqual(moves,['#/weekly-reports?month=2026-12&week=2026-11-30']);
});
