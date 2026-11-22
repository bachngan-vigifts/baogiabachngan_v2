import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

class Element {
 children:any[]=[];dataset:any={};open=false;className='';value='';private text='';
 set textContent(v:any){this.text=String(v);this.children=[];} get textContent():string{return this.text+this.children.map(n=>n.textContent??String(n)).join(' ');}
 append(...nodes:any[]){this.children.push(...nodes);} replaceChildren(...nodes:any[]){this.text='';this.children=nodes;}
 addEventListener(){} showModal(){this.open=true;} remove(){} close(){this.open=false;}
 querySelectorAll(){return [];} onclick:any;
}
function load(file:string){
 const body=new Element(),ctx:any={document:{body,createElement:()=>new Element()},crypto,console};
 runInNewContext(readFileSync(new URL('../../trial-ui/'+file,import.meta.url),'utf8').replace(/export (async )?function /g,'$1function ')+'\nglobalThis.render=typeof renderOrderReturns==="function"?renderOrderReturns:openCrmReturns;',ctx);
 return {body,render:ctx.render};
}
test('review 1 UI: tóm tắt ghi đúng 2 hàng hỏng của dòng restock một phần',()=>{
 const {body,render}=load('order-return-summary.js');render({host:body,order:{channel:'crm',id:'review'},summary:{requests:[{id:'r',returnNo:'TH-1',status:'completed',receivedAt:'2026-11-01T00:00:00Z',warehouseName:'Kho',lines:[{sku:'A',unit:'cái',receivedQty:10,restockQty:8,disposition:'restock'}]}]}});
 assert.match(body.textContent,/hàng hỏng 2 cái/);
});
test('review 4 UI: chỉ ghi chia phần khi có hàng hỏng, làm tròn cả danh sách và form',async()=>{
 const {body,render}=load('crm-returns.js');const lines=[{name:'Full',sku:'FULL',requestedQty:1,plannedRestockQty:1,disposition:'restock',unit:'cái',total:1},{name:'Split',sku:'SPLIT',requestedQty:0.4,plannedRestockQty:0.1,disposition:'restock',unit:'cái',total:1}];
 await render({orderId:'o',toast:()=>{},api:async()=>({order:{orderNo:'DH-1',status:'delivered',total:2},account:{paid:2,credit:0,refunded:0,balance:0,available:0},canApprove:true,manager:true,viewerId:'mgr',warehouses:[],drawers:[],lines:[],returns:[{id:'r',returnNo:'TH-1',status:'pending',total:2,createdBy:'emp',refundableAfterReceive:0,refunds:[],lines}]})});
 assert.doesNotMatch(body.textContent,/hàng hỏng 0(?![,\d])|0\.30000000000000004/);
 assert.match(body.textContent,/Nhập tồn 0,1; hàng hỏng 0,3/);
 const walk=(e:any):any[]=>[e,...e.children.flatMap(walk)];const b=walk(body).find(n=>n.textContent==='Duyệt & hoàn tất');await b.onclick();
 assert.match(body.textContent,/Nhập tồn 0,1; hàng hỏng 0,3/);assert.doesNotMatch(body.textContent,/hàng hỏng 0(?![,\d])|0\.30000000000000004/);
});
