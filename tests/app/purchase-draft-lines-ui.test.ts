import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../../trial-ui/purchases.js',import.meta.url),'utf8');
const section=(a:string,b:string)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
class Element{
 children:Element[]=[];events:Record<string,Function>={};attrs:Record<string,string>={};value:any='';textContent='';hidden=false;disabled=false;tag='';
 constructor(tag:string){this.tag=tag;}get tHead(){return this.children.find(e=>e.tag==='thead');}
 append(...items:Element[]){this.children.push(...items);}replaceChildren(...items:Element[]){this.children=items;}
 setAttribute(k:string,v:string){this.attrs[k]=v;}addEventListener(k:string,fn:Function){this.events[k]=fn;}focus(){}
}
async function setup(){
 const made:Element[]=[],calls:any[]=[];const make=(tag:string)=>{const e=new Element(tag);made.push(e);return e;};
 const current={id:'draft',ticketNumber:'DMH-DEMO',supplier:{id:'s'},revision:3,warehouse:'Kho',lines:[{sku:'001',name:'Cũ',unit:'Cái',quantity:5,sources:[{type:'quote',id:'q1',no:'BG1',quantity:5}]}]};
 const ctx:any={document:{createElement:make,createTextNode:(text:string)=>({textContent:text})},current,options:async()=>({suppliers:[{id:'s',name:'NCC'}]}),frame:()=>make('frame'),back(){},errorBox:()=>make('error'),foot:(...nodes:Element[])=>{const e=make('footer');e.append(...nodes);return e;},num:String,requiresSupplierOrderNumber:()=>false,run:(_b:any,_e:any,fn:Function)=>fn(),api:(...a:any[])=>{calls.push(a);return Promise.resolve({});},bindManualProductLookup:()=>({reset(){},dispose(){}}),disposeLookup:null,drawer:{hidden:false}};
 runInNewContext(section('const el =','const dmy =')+section('  const qtyInput =','  async function editForm()')+section('  async function editForm()','  /** Duyệt (giá + lịch trả)')+'\nglobalThis.edit=editForm;',ctx);
 await ctx.edit();const form=made.find(e=>e.tag==='form')!,error=made.find(e=>e.tag==='error')!;
 const input=(placeholder:string)=>made.find((e:any)=>e.placeholder===placeholder)!;
 const click=(text:string)=>made.filter(e=>e.tag==='button'&&e.textContent===text).at(-1)!.events.click!();
 return {made,calls,current,error,input,click,submit:()=>form.events.submit!({preventDefault(){}})};
}
test('draft editor adds/removes items and saves exact SKU while retaining links of remaining lines',async()=>{
 const f=await setup();f.input('Mã hàng (SKU)').value='0002';f.input('Tìm tên hàng').value='Thêm';f.input('ĐVT').value='Bộ';
 f.made.find(e=>e.attrs['aria-label']==='Số lượng thêm')!.value='2';f.click('Thêm sản phẩm');
 const qty=f.made.filter(e=>e.attrs['aria-label']==='Số lượng 001').at(-1)!;qty.value='3';qty.events.input!();f.submit();
 let body=f.calls.at(-1)[2];assert.deepEqual(JSON.parse(JSON.stringify(body.lines)),[{sku:'001',name:'Cũ',unit:'Cái',quantity:3,sources:[{type:'quote',id:'q1',quantity:3}]},{sku:'0002',name:'Thêm',unit:'Bộ',quantity:2,sources:[]}]);
 f.made.filter(e=>e.attrs['aria-label']==='Bỏ sản phẩm 001').at(-1)!.events.click!();f.submit();body=f.calls.at(-1)[2];assert.equal(body.lines.length,1);assert.equal(body.lines[0].sku,'0002');assert.equal(f.current.lines.length,1);assert.equal(f.current.lines[0]!.quantity,5,'local draft does not mutate loaded detail');
});
test('duplicate SKU, fractional quantity and empty drafts cannot be saved',async()=>{
 const f=await setup();f.input('Mã hàng (SKU)').value='001';f.input('Tìm tên hàng').value='Trùng';f.click('Thêm sản phẩm');assert.match(f.error.textContent,/đã có/);
 const qty=f.made.find(e=>e.attrs['aria-label']==='Số lượng 001')!;qty.value='1.5';qty.events.input!();f.submit();assert.equal(f.calls.length,0);
 f.made.find(e=>e.attrs['aria-label']==='Bỏ sản phẩm 001')!.events.click!();f.submit();assert.match(f.error.textContent,/ít nhất một/);assert.equal(f.calls.length,0);
});
