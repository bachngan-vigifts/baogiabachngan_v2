import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
import {profitDateFixture} from '../helpers/profit-date-fixture.ts';
import {profitLayoutFixture} from '../helpers/profit-layout-fixture.ts';
const {profitPeriod,initProfit}=await import(new URL('../../trial-ui/profit.js',import.meta.url).href);

test('kỳ Ngày/Tuần/Tháng/Năm chọn khoảng tính tổng thực tế; tuần bắt đầu thứ Hai, xử lý ranh giới năm/tháng',()=>{
 const ranges=['day','week','month','year'].map(g=>profitPeriod(g,'2026-11-07'));
 assert.deepEqual(ranges,[{from:'2026-11-07',to:'2026-11-07'},{from:'2026-11-02',to:'2026-11-07'},
 {from:'2026-11-01',to:'2026-11-07'},{from:'2026-01-01',to:'2026-11-07'}]);
 assert.deepEqual(profitPeriod('week','2027-01-01'),{from:'2026-12-28',to:'2027-01-01'});
 assert.deepEqual(profitPeriod('week','2026-11-02'),{from:'2026-11-02',to:'2026-11-02'});
 assert.deepEqual(profitPeriod('month','2024-02-29'),{from:'2024-02-01',to:'2024-02-29'});
});

test('API doanh thu/số đơn khớp khoảng ngày, tháng, năm và ranh giới; đổi grain không làm mất phạm vi',async()=>{
 const f=await profitDateFixture();
 for(const [from,to,m,count] of [['2026-11-07','2026-11-07',1,1],['2026-11-02','2026-11-07',3,2],['2026-11-01','2026-11-07',7,3],['2026-01-01','2026-11-07',31,5],['2026-10-01','2026-10-31',8,1],['2025-01-01','2025-12-31',32,1]] as const){
  for(const grain of ['day','month','year']){const r=await f.call('/profit?'+new URLSearchParams({from,to,grain,owner:'emp',branch:'crm',costs:'confirmed',compare:'0'}),f.mgr);assert.equal(r.status,200);assert.equal(r.data.summary.revenue,m*1e6);assert.equal(r.data.summary.orders,count);assert.equal(r.data.series.reduce((n:number,x:any)=>n+x.revenue,0),m*1e6);}
 }
});

test('đổi bộ lọc nhanh: chỉ kết quả mới nhất được hiển thị, khoảng chưa hợp lệ vẫn cho sửa và không gửi API',async()=>{
 const nodes=new Map<string,any>(),attrs=new Set<string>(),buttons=['day','week','month','year'].map(grain=>({dataset:{grain},onclick:null as any}));
 const node=(key:string)=>{if(!nodes.has(key))nodes.set(key,{hidden:true,disabled:false,textContent:'',classList:{toggle(){}},events:{} as any,addEventListener(type:string,fn:any){this.events[type]=fn;}});return nodes.get(key);};
 const root={innerHTML:'',setAttribute(key:string){attrs.add(key);},removeAttribute(key:string){attrs.delete(key);},querySelector:node,querySelectorAll:(key:string)=>key==='[data-grain]'?buttons:[]};
 const pending:{path:string,resolve:(data:any)=>void,reject:(e:Error)=>void}[]=[];
 const ui=initProfit({root,api:(path:string)=>new Promise((resolve,reject)=>pending.push({path,resolve,reject})),toast(){},esc:(s:any)=>String(s??''),money:(n:number)=>String(n)});
 const data=(millions:number)=>{const d=profitLayoutFixture();d.summary.revenue=millions*1e6;return d;};
 const tick=async()=>{await Promise.resolve();await Promise.resolve();};
 const first=ui.show();pending[0]!.resolve(data(1));await first;
 buttons[0]!.onclick();buttons[3]!.onclick();assert.equal(attrs.has('data-pf-stale'),true);assert.equal(node('#pf-csv').disabled,true);
 pending[2]!.resolve(data(2));await tick();pending[1]!.resolve(data(99));await tick();
 assert.match(root.innerHTML,/<b class="num">2 tr<\/b>/);assert.doesNotMatch(root.innerHTML,/<b class="num">99 tr<\/b>/);assert.equal(attrs.has('data-pf-stale'),false);
 buttons[0]!.onclick();pending[3]!.resolve(data(3));await tick();
 const count=pending.length;node('#pf-from').events.change({target:{value:'2099-01-01'}});assert.equal(pending.length,count);assert.equal(attrs.has('data-pf-stale'),true);assert.match(node('[data-pf-status]').textContent,/Ngày bắt đầu/);
 node('#pf-to').events.change({target:{value:'2099-01-02'}});assert.equal(pending.length,count+1);assert.match(pending.at(-1)!.path,/from=2099-01-01&to=2099-01-02/);pending.at(-1)!.resolve(data(4));await tick();assert.match(root.innerHTML,/<b class="num">4 tr<\/b>/);
 buttons[1]!.onclick();buttons[2]!.onclick();pending.at(-1)!.resolve(data(5));await tick();pending.at(-2)!.reject(Error('old error'));await tick();assert.doesNotMatch(root.innerHTML,/old error/);assert.match(root.innerHTML,/<b class="num">5 tr<\/b>/);
});
