import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
const app=readFileSync(new URL('../../trial-ui/app.js',import.meta.url),'utf8');
const section=(from:string,to:string)=>app.slice(app.indexOf(from),app.indexOf(to,app.indexOf(from)));
class Element {
 value='';textContent='';disabled=false;hidden=false;open=true;dataset:any={};attrs:any={};options=[{}];children:any[]=[];childElementCount=0;scrollTop=0;
 listeners:any={};html='';
 classList={toggle:()=>{},add:()=>{}};
 addEventListener(type:string,fn:any){(this.listeners[type]??=[]).push(fn);}
 async emit(type:string,event:any={}){for(const fn of this.listeners[type]||[])await fn({target:this,...event});}
 set innerHTML(value:string){this.html=value;this.childElementCount=value?1:0;
  if(value.startsWith('<li'))this.children=[...value.matchAll(/<li data-i="(\d+)"[\s\S]*?<div id="picker-detail-\d+" class="picker-product-details" ([^>]*)>([\s\S]*?)<\/div>\s*<\/li>/g)].map(m=>{const panel=new Element();panel.hidden=m[2]!.includes('hidden');panel.innerHTML=m[3]!;return{dataset:{i:m[1]},classList:{toggle(){}},querySelector:()=>panel};});
  else this.children=[];
 }
 get innerHTML(){return this.html;}
 setAttribute(k:string,v:string){this.attrs[k]=v;}
 removeAttribute(k:string){delete this.attrs[k];}
 showModal(){this.open=true;}
 close(){this.open=false;void this.emit('close');}
}
function harness(){
 const nodes=new Map<string,Element>(),$=(id:string)=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id)!;};
 const c:any=createContext({$,Map,Set,Number,String,Date,encodeURIComponent,clearTimeout(){},setTimeout(){},console});
 c.nodes=nodes;
 return{c,$,run:(s:string)=>runInContext(s,c)};
}
test('one details control covers loaded, filtered and newly loaded rows without fetches or resetting quantities',async()=>{
 const h=harness(),{c,$,run}=h;
 Object.assign(c,{state:{policies:[{id:'retail',name:'Retail'}],holdsLoaded:false},editor:{rows:[],type:'B2B'},catalog:{items:Array.from({length:55},(_,i)=>({sku:'SKU'+i,name:'Name '+i}))},
  currentPolicy:()=> 'retail',esc:String,fmtNum:String,thumb:()=>'',stockText:String,incomingCell:()=>'',pickerStockColumns:()=>({}),pickerProductDetails:(p:any)=>'<span>'+p.sku+'</span>',pickerPolicyOptions(){},
  searchCatalog:(items:any[],opts:any)=>items.filter(p=>p.sku.includes(opts.q)),pickerOptions:()=>({q:$('#picker-search').value}),
  pickerQuery:()=>'',applyCatalogMeta(){},api:async()=>{c.requests++;return{products:[{sku:'REMOTE',name:'Remote'}],total:1};},requests:0});
 run("let pickerItems=[],pickerTotal=0,pickerReq=0,pickerGeneration=0,editorLoadSequence=0,pickerShown=20,pickerAdded=0,pickerTimer,pickerScrollTimer;let pickerDetailsExpanded=false;const pickerRowState=new Map();const isSaleEditor=()=>true;");
 run(section('async function loadPicker(', '/** Existing reservation rules'));
 run(section('function renderPicker(', 'function pickerProductDetails('));
 run(section('function syncPickerDetailsToggle()', "$('#picker-list').addEventListener('click'"));
 run(section('function resetPickerDialog()', "$('#picker-dialog').addEventListener('close'"));
 await run('loadPicker()');assert.equal($('#picker-list').children.length,20);
 run("pickerRowState.set('SKU0',{qty:'7'})");await run('loadPicker()');
 const before=$('#picker-list').innerHTML;await $('#picker-details-toggle').emit('click');
 assert.equal($('#picker-details-toggle').attrs['aria-expanded'],'true');
 assert($('#picker-list').children.every(li=>!li.querySelector().hidden));
 assert.equal($('#picker-list').innerHTML,before,'toggle updates panels in place, never rebuilds quantity inputs');
 assert.equal(c.requests,0);
 await run('loadPicker(true)');assert.equal($('#picker-list').children.length,40);
 assert($('#picker-list').children.every(li=>!li.querySelector().hidden));
 assert.match($('#picker-list').innerHTML,/value="7"/);
 $('#picker-search').value='SKU0';await run('loadPicker()');assert.equal($('#picker-list').children.length,1);assert(!$('#picker-list').children[0].querySelector().hidden);
 $('#picker-search').value='no match';await run('loadPicker()');assert.equal($('#picker-list').children.length,0);
 await $('#picker-details-toggle').emit('click');await $('#picker-details-toggle').emit('click');
 c.catalog.items=null;await run('loadPicker()');assert.equal(c.requests,1);assert(!$('#picker-list').children[0].querySelector().hidden);
 await $('#picker-details-toggle').emit('click');assert($('#picker-list').children.every(li=>li.querySelector().hidden));assert.equal(c.requests,1);
 run('resetPickerDialog()');assert.equal($('#picker-details-toggle').attrs['aria-expanded'],'false');assert.equal($('#picker-list').innerHTML,'');
 assert(!app.includes('data-picker-details='));
});
function imageHarness(){
 const h=harness(),{c,run}=h;
 Object.assign(c,{editor:{rows:[{sku:'A'},{sku:'B'}]},editorLoadSequence:0,catalog:{items:[{sku:'A',imageUrl:'https://example.test/a.png'},{sku:'B',imageUrl:'https://example.test/b.png'}]},
  isSaleEditor:()=>true,savableImage:(v:any)=>/^https:\/\//.test(v||''),imgTag:(v:string)=>'<img src="'+v+'">',markDirty(){},renderLines(){},
  api:async()=>({imageUrl:'https://private.test/design.png',key:'quote-designs/owner/file'}),compressImage:async()=> 'data:image/png;base64,NEW'});
 run(section('let imageTarget =', '/** Dòng có mã hàng nhưng chưa có ảnh'));
 return h;
}
test('image choice is explicit, cancellable, per-line and survives reopening without changing catalogue',async()=>{
 const {c,$,run}=imageHarness();
 run('openImage(0)');await Promise.resolve();
 assert.match($('#image-preview').innerHTML,/Chưa có ảnh/);assert.equal(c.editor.rows[0].image,undefined);
 await $('#image-use-product').emit('click');assert.match($('#image-preview').innerHTML,/a.png/);
 $('#image-dialog').close();run('openImage(0)');assert.match($('#image-preview').innerHTML,/Chưa có ảnh/);
 await $('#image-use-product').emit('click');await $('#image-save').emit('click');
 assert.equal(c.editor.rows[0].image,'https://example.test/a.png');assert.equal(c.editor.rows[0].designImage,true);assert.equal(c.editor.rows[1].image,undefined);
 run('openImage(0)');assert.match($('#image-preview').innerHTML,/a.png/);
 $('#image-url').value='https://example.test/new.png';await $('#image-url').emit('input');$('#image-dialog').close();
 run('openImage(0)');assert.match($('#image-preview').innerHTML,/a.png/);
 $('#image-url').value='https://example.test/new.png';await $('#image-url').emit('input');await $('#image-save').emit('click');assert.equal(c.editor.rows[0].image,'https://example.test/new.png');
 run('openImage(1)');assert.match($('#image-preview').innerHTML,/Chưa có ảnh/);
 await $('#image-use-product').emit('click');await $('#image-save').emit('click');assert.equal(c.editor.rows[1].image,'https://example.test/b.png');
 assert.equal(c.catalog.items[0].imageUrl,'https://example.test/a.png');
 run('openImage(0)');await $('#image-remove').emit('click');await $('#image-save').emit('click');assert.equal(c.editor.rows[0].image,undefined);assert.equal(c.editor.rows[0].designImage,false);
});
test('uploaded image stays on the same row object; cancellation discards pending work',async()=>{
 const {c,$,run}=imageHarness();run('openImage(0)');
 await $('#image-file').emit('change',{target:{files:[{}],value:''}});await $('#image-save').emit('click');
 assert.equal(c.editor.rows[0].designImageKey,'quote-designs/owner/file');
 run('openImage(0)');await $('#image-use-product').emit('click');await $('#image-save').emit('click');assert.equal(c.editor.rows[0].designImageKey,undefined);
 run('openImage(1)');await $('#image-use-product').emit('click');
 const target=c.editor.rows[1];c.editor.rows.unshift({sku:'C'});await $('#image-save').emit('click');assert.equal(target.image,'https://example.test/b.png');assert.equal(c.editor.rows[0].image,undefined);
 let resolve:any;c.compressImage=()=>new Promise(r=>resolve=r);
 run('openImage(1)');const pending=$('#image-file').emit('change',{target:{files:[{}],value:''}});
 $('#image-dialog').close();run('openImage(2)');resolve('data:image/png;base64,STALE');await pending;
 assert.doesNotMatch($('#image-preview').innerHTML,/STALE/);
});
test('late product responses and unconfirmed legacy images do not fill another design',async()=>{
 const {c,$,run}=imageHarness();c.catalog.items=null;let resolve:any;
 c.api=()=>new Promise(r=>resolve=r);c.editor.rows[0].image='https://example.test/legacy.png';
 run('openImage(0)');assert.match($('#image-preview').innerHTML,/Chưa có ảnh/);
 $('#image-dialog').close();c.catalog.items=[{sku:'B'}];run('openImage(1)');
 resolve({products:[{sku:'A',imageUrl:'https://example.test/late.png'}]});await Promise.resolve();await Promise.resolve();
 assert.equal($('#image-use-product').disabled,true);assert.match($('#image-preview').innerHTML,/Chưa có ảnh/);assert.equal($('#image-product-preview').innerHTML,'');
});

