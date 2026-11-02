import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
class Node {
  children:Node[]=[];parent:Node|null=null;attrs:Record<string,string>={};events:Record<string,Function>={};style={};dataset:Record<string,string>={};
  type='';value:any='';className='';own='';hidden=false;disabled=false;tag:string;
  classList={toggle:()=>{}};
  constructor(tag='div'){this.tag=tag;}
  get tagName(){return this.tag.toUpperCase();}
  set textContent(v:string){this.own=String(v);this.children=[];}get textContent():string{return this.own+this.children.map(c=>c.textContent).join('');}
  append(...nodes:Node[]){for(const n of nodes){n.parent=this;this.children.push(n);}}
  replaceChildren(...nodes:Node[]){this.children=[];this.own='';this.append(...nodes);}
  setAttribute(k:string,v:string){this.attrs[k]=v;}removeAttribute(k:string){delete this.attrs[k];}
  addEventListener(k:string,fn:Function){this.events[k]=fn;}
  querySelectorAll(selector:string):Node[]{return this.children.flatMap(c=>[...(selector==='button'?c.tag==='button':selector==='.chip'?c.className.includes('chip'):selector==='input[type=text]'?c.tag==='input'&&c.type==='text':selector==='input[type=number]'?c.tag==='input'&&c.type==='number':false)?[c]:[],...c.querySelectorAll(selector)]);}
  querySelector(selector:string){return this.querySelectorAll(selector)[0]!;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
  focus(){}
  async click(){if(!this.disabled)await this.events.click?.();}
}
const all=(n:Node):Node[]=>[n,...n.children.flatMap(all)];
async function setup(status='cancelled',missing=false,lookup?: (path:string)=>Promise<any>, hooks: {write?:()=>Promise<any>;read?:()=>Promise<any>;confirm?:(text:string,options:any)=>Promise<boolean>;print?:(t:any)=>void}={}){
 const root=new Node(),posts:any[]=[],nav:string[]=[],messages:string[]=[],reads:string[]=[];
 const source={id:'old',transferNo:'PCK-OLD',status,statusLabel:'Đã huỷ',fromWarehouseId:'a',toWarehouseId:'b',reason:'Bổ sung kho',lines:[{sku:'X',name:'Ly',qty:12,unit:'cái',fromStock:20,toStock:0},{sku:'Y',name:'Bát',qty:3,unit:'cái',fromStock:30,toStock:0}],revision:1,actions:status==='pending'?{edit:true,approve:true,reject:true,cancel:true}:status==='approved'?{ship:true,cancel:true}:status==='shipped'?{receive:true}:{}};
 const context:any={URLSearchParams,setTimeout,clearTimeout,crypto:{randomUUID:()=> '5a828b25-34cf-4145-bbab-43a53a5c465b'},document:{createElement:(tag:string)=>new Node(tag),createTextNode:(s:string)=>{const n=new Node('text');n.textContent=s;return n;}},location:{hash:'#/transfers/old'},history:{replaceState(){}}};
 const code=readFileSync(new URL('../../trial-ui/stock-ops.js',import.meta.url),'utf8').replace(/^import .*;\n/m,'').replace('export function initTransfers','globalThis.initTransfers = function').split('const GROUPS =')[0]!;
 runInNewContext(code,context);
 const ui=context.initTransfers({root,printTransfer:hooks.print,confirmBox:(text:string,options:any)=>hooks.confirm?.(text,options)??Promise.resolve(false),toast:(s:string)=>messages.push(s),go:(s:string)=>nav.push(s),api:async(path:string,method?:string,body?:any)=>{
   if(path.startsWith('/inventory/lookup'))return lookup?.(path) ?? {products:[]};
   if(method){posts.push({path,body});if(hooks.write)return hooks.write();return{id:'new',transferNo:'PCK-NEW'};}
   reads.push(path);if(path==='/stock-transfers/old'&&hooks.read)await hooks.read();
   return path==='/stock-transfers/old'?source:{transfers:[],warehouses:[...(!missing?[{id:'a',name:'Kho đi'}]:[]),{id:'b',name:'Kho đến'}]};
 }});
 await ui.load();await ui.show('old');
 return{root,ui,source,posts,nav,messages,reads,button:(text:string)=>all(root).find(n=>n.tag==='button'&&n.textContent===text)};
}
test('phiếu điều chuyển đã huỷ: sao chép mở form đủ mã/SL, chỉ gửi duyệt mới tạo phiếu mới',async()=>{
 const s=await setup();const before=JSON.stringify(s.source);
 await s.button('Sao chép phiếu')!.click();assert.equal(s.posts.length,0);
 const selects=all(s.root).filter(n=>n.tag==='select'&&['Kho đi','Kho đến'].includes(n.attrs['aria-label']!));assert.deepEqual(selects.map(n=>n.value),['a','b']);
 const quantities=all(s.root).filter(n=>n.type==='number');assert.deepEqual(quantities.map(n=>Number(n.value)),[12,3]);
 assert.match(s.root.textContent,/Phiếu gốc giữ trạng thái đã huỷ/);
 await s.button('Gửi duyệt')!.click();assert.equal(s.posts.length,1);assert.equal(s.posts[0].path,'/stock-transfers');
 assert.equal(s.posts[0].body.fromWarehouseId,'a');assert.equal(s.posts[0].body.toWarehouseId,'b');
 assert.match(s.posts[0].body.reason,/PCK-OLD/);assert.deepEqual(JSON.parse(JSON.stringify(s.posts[0].body.lines)),[{sku:'X',qty:12},{sku:'Y',qty:3}]);
 assert.equal(s.posts[0].body.id,undefined);assert.equal(s.posts[0].body.status,undefined);assert.equal(JSON.stringify(s.source),before);
 assert.deepEqual(s.nav,['#/transfers/new']);
});
test('sao chép: kho gốc đã bị ẩn phải chọn lại; đóng form không ghi gì, phiếu đang mở không có nút sao chép huỷ',async()=>{
 const s=await setup('cancelled',true);await s.button('Sao chép phiếu')!.click();
 assert.equal(all(s.root).find(n=>n.tag==='select'&&n.attrs['aria-label']==='Kho đi')!.value,'');
 await s.button('Huỷ')!.click();assert.equal(s.posts.length,0);assert.equal(s.source.status,'cancelled');
 const active=await setup('approved');assert.equal(active.button('Sao chép phiếu'),undefined);
});

test('phiếu chờ duyệt: chỉnh sửa giữ số phiếu/ID, PUT revision và không bị tải lại form khi đang sửa',async()=>{
 const s=await setup('pending');await s.button('Chỉnh sửa')!.click();
 const qty=all(s.root).find(n=>n.type==='number')!;qty.value=25;
 await s.ui.load('old');assert.equal(all(s.root).find(n=>n.type==='number'),qty);assert.equal(qty.value,25);
 await s.button('Lưu thay đổi')!.click();assert.equal(s.posts[0].path,'/stock-transfers/old');
 assert.equal(s.posts[0].body.revision,1);assert.equal(s.posts[0].body.lines[0].qty,25);assert.equal(s.posts[0].body.reason,'Bổ sung kho');
 assert.equal(s.posts[0].body.clientKey,undefined);
});
test('mở lại cùng phiếu không dựng lại drawer, giữ nguyên nút thao tác',async()=>{
 const s=await setup();const first=s.button('Sao chép phiếu');
 await Promise.all([s.ui.show('old'),s.ui.show('old')]);assert.equal(s.button('Sao chép phiếu'),first);
});

test('tìm sản phẩm: bấm kết quả thêm tên và gửi SKU; chọn lại không tạo dòng trùng',async()=>{
 const s=await setup('cancelled',false,async()=>({products:[{sku:'Z123',name:'Bình giữ nhiệt',unit:'cái',stock:[{warehouse:'Kho đi',qty:10}]}]}));
 await s.button('Sao chép phiếu')!.click();
 const find=all(s.root).find(n=>n.type==='search'&&n.attrs['aria-label']==='Tìm sản phẩm điều chuyển')!; find.value='Bình';
 await s.button('Tìm')!.click();
 const result=all(s.root).find(n=>n.className==='transfer-search-result')!;
 assert.match(result.textContent,/Bình giữ nhiệt.*Z123/);await result.click();
 assert.equal(find.value,'');assert.equal(all(s.root).find(n=>n.type==='text'&&n.value==='Bình giữ nhiệt')!==undefined,true);
 find.value='Z123';await s.button('Tìm')!.click();await all(s.root).find(n=>n.className==='transfer-search-result')!.click();
 assert.equal(all(s.root).filter(n=>n.type==='number').length,3);
 await s.button('Gửi duyệt')!.click();assert.deepEqual(JSON.parse(JSON.stringify(s.posts[0].body.lines)),[{sku:'X',qty:12},{sku:'Y',qty:3},{sku:'Z123',qty:1}]);
});
test('kết quả tìm cũ bị bỏ qua khi đổi từ khoá hoặc đóng form; lỗi tìm có thể thử lại',async()=>{
 let finish!:(v:any)=>void;let fail=false;
 const s=await setup('cancelled',false,async()=>{if(fail)throw Error('Mất kết nối');return new Promise(r=>finish=r);});
 await s.button('Sao chép phiếu')!.click();const find=all(s.root).find(n=>n.type==='search'&&n.attrs['aria-label']==='Tìm sản phẩm điều chuyển')!;find.value='cũ';
 const pending=s.button('Tìm')!.click();find.value='mới';finish({products:[{sku:'OLD',name:'Kết quả cũ'}]});await pending;
 assert.equal(all(s.root).some(n=>n.className==='transfer-search-result'),false);
 fail=true;await s.button('Tìm')!.click();assert.match(s.root.textContent,/Mất kết nối.*thử lại/);
 fail=false;const closed=s.button('Tìm')!.click();await s.button('Huỷ')!.click();finish({products:[{sku:'OLD',name:'Kết quả cũ'}]});await closed;
 assert.equal(all(s.root).some(n=>n.className==='transfer-search-result'),false);
});

test('bộ lọc gửi đủ tham số, giữ lựa chọn sau tải; xoá về Đang mở',async()=>{
 const s=await setup(),control=(label:string)=>all(s.root).find(n=>n.attrs['aria-label']===label)!;
 control('Tìm số phiếu hoặc mã sản phẩm').value='PCK 001';control('Lọc kho đi').value='a';control('Lọc kho đến').value='b';control('Lọc người xin').value='mgr';control('Lọc trạng thái').value='approved';control('Từ ngày lập').value='2026-10-01';control('Đến ngày lập').value='2026-10-30';
 const form=all(s.root).find(n=>n.className==='transfer-filter-grid')!;
 await form.events.submit!({preventDefault(){}});
 const q=new URLSearchParams(s.reads.at(-1)!.split('?')[1]);
 assert.deepEqual(Object.fromEntries(q),{status:'approved',q:'PCK 001',fromWarehouseId:'a',toWarehouseId:'b',requestedBy:'mgr',from:'2026-10-01',to:'2026-10-30'});
 assert.equal(control('Lọc kho đi').value,'a');
 await s.button('Xoá bộ lọc')!.click();assert.equal(s.reads.at(-1),'/stock-transfers?status=open');
 assert.equal(control('Tìm số phiếu hoặc mã sản phẩm').value,'');assert.equal(control('Từ ngày lập').value,'');
 const count=s.reads.length;control('Từ ngày lập').value='2026-10-30';control('Đến ngày lập').value='2026-10-01';await form.events.submit!({preventDefault(){}});assert.equal(s.reads.length,count);assert.match(s.messages.at(-1)!,/Từ ngày/);
});

test('đang ghi phiếu chỉ còn nút tiến trình; bấm trùng, huỷ, đóng, mở phiếu khác và refresh nền bị chặn tới khi tải xong',async()=>{
 let releaseWrite:()=>void=()=>{},releaseRead:()=>void=()=>{};
 const hooks:any={},s=await setup('approved',false,undefined,hooks),done=all(s.root).filter(n=>n.tag==='button'&&n.textContent==='Đã chuyển').at(-1)!,cancel=s.button('Huỷ phiếu')!,drawer=all(s.root).find(n=>n.tag==='aside')!;
 hooks.write=()=>new Promise(resolve=>{releaseWrite=()=>resolve({ok:true});});
 const pending=done.click();assert.equal(s.posts.length,1);assert.equal(done.disabled,true);assert.equal(done.hidden,false);assert.match(done.textContent,/Đang/);assert.equal(cancel.hidden,true);
 assert.ok(all(drawer).filter(n=>n.tag==='button'&&n!==done).every(n=>n.hidden&&n.disabled));
 await done.click();await cancel.click();const reads=s.reads.length;await s.ui.load('old');await s.ui.show('other');assert.equal(s.posts.length,1);assert.equal(s.reads.length,reads);assert.equal(drawer.hidden,false);
 let reached=false;hooks.read=()=>new Promise(resolve=>{reached=true;releaseRead=()=>resolve(undefined);});releaseWrite();
 for(let i=0;i<10&&!reached;i++)await new Promise(r=>setImmediate(r));
 assert.equal(reached,true);assert.equal(done.disabled,true);assert.equal(cancel.hidden,true,'giữ khoá trong lúc tải trạng thái mới');
 releaseRead();await pending;assert.equal(drawer.attrs['aria-busy'],undefined);assert.equal(s.posts.length,1);
});

test('ghi phiếu lỗi: trả lại nút, không gửi thêm request hoặc đổi tồn giả',async()=>{
 const hooks:any={},s=await setup('approved',false,undefined,hooks),done=all(s.root).filter(n=>n.tag==='button'&&n.textContent==='Đã chuyển').at(-1)!,cancel=s.button('Huỷ phiếu')!;
 hooks.write=async()=>{throw Error('Máy chủ chưa sẵn sàng');};await done.click();
 assert.equal(done.disabled,false);assert.equal(done.textContent,'Đã chuyển');assert.equal(cancel.hidden,false);assert.equal(s.posts.length,1);assert.match(s.messages.at(-1)!,/Máy chủ/);
});

test('lưu thay đổi phiếu cũng ẩn nút khác và chặn gửi lặp trong lúc chờ',async()=>{
 const hooks:any={},s=await setup('pending',false,undefined,hooks);await s.button('Chỉnh sửa')!.click();
 let fail:(e:Error)=>void=()=>{};hooks.write=()=>new Promise((_resolve,reject)=>{fail=reject;});
 const send=s.button('Lưu thay đổi')!,drawer=all(s.root).find(n=>n.tag==='aside')!,pending=send.click();
 assert.match(send.textContent,/Đang cập nhật/);assert.equal(send.disabled,true);assert.ok(all(drawer).filter(n=>n.tag==='button'&&n!==send).every(n=>n.hidden));
 await send.click();assert.equal(s.posts.length,1);fail(Error('Thử lại'));await pending;assert.equal(send.disabled,false);assert.equal(send.textContent,'Lưu thay đổi');assert.equal(s.button('Huỷ')!.hidden,false);
});


test('cancel requires a 3-second destructive confirmation, dismissing makes no write and repeated clicks cannot duplicate',async()=>{
 let finish!:(value:boolean)=>void;const confirmations:any[]=[],hooks:any={confirm:(text:string,options:any)=>{confirmations.push({text,options});return new Promise(resolve=>finish=resolve);}};
 const s=await setup('approved',false,undefined,hooks),cancel=s.button('Huỷ phiếu')!;
 const dismissed=cancel.click();assert.equal(s.posts.length,0);assert.equal(confirmations[0].options.delay,3000);assert.equal(confirmations[0].options.danger,true);assert.match(confirmations[0].text,/PCK-OLD/);
 await cancel.click();assert.equal(confirmations.length,1);finish(false);await dismissed;assert.equal(s.posts.length,0);assert.equal(cancel.disabled,false);
 const confirmed=cancel.click();assert.equal(s.posts.length,0);finish(true);await confirmed;assert.equal(s.posts.length,1);assert.equal(s.posts[0].path,'/stock-transfers/old/cancel');assert.equal(s.posts[0].body.revision,1);
});

const inputs=(s:any)=>all(s.root).filter(n=>n.type==='number');
const type=async(n:Node,v:string)=>{n.value=v;await n.events.input?.();};
test('phiếu đang chuyển: kho đến nhập SL nhận từng mã; nhận thiếu cần lý do + xác nhận rồi mới gửi đúng số',async()=>{
 const confirms:string[]=[];let answer=false;
 const s=await setup('shipped',false,undefined,{confirm:async(text)=>{confirms.push(text);return answer;}});
 assert.ok(!s.button('Đã chuyển'),'đã xuất rồi: không còn nút Đã chuyển');
 assert.ok(all(s.root).some(n=>n.tag==='th'&&n.textContent==='SL nhận'));
 const [x,y]=inputs(s);assert.deepEqual([x!.value,y!.value],['12','3'],'mặc định điền sẵn số chuyển để sửa');
 assert.deepEqual([x!.attrs['aria-label'],y!.attrs['aria-label']],['Số lượng nhận X','Số lượng nhận Y']);
 const why=all(s.root).find(n=>n.tag==='textarea')!;
 await type(y!,'1');assert.match(s.root.textContent,/Nhận thiếu 1 mã/);
 await s.button('Nhận hàng')!.click();assert.equal(s.posts.length,0);assert.match(s.messages.at(-1)!,/lý do/);
 why.value='Giao thiếu 2 bát';await s.button('Nhận hàng')!.click();
 assert.equal(s.posts.length,0,'người dùng chưa xác nhận nhận thiếu');assert.match(confirms[0]!,/Y: chuyển 3, nhận 1/);
 answer=true;await s.button('Nhận hàng')!.click();
 assert.equal(s.posts.length,1);assert.equal(s.posts[0].path,'/stock-transfers/old/receive');
 assert.deepEqual(JSON.parse(JSON.stringify(s.posts[0].body)),{revision:1,lines:[{sku:'X',qty:12},{sku:'Y',qty:1}],note:'Giao thiếu 2 bát'});
 assert.match(s.messages.at(-1)!,/hoàn về kho đi/);
});
test('nhận hàng: ô trống / âm / vượt số chuyển bị chặn ngay trên máy; nhận đủ không hỏi xác nhận',async()=>{
 const s=await setup('shipped',false,undefined,{confirm:async()=>{throw Error('nhận đủ không được hỏi xác nhận thiếu hàng');}});
 const [x]=inputs(s);
 for(const bad of ['','-1','13','abc']){await type(x!,bad);await s.button('Nhận hàng')!.click();assert.equal(s.posts.length,0,bad);assert.match(s.messages.at(-1)!,/Nhập số lượng nhận hợp lệ/);}
 await type(x!,'12');await s.button('Nhận hàng')!.click();
 assert.equal(s.posts.length,1);assert.deepEqual(JSON.parse(JSON.stringify(s.posts[0].body.lines)),[{sku:'X',qty:12},{sku:'Y',qty:3}]);assert.equal(s.posts[0].body.note,'');
 assert.match(s.messages.at(-1)!,/Đã nhận hàng/);
});
test('nút "Nhận hàng" chỉ hiện cho người có quyền nhận; nút in phiếu hiện từ khi đã duyệt',async()=>{
 const printed:any[]=[];
 const approved=await setup('approved',false,undefined,{print:t=>printed.push(t.transferNo)});
 await approved.button('In phiếu điều chuyển')!.click();assert.deepEqual(printed,['PCK-OLD']);assert.ok(approved.button('Đã chuyển')&&!approved.button('Nhận hàng'));
 const pending=await setup('pending',false,undefined,{print:t=>printed.push(t.transferNo)});assert.ok(!pending.button('In phiếu điều chuyển'),'chưa duyệt chưa có phiếu mang theo');
 const noRight=await setup('shipped',false,undefined,{print:()=>{}});noRight.source.actions={};await noRight.ui.show('old',true);
 assert.ok(!noRight.button('Nhận hàng'));assert.ok(noRight.button('In phiếu điều chuyển'));assert.match(noRight.root.textContent,/Chờ nhận/);
});
test('cân bằng kho nhanh chỉ điều hướng khi server cho phép, không tự ghi kho hoặc đổi phiếu',async()=>{
 const s=await setup('pending');assert.equal(s.button('Cân bằng kho nhanh'),undefined);
 (s.source.actions as Record<string,boolean>).adjustBalance=true;await s.ui.show('old');
 const before=JSON.stringify(s.source);await s.button('Cân bằng kho nhanh')!.click();
 assert.deepEqual(s.nav,['#/inventory?transfer=old']);assert.equal(s.posts.length,0);assert.equal(JSON.stringify(s.source),before);
});
