import {test} from 'node:test';
import assert from 'node:assert/strict';
const {customerListQuery,hasCustomerListFilters,bindCustomerListFilters,updateCustomerFilterSummary}=await import(new URL('../../trial-ui/customer-list-filters.js',import.meta.url).href);
function setup(){
 const nodes:Record<string,any>={};
 for(const key of ['province','owner','from','to','sort','status','kind','mine','pending','retail','clear','filter-error','filter-summary'])nodes['#customer-'+key]={value:'',checked:false,hidden:false,disabled:false,textContent:'',attrs:{},events:{} as Record<string,Function>,get selectedOptions(){return[{textContent:this.value==='emp'?'Nhân viên A':this.value}];},setAttribute(k:string,v:string){this.attrs[k]=v;},addEventListener(k:string,fn:Function){this.events[k]=fn;}};
 nodes['#customer-sort'].value='newest';const $=(key:string)=>nodes[key];let reloads=0;bindCustomerListFilters($,()=>reloads++);
 return{$,change:(key:string,value:any)=>{const n=$('#customer-'+key);if(typeof value==='boolean')n.checked=value;else n.value=value;n.events.change();},get reloads(){return reloads;}};
}
const flush=()=>new Promise<void>(r=>queueMicrotask(r));
test('customer query combines approved/business filters with owner, date, search and server pagination',()=>{
 const s=setup();s.$('#customer-status').value='approved';s.$('#customer-kind').value='business';s.$('#customer-owner').value='emp';s.$('#customer-from').value='2026-11-01';
 const q=new URLSearchParams(customerListQuery(s.$,{limit:50,offset:100,query:'cong ty'}));
 assert.equal(q.get('status'),'approved');assert.equal(q.get('kind'),'business');assert.equal(q.get('owner'),'emp');assert.equal(q.get('from'),'2026-11-01');assert.equal(q.get('offset'),'100');assert.equal(q.get('q'),'cong ty');assert.equal(q.get('filters'),'1');
 assert.equal(hasCustomerListFilters(s.$),true);
});
test('quick toggles and advanced selectors synchronize and a mobile Apply issues one reload',async()=>{
 const s=setup();s.change('status','approved');s.change('kind','business');s.change('owner','emp');await flush();assert.equal(s.reloads,1);
 assert.equal(s.$('#customer-pending').checked,false);assert.equal(s.$('#customer-retail').checked,false);
 s.change('pending',true);s.change('retail',true);await flush();assert.equal(s.reloads,2);assert.equal(s.$('#customer-status').value,'pending');assert.equal(s.$('#customer-kind').value,'retail');
 s.change('pending',false);s.change('retail',false);await flush();assert.equal(s.$('#customer-status').value,'');assert.equal(s.$('#customer-kind').value,'');
});
test('invalid dates do not query; correcting dates reloads and clear resets all filters and sort',async()=>{
 const s=setup();s.change('from','2026-11-20');s.change('to','2026-11-01');await flush();assert.equal(s.reloads,0);assert.equal(s.$('#customer-filter-error').hidden,false);
 s.change('to','2026-11-25');s.change('mine',true);s.change('sort','name-desc');await flush();assert.equal(s.reloads,1);assert.match(s.$('#customer-filter-summary').textContent,/Khách của tôi/);assert.match(s.$('#customer-filter-summary').textContent,/20\/11\/2026/);
 s.$('#customer-clear').events.click();await flush();assert.equal(s.reloads,2);assert.equal(hasCustomerListFilters(s.$),false);assert.equal(s.$('#customer-sort').value,'newest');assert.equal(s.$('#customer-filter-summary').hidden,true);assert.equal(s.$('#customer-clear').disabled,true);
 s.$('#customer-from').value='2026-02-30';assert.equal(updateCustomerFilterSummary(s.$),false);
});
test('sorting alone does not change the unfiltered customer total',async()=>{
 const s=setup();s.change('sort','oldest');await flush();assert.equal(hasCustomerListFilters(s.$),false);assert.equal(s.$('#customer-clear').disabled,false);
});

test('province filter is sent to server pagination, appears in summary and resets with other filters',async()=>{
 const s=setup();s.change('province','92');await flush();const q=new URLSearchParams(customerListQuery(s.$,{limit:50,offset:50,query:''}));assert.equal(q.get('province'),'92');assert.equal(hasCustomerListFilters(s.$),true);assert.match(s.$('#customer-filter-summary').textContent,/Tỉnh\/thành/);s.$('#customer-clear').events.click();await flush();assert.equal(s.$('#customer-province').value,'');assert.equal(hasCustomerListFilters(s.$),false);
});
