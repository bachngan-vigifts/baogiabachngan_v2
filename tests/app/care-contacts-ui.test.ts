import {test} from 'node:test';
import assert from 'node:assert/strict';
const {customerContactChoices,bindCareContactPicker}=await import(new URL('../../trial-ui/care-contacts.js',import.meta.url).href);
const data=(name:string)=>({customer:{contact:name,phone:'0900'},contacts:[]});
function setup(api:Function,matchUniqueName=false){
 const select:any={value:'',disabled:false,children:[],events:{},replaceChildren(...nodes:any[]){this.children=nodes;this.value=nodes[0]?.value||'';},addEventListener(key:string,fn:Function){this.events[key]=fn;}};
 const input:any={value:'',hidden:false,required:false},status:any={textContent:''},retry:any={hidden:true,events:{},addEventListener(key:string,fn:Function){this.events[key]=fn;}};
 let id:any='a',connected=true;
 const picker=bindCareContactPicker({select,input,status,retry,api,getCustomerId:()=>id,isConnected:()=>connected,doc:{createElement:()=>({value:'',textContent:''})},matchUniqueName});
 return{picker,select,input,status,retry,setId:(v:any)=>id=v,close:()=>connected=false};
}
test('contact picker loads the primary and full directory, deduplicates and keeps stored values within API limits',()=>{
 const contacts=Array.from({length:50},(_,i)=>({name:'Người '+i,phone:'090'+i,title:'Mua hàng'}));
 const list=customerContactChoices({customer:{contact:'Người 0',phone:'0900'},contacts});assert.equal(list.length,50);assert.match(list[0].label,/Mua hàng/);
 const long=customerContactChoices({contacts:[{name:'a'.repeat(160),phone:'0900',title:'Bộ phận'}]})[0];assert.equal(long.value.length,160);assert.match(long.label,/0900/);
 assert.equal(customerContactChoices({customer:{contact:'Cũ'},contacts:[{name:'Liên hệ chính',isPrimary:true}]})[0].name,'Liên hệ chính');
});
test('contacts automatically load and choosing another person updates the saved contact value',async()=>{
 const s=setup(async()=>({customer:{contact:'An',phone:'0900'},contacts:[{name:'Bình',phone:'0911',title:'Kế toán'}]}));await s.picker.load('a');assert.equal(s.input.value,'An – 0900');assert.equal(s.select.children.length,3);assert.equal(s.input.hidden,true);
 s.select.value='1';s.select.events.change();assert.equal(s.input.value,'Bình – 0911');
 s.select.value='__manual__';s.select.events.change();assert.equal(s.input.hidden,false);assert.equal(s.input.required,true);
});
test('A to B to A race ignores old responses, and clearing or closing never restores stale contacts',async()=>{
 const pending:Array<Function>=[];const s=setup(()=>new Promise(r=>pending.push(r)));
 const old=s.picker.load('a');s.setId('b');const other=s.picker.load('b');s.setId('a');const current=s.picker.load('a');
 pending[2]!(data('Mới'));await current;pending[0]!(data('Cũ'));await old;pending[1]!(data('Khác'));await other;assert.equal(s.input.value,'Mới – 0900');
 const cleared=s.picker.load('a');s.setId(null);s.picker.clear();pending[3]!(data('Không được hiện'));await cleared;assert.equal(s.input.value,'');assert.equal(s.select.disabled,true);
 s.setId('a');const closed=s.picker.load('a');s.close();pending[4]!(data('Đã đóng'));await closed;assert.equal(s.input.value,'');
});
test('loading failure allows manual input and retry; editing preserves historical contact text',async()=>{
 let fail=true;const s=setup(async()=>{if(fail)throw Error('offline');return data('An');});await s.picker.load('a','Tên đã lưu');assert.equal(s.picker.isLoading(),false);assert.equal(s.retry.hidden,false);assert.equal(s.input.value,'Tên đã lưu');assert.equal(s.input.hidden,false);
 fail=false;await s.retry.events.click();assert.equal(s.input.value,'Tên đã lưu');assert.equal(s.select.value,'__manual__');assert.equal(s.retry.hidden,true);
 const empty=setup(async()=>({contacts:[]}));await empty.picker.load('a');assert.equal(empty.input.hidden,false);assert.equal(empty.input.required,true);
});

test('quote reminder may match a unique saved contact name, but never guesses among identical names',async()=>{
 const one=setup(async()=>data('An'),true);await one.picker.load('a','An');assert.equal(one.select.value,'0');assert.equal(one.input.value,'An – 0900');
 const two=setup(async()=>({customer:{contact:'An',phone:'0900'},contacts:[{name:'An',phone:'0911'}]}),true);await two.picker.load('a','An');assert.equal(two.select.value,'__manual__');assert.equal(two.input.value,'An');
});
