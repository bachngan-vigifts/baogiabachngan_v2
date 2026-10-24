import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
class Node {
 children:Node[]=[];events:Record<string,Function>={};value='';hidden=false;disabled=false;dataset:Record<string,string>={};textContent='';type='';classList={add(){}};
 constructor(public tag:string,public className='',text=''){this.textContent=text;}
 append(...n:Node[]){this.children.push(...n);}
 replaceChildren(...n:Node[]){this.children=n;}
 setAttribute(){}
 addEventListener(k:string,fn:Function){this.events[k]=fn;}
 get selectedOptions(){return [{textContent:this.value}];}
}
const all=(n:Node):Node[]=>[n,...n.children.flatMap(all)];
for(const direct of [false,true])for(const code of ['ghn_handler_unavailable','ghn_empty_response','ghn_create_failed','address_invalid'])test(`Form ${direct?'Minh Long':'Lock'}: ${code} giữ dữ liệu, chỉ lỗi địa chỉ mới trở về sửa`,async()=>{
 const form=new Node('form'),dlg=new Node('dialog'),calls:any[]=[];
 const province=new Node('select'),district=new Node('select'),ward=new Node('select');province.value='211';district.value='1929';ward.value='490707';
 const order={id:'fake-id',orderNo:'21496',customerName:'Khách kiểm thử',phone:'0901234567',total:100000,suggestedCod:90000,ghnDirect:direct,lines:'[{"sku":"00123","quantity":1}]',ghnAddress:{addressLine:'Đường kiểm thử',provinceId:211,districtId:1929,wardCode:'490707'}};
 const before=JSON.stringify(order);
 const context:any={document:{},el:(t:string,c='',s='')=>new Node(t,c,s),money:String,
  button:(text:string,cls:string,click:Function)=>{const b=new Node('button',cls,text);b.events.click=click;return b;},
  field:(_label:string,type:string,value:string)=>{const input=new Node('input');Object.assign(input,{type,value});const box=new Node('label');box.append(input);return{input,box};},
  formModal:()=>({form,dlg,show(){},close(){throw Error('Form must stay open');},lock(busy:boolean,button:Node){dlg.dataset.busy=busy?'1':'';button.disabled=busy;}}),
  ghnLocationFields:()=>({province:{select:province,box:new Node('label')},district:{select:district,box:new Node('label')},ward:{select:ward,box:new Node('label')},retry:new Node('button'),prefill:async()=>{},complete:()=>true,chosen:(s:Node)=>s.value,fullAddress:(line:string)=>line}),
  run:(fn:Function)=>fn(),api:async(path:string,method:string,body:any)=>{calls.push({path,method,body});throw Object.assign(Error('Lỗi cụ thể từ backend'),{code});}};
 const src=readFileSync(new URL('../../trial-ui/pos.js',import.meta.url),'utf8');
 runInNewContext(src.slice(src.indexOf('  function showGhnAddress('),src.indexOf('  let printingTemporary'))+';globalThis.open=showGhnAddress;',context);
 context.open(order);
 const submit=()=>form.events.submit!({preventDefault(){}});
 await submit();assert.equal(all(form).find(n=>n.className==='pos-step-body')!.hidden,true);
 const values=all(form).filter(n=>n.tag==='input').map(n=>n.value);
 await submit();
 assert.equal(calls.length,1,'không tự gửi lại khi lỗi');assert.equal(all(form).find(n=>n.className==='pos-step-body')!.hidden,code!=='address_invalid');
 assert.equal(all(form).find(n=>n.className==='error pos-step-error')!.textContent,'Lỗi cụ thể từ backend');
 assert.deepEqual(all(form).filter(n=>n.tag==='input').map(n=>n.value),values);assert.equal(JSON.stringify(order),before);
 assert.deepEqual([province.value,district.value,ward.value],['211','1929','490707']);
 if(direct){assert.equal(calls[0].body.codAmount,90000);assert.equal(calls[0].body.ghnWeight,1000);}
});
