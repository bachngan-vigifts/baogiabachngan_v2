import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../../trial-ui/app.js', import.meta.url), 'utf8');
const deferred = () => { let resolve!: (v: any) => void, reject!: (e: any) => void; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
function editorSetup() {
  const calls: Record<string, ReturnType<typeof deferred>> = {}, applied: any[] = [], errors: any[] = [];
  const context: any = { location: { hash: '#/quotes/ttc' }, document: {}, editor: { id: null, dirty: false, pending: null }, qf: { contains: () => true },
    $: () => ({}), field: () => ({ focus() {} }), setTimeout() {}, newQuoteData: () => ({ customer: '' }), markDirty() {}, syncEditorQuoteNo() {},
    api: (path: string) => (calls[path] ||= deferred()).promise,
    fillEditor: (id: string, _r: number, data: any) => { applied.push({ id, customer: data.customer }); context.editor.id=id; context.editor.dirty=false; },
    toast: (...args: any[]) => errors.push(args), go: (...args: any[]) => errors.push(args) };
  runInNewContext(source.slice(source.indexOf('let editorLoadSequence ='), source.indexOf('function fillEditor(')) + '\nglobalThis.open = openEditor;', context);
  return { context, calls, applied, errors };
}
test('phản hồi TTC về muộn không ghi đè báo giá mới của Vinpearl', async () => {
  const s=editorSetup(), old=s.context.open('ttc');
  s.context.location.hash='#/quotes/new'; s.context.editor.pending={ customer: 'Vinpearl' }; await s.context.open('new');
  s.calls['/quotes/ttc']!.resolve({id:'ttc',revision:1,data:{customer:'TTC'}}); await old;
  assert.deepEqual(s.applied,[{id:null,customer:'Vinpearl'}]); assert.equal(s.context.qf.inert,false);
});
test('mở hai báo giá nhanh: chỉ phản hồi của báo giá đang xem được điền vào form', async () => {
  const s=editorSetup(), old=s.context.open('ttc'); s.context.location.hash='#/quotes/uni'; const newer=s.context.open('uni');
  s.calls['/quotes/uni']!.resolve({id:'uni',revision:1,data:{customer:'UNI-SON'}}); await newer;
  s.calls['/quotes/ttc']!.resolve({id:'ttc',revision:1,data:{customer:'TTC'}}); await old;
  assert.deepEqual(s.applied,[{id:'uni',customer:'UNI-SON'}]);
});
test('lỗi tải báo giá cũ không chuyển người dùng khỏi báo giá mới', async () => {
  const s=editorSetup(), old=s.context.open('ttc'); s.context.location.hash='#/quotes/new'; await s.context.open('new');
  s.calls['/quotes/ttc']!.reject(Object.assign(new Error('Lỗi cũ'),{status:404})); await old; assert.equal(s.errors.length,0);
});

function pickerSetup() {
  const events: Record<string, Function>={}, queries: any[]=[], timers=new Map<number,Function>(); let seq=0;
  const input={value:'',setAttribute() {},addEventListener:(e:string,f:Function)=>events['input:'+e]=f};
  const list={hidden:true,innerHTML:'',replaceChildren(){this.innerHTML='';},addEventListener:(e:string,f:Function)=>events['list:'+e]=f};
  const ctx:any={nq:{}, document:{activeElement:input}, comboBusy() {}, esc:String,
    $:(id:string)=>id==='#nq-customer'?input:id==='#nq-suggest'?list:{open:true},
    setTimeout:(f:Function)=>{timers.set(++seq,f);return seq;},clearTimeout:(id:number)=>timers.delete(id),
    api:()=>{const d=deferred();queries.push(d);return d.promise;} };
  // Bộ tìm khách (customer-search.js): chưa có kết quả trên máy → hỏi máy chủ qua api giả ở trên.
  ctx.customerSearch={local:()=>null,remote:async()=>(await ctx.api()).customers};
  const start=source.indexOf("{\n  const input = $('#nq-customer')"), end=source.indexOf("$('#new-quote-form').addEventListener",start);
  runInNewContext(source.slice(start,end),ctx);
  return {ctx,input,list,queries,events,search(value:string){input.value=value;events['input:input']!();const task=[...timers.values()].pop()!;timers.clear();return task();},pick(){events['list:click']!({preventDefault(){},target:{closest:()=>({dataset:{i:'0'}})}});} };
}
test('gõ từ khoá mới: kết quả TTC cũ không trở thành lựa chọn khách mới', async () => {
  const s=pickerSetup(), old=s.search('ttc'); const newer=s.search('vin');
  s.queries[0].resolve({customers:[{id:'ttc',name:'TTC'}]}); await old; s.pick(); assert.equal(s.ctx.nq.customer,null);
  s.queries[1].resolve({customers:[{id:'vin',name:'Vinpearl'}]}); await newer; s.pick(); assert.equal(s.ctx.nq.customer.id,'vin');
});
test('mở lại popup: gợi ý và khách đã chọn lượt trước được xoá', async () => {
  const s=pickerSetup(), p=s.search('ttc'); s.queries[0].resolve({customers:[{id:'ttc',name:'TTC'}]}); await p;
  s.ctx.nq.resetCustomerSearch(); s.pick(); assert.equal(s.ctx.nq.customer,null); assert.equal(s.list.hidden,true); assert.equal(s.list.innerHTML,'');
});

test('khách gõ khác lựa chọn cũ: không mang theo ID/MST/liên hệ TTC khi tạo báo giá', () => {
  const nodes:Record<string,any>={}; let submit!:Function;
  const vals:Record<string,string>={'#nq-customer':'Vinpearl','#nq-date':'2026-10-14','#nq-no':'HRC_BG20261014_004','#nq-discount':'0','#nq-deposit-rate':'0','#nq-payment-term':'30'};
  const ctx:any={nq:{type:'HRC',customer:{id:'ttc',name:'TTC',contact:'Tâm',taxCode:'3500753423-002'}},editor:{},parseNum:Number,newQuoteData:(d:any)=>d,
    location:{hash:'#/quotes'},go(){}, $:(id:string)=>nodes[id]||=(id==='#new-quote-form'?{addEventListener:(_e:string,f:Function)=>submit=f}:{value:vals[id]||'',textContent:'',close(){}})};
  const start=source.indexOf("$('#new-quote-form').addEventListener"),end=source.indexOf('// ----- đóng thùng',start);
  runInNewContext(source.slice(start,end),ctx); submit({preventDefault(){}});
  assert.equal(ctx.editor.pending.customer,'Vinpearl'); assert.equal(ctx.editor.pending.customerId,undefined);
  assert.equal(ctx.editor.pending.customerTaxCode,undefined); assert.equal(ctx.editor.pending.contact,undefined);
});

test('phản hồi lưu TTC không ghi đè khi đã chuyển sang tạo báo giá cho khách khác', async () => {
  const pending=deferred(), applied:any[]=[], messages:any[]=[], nodes:Record<string,any>={};
  const ctx:any={ editor:{id:'ttc',revision:1,dirty:true,approval:{status:'pending'}}, location:{hash:'#/quotes/ttc'}, qf:{},
    isManager:()=>true,collectQuote:()=>({customer:'TTC'}),validateQuote:()=>'', api:()=>pending.promise,
    $:(id:string)=>nodes[id]||={}, fillEditor:(...args:any[])=>applied.push(args), toast:(s:string)=>messages.push(s),loadQuotes(){},updateQuoteActions(){} };
  const start=source.indexOf('let saving = false;'),end=source.indexOf("qf.addEventListener('submit'",start);
  runInNewContext('let editorLoadSequence=0;'+source.slice(start,end)+'\nglobalThis.save=saveQuote;globalThis.bump=()=>editorLoadSequence++;',ctx);
  const save=ctx.save(); ctx.location.hash='#/quotes/new'; ctx.editor.id=null; ctx.bump();
  pending.resolve({id:'ttc',revision:2,data:{quoteNo:'TTC-old',customer:'TTC'}}); await save;
  assert.equal(applied.length,0); assert.equal(ctx.editor.id,null); assert.match(messages[0],/Đã lưu/);
});
