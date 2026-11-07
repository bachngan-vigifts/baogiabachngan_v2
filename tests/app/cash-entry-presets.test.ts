import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
import {setup} from '../helpers/pos-fixture.ts';
const {cashEntryKind,cashNamePresets}=await import(new URL('../../trial-ui/cash-entry-presets.js',import.meta.url).href);

test('danh sách chi thường dùng không lẫn nộp quỹ; tên chuyển quỹ/tạm ứng không trở thành chi vặt do khác dấu hoặc hoa thường',()=>{
 const names=cashNamePresets('out');assert.ok(names.includes('Văn phòng phẩm'));assert.ok(names.includes('Tiền điện, nước'));assert.ok(names.length>=8);
 for(const name of names)assert.notEqual(cashEntryKind(name,'out'),'cash_out');
 for(const name of ['Nộp quỹ',' NỘP  QUỸ ','nop quy','Nộp két','Chuyển quỹ','Nộp ngân hàng'])assert.equal(cashEntryKind(name,'out'),'cash_out');
 assert.equal(cashEntryKind('TẠM ỨNG LƯƠNG','out'),'advance');assert.equal(cashEntryKind('Phí nộp tiền ngân hàng','out'),'petty_expense','phí dịch vụ thực tế vẫn là chi phí');
 assert.equal(cashEntryKind('Văn phòng phẩm','out',true),'cash_out','nút Nộp quỹ quyết định loại phiếu, không dựa vào tên tự do');
 assert.equal(cashEntryKind('Bổ sung tiền két','in'),'cash_in');assert.throws(()=>cashEntryKind('Nộp quỹ','in',true));
});

test('nộp quỹ giảm tiền két đúng một lần nhưng không làm tăng chi phí hoạt động hay giảm lợi nhuận; ngưỡng duyệt giữ nguyên',async()=>{
 const f=await setup();await f.open();const day=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'});
 const profit=async()=>{const r=await f.call('/profit?'+new URLSearchParams({from:day,to:day,compare:'0'}),f.mgr);assert.equal(r.status,200);return r.data;};
 const expense=await f.call('/cash/entries',f.emp,'POST',{key:crypto.randomUUID(),kind:cashEntryKind('Văn phòng phẩm','out'),entryName:'Văn phòng phẩm',amount:100000,reason:'Mua giấy in'});assert.equal(expense.status,201);
 const before=await profit(),balance=(await f.call('/cash',f.emp)).data.balance;
 const body={key:crypto.randomUUID(),kind:cashEntryKind('Nộp quỹ','out',true),entryName:'Nộp quỹ',amount:200000,reason:'Nộp về quỹ công ty',direction:'in'};
 const saved=await f.call('/cash/entries',f.emp,'POST',body);assert.equal(saved.status,201);assert.equal(saved.data.status,'posted');
 const detail=await f.call('/cash/entries/'+saved.data.id,f.emp);assert.equal(detail.data.entry.kind,'cash_out');assert.equal(detail.data.entry.direction,'out');
 const replay=await f.call('/cash/entries',f.emp,'POST',body);assert.equal(replay.data.replayed,true);assert.equal((await f.call('/cash',f.emp)).data.balance,balance-200000);
 const after=await profit(),row=after.branchCosts.cash.find((r:any)=>r.cls==='transfer');assert.equal(row.cls,'transfer');assert.equal(row.counted,false);assert.equal(row.amount,200000);assert.equal(row.count,1);
 assert.equal(after.branchCosts.company.net,before.branchCosts.company.net);assert.equal(after.branchCosts.rows.reduce((n:number,r:any)=>n+r.petty,0),100000);
 const pending=await f.call('/cash/entries',f.emp,'POST',{...body,key:crypto.randomUUID(),amount:1500000});assert.equal(pending.status,201);assert.equal(pending.data.status,'pending');assert.equal((await f.call('/cash',f.emp)).data.balance,balance-200000);
});
