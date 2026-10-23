import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
class Node {
  children:Node[]=[];parent:Node|null=null;attrs:Record<string,string>={};events:Record<string,Function>={};style={};dataset:Record<string,string>={};
  type='';value:any='';className='';own='';hidden=false;disabled=false;tag:string;
  classList={toggle:()=>{}};
  constructor(tag='div'){this.tag=tag;}
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
async function setup(status='cancelled',missing=false){
 const root=new Node(),posts:any[]=[],nav:string[]=[],messages:string[]=[];
 const source={id:'old',transferNo:'PCK-OLD',status,statusLabel:'Đã huỷ',fromWarehouseId:'a',toWarehouseId:'b',reason:'Bổ sung kho',lines:[{sku:'X',name:'Ly',qty:12,unit:'cái',fromStock:20,toStock:0},{sku:'Y',name:'Bát',qty:3,unit:'cái',fromStock:30,toStock:0}],actions:{}};
 const context:any={document:{createElement:(tag:string)=>new Node(tag),createTextNode:(s:string)=>{const n=new Node('text');n.textContent=s;return n;}},location:{hash:'#/transfers/old'},history:{replaceState(){}}};
 const code=readFileSync(new URL('../../trial-ui/stock-ops.js',import.meta.url),'utf8').replace(/^import .*;\n/m,'').replace('export function initTransfers','globalThis.initTransfers = function').split('const GROUPS =')[0]!;
 runInNewContext(code,context);
 const ui=context.initTransfers({root,toast:(s:string)=>messages.push(s),go:(s:string)=>nav.push(s),api:async(path:string,method?:string,body?:any)=>{
   if(method){posts.push({path,body});return{id:'new',transferNo:'PCK-NEW'};}
   return path==='/stock-transfers/old'?source:{transfers:[],warehouses:[...(!missing?[{id:'a',name:'Kho đi'}]:[]),{id:'b',name:'Kho đến'}]};
 }});
 await ui.load();await ui.show('old');
 return{root,ui,source,posts,nav,messages,button:(text:string)=>all(root).find(n=>n.tag==='button'&&n.textContent===text)};
}
test('phiếu điều chuyển đã huỷ: sao chép mở form đủ mã/SL, chỉ gửi duyệt mới tạo phiếu mới',async()=>{
 const s=await setup();const before=JSON.stringify(s.source);
 await s.button('Sao chép phiếu')!.click();assert.equal(s.posts.length,0);
 const selects=all(s.root).filter(n=>n.tag==='select');assert.deepEqual(selects.map(n=>n.value),['a','b']);
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
