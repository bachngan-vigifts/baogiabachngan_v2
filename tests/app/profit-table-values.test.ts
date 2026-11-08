import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
import {profitLayoutFixture} from '../helpers/profit-layout-fixture.ts';
import {emptyRow} from '../../src/modules/profit/domain/profit.ts';
const {initProfit,profitHasCoverage}=await import(new URL('../../trial-ui/profit.js',import.meta.url).href);

test('phân biệt chưa tính được với giá vốn/lợi nhuận thực bằng 0',()=>{
 assert.equal(profitHasCoverage({...emptyRow('a','a'),revenue:100,unconfirmedOrders:1}),false);
 assert.equal(profitHasCoverage({...emptyRow('a','a'),revenue:100,missingOrders:1}),false);
 assert.equal(profitHasCoverage({...emptyRow('a','a'),revenue:100,coveredRevenue:100,cost:0,gross:100}),true);
 assert.equal(profitHasCoverage({...emptyRow('a','a'),revenue:100,coveredRevenue:100,cost:100,gross:0}),true);
 assert.equal(profitHasCoverage(emptyRow('a','a')),true);
});

test('bảng tổng hợp khôi phục đúng các số giá vốn/chi phí API trả về, không thay dữ liệu',async()=>{
 const data:any=profitLayoutFixture(),r={...emptyRow('emp','Nhân viên minh hoạ'),orders:1,revenue:1000000,coveredRevenue:1000000,cost:600000,direct:100000,gross:300000,net:300000,margin:.3,netMargin:.3,revenueBy:{confirmed:0,estimate:1000000,backfill:0,missing:0}};
 data.owners=[r];const before=structuredClone(data),root:any={innerHTML:'',setAttribute(){},removeAttribute(){},querySelector:()=>({addEventListener(){}}),querySelectorAll:()=>[]};
 await initProfit({root,api:async()=>data,toast(){},esc:String,money:String}).show();
 assert.match(root.innerHTML,/data-label="Giá vốn hàng bán"[^>]*>600\.000<\/td>/);
 assert.match(root.innerHTML,/data-label="CP trực tiếp"[^>]*>100\.000<\/td>/);
 assert.match(root.innerHTML,/data-label="LN gộp"[^>]*><b[^>]*>300\.000<\/b>/);
 assert.match(root.innerHTML,/data-label="Độ tin cậy"/);assert.deepEqual(data,before);
});

test('nhóm chưa có doanh thu đủ giá vốn hiển thị gạch ngang, không đưa số 0 lên biểu đồ',async()=>{
 const data:any=profitLayoutFixture(),r={...data.summary,key:'emp',label:'Nhân viên minh hoạ'};data.owners=[r];data.series=[r];
 const nodes=new Map<string,any>(),tabs=[{dataset:{tab:'series'},onclick:null as any}],root:any={innerHTML:'',setAttribute(){},removeAttribute(){},querySelector:(key:string)=>{if(!nodes.has(key))nodes.set(key,{addEventListener(){}});return nodes.get(key);},querySelectorAll:(key:string)=>key==='[data-tab]'?tabs:[]};
 await initProfit({root,api:async()=>data,toast(){},esc:String,money:String}).show();
 assert.match(root.innerHTML,/data-label="Giá vốn hàng bán"[^>]*><span[^>]*>—<\/span>/);
 tabs[0]!.onclick();assert.match(root.innerHTML,/Chưa đủ giá vốn theo bộ lọc/);assert.doesNotMatch(root.innerHTML,/class="pf-chart"/);
});
