import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser DOM module
import {mountCashCollections} from '../../trial-ui/cash-collections.js';
class Node{
 children:Node[]=[];events:Record<string,Function>={};text='';className='';dataset={};disabled=false;value='';
 constructor(public tag='div'){}
 append(...ns:Node[]){this.children.push(...ns);}set textContent(s:string){this.text=String(s);this.children=[];}get textContent():string{return this.text+this.children.map(n=>n.textContent).join('');}
 setAttribute(){}focus(){}addEventListener(k:string,f:Function){this.events[k]=f;}
 querySelectorAll(s:string):Node[]{return this.children.flatMap(n=>[...(n.tag===s?[n]:[]),...n.querySelectorAll(s)]);}querySelector(s:string){return this.querySelectorAll(s)[0];}
 async click(){if(!this.disabled)await this.events.click?.();}
}
const row={id:'held-1',status:'held',amount:100,collectedByName:'<b>Sale</b>',paidAt:'2026-11-02'};
function mount(options:any={}){
 const original=globalThis.document,host=new Node(),calls:any[]=[],changes:any[]=[];
 Object.assign(globalThis,{document:{createElement:(tag:string)=>new Node(tag)}});
 mountCashCollections({host,rows:[row],canConfirm:false,api:async(...args:any[])=>{calls.push(args);return{};},confirmBox:async()=>true,onChanged:async()=>changes.push(true),...options});
 return{host,calls,changes,restore:()=>Object.assign(globalThis,{document:original}),button:(text:string)=>host.querySelectorAll('button').find(b=>b.textContent===text)!};
}
test('employee sees held cash as uncompleted and cannot confirm; HTML in names is plain text',()=>{
 const s=mount();try{assert.match(s.host.textContent,/Tiền mặt nhân viên còn giữ/);assert.match(s.host.textContent,/chưa hoàn tất thanh toán/);assert.match(s.host.textContent,/<b>Sale<\/b>/);assert.equal(s.host.querySelectorAll('button').length,0);assert.equal(s.calls.length,0);}finally{s.restore();}
});
test('Manager confirms actual receipt explicitly; cancelling the confirmation sends nothing',async()=>{
 let approve=false;const s=mount({canConfirm:true,confirmBox:async()=>approve});try{
  await s.button('Xác nhận đã nhận tiền').click();assert.equal(s.calls.length,0);approve=true;await s.button('Xác nhận đã nhận tiền').click();assert.deepEqual(s.calls,[['/payments/cash-collections/held-1/confirm','POST',{confirmed:true}]]);assert.equal(s.changes.length,1);
 }finally{s.restore();}
});
test('failed confirmation keeps pending information and unlocks retry without claiming completion',async()=>{
 const s=mount({canConfirm:true,api:async()=>{throw Error('Chưa rõ kết quả, kiểm tra lại');}});try{await s.button('Xác nhận đã nhận tiền').click();assert.match(s.host.textContent,/Tiền mặt nhân viên còn giữ/);assert.match(s.host.textContent,/Chưa rõ kết quả/);assert.equal(s.button('Xác nhận đã nhận tiền').disabled,false);assert.equal(s.changes.length,0);}finally{s.restore();}
});
test('cancel collection requires a reason and explicit cash-return/mistake confirmation',async()=>{
 const s=mount({canConfirm:true});try{await s.button('Huỷ ghi nhận…').click();const form=s.host.querySelector('form')!,reason=form.querySelector('input')!;reason.value='Ghi nhận nhầm';await form.events.submit!({preventDefault(){}});assert.deepEqual(s.calls,[['/payments/cash-collections/held-1/cancel','POST',{confirmed:true,reason:'Ghi nhận nhầm'}]]);}finally{s.restore();}
});