test('explicit existing product image persists on only its quote line and never updates catalogue images',async()=>{
 const {setup}=await import('../helpers/pos-fixture.ts');
 const {products}=await import('../../src/modules/catalog/schema.ts');
 const f=await setup();
 try{
  await f.db.insert(products).values([{sku:'IMAGE-A',name:'Image A',imageUrl:'https://example.test/a.png',updatedAt:new Date().toISOString()},{sku:'IMAGE-B',name:'Image B',imageUrl:'https://example.test/b.png',updatedAt:new Date().toISOString()}]);
  const body={type:'B2B',template:'sale',quoteNo:'EXPLICIT-IMAGE-TEST',customer:'Image fixture',date:'2026-11-14',vat:8,rows:[
   {sku:'IMAGE-A',name:'Image A',qty:1,price:100000,discount:0,designImage:true,image:'https://example.test/a.png'},
   {sku:'IMAGE-B',name:'Image B',qty:2,price:200000,discount:0}
  ]};
  const saved=await f.call('/quotes',f.mgr,'POST',body);assert.equal(saved.status,201,JSON.stringify(saved.data));
  const loaded=await f.call('/quotes/'+saved.data.id,f.mgr);assert.equal(loaded.status,200);
  assert.equal(loaded.data.data.rows[0].image,body.rows[0]!.image);assert.equal(loaded.data.data.rows[0].designImage,true);
  assert(!loaded.data.data.rows[1].image);assert(!loaded.data.data.rows[1].designImage);
  const catalogue=await f.call('/products?skus=IMAGE-A,IMAGE-B',f.mgr);
  assert.deepEqual(catalogue.data.products.map((p:any)=>[p.sku,p.imageUrl]).sort(),[['IMAGE-A','https://example.test/a.png'],['IMAGE-B','https://example.test/b.png']]);
 }finally{await f.client.close();}
});

test('add-product handler still uses the edited quantity and correct SKU',async()=>{
 const {c,$,run}=harness();const product={sku:'ADD-ME'},input=new Element();input.value='7';
 const li:any={querySelector:()=>input,classList:{add(){}},dataset:{i:'0'}};
 const button:any={dataset:{add:'0'},closest:()=>li};
 Object.assign(c,{parseNum:Number,rowFromProduct:(p:any)=>({sku:p.sku}),addRowsToQuote:(rows:any)=>{c.added=rows;return true;}});
 run("let pickerItems=[{sku:'ADD-ME'}],pickerAdded=0;const pickerRowState=new Map();");
 run(section("$('#picker-list').addEventListener('click'", "$('#picker-list').addEventListener('keydown'"));
 await $('#picker-list').emit('click',{target:{closest:()=>button}});
 assert.equal(c.added[0].sku,product.sku);assert.equal(c.added[0].qty,7);assert.equal(button.disabled,true);
});
