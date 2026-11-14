import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanWordEdits} from '../../src/modules/quotes/domain/quotation-schema.ts';
import {setupLiquidation} from '../helpers/liquidation-fixture.ts';
import {salesContracts} from '../../src/modules/sales/schema.ts';
import {eq} from 'drizzle-orm';
const edit={index:2,hash:'a'.repeat(64),text:'Nội dung thử',align:'both',lineSpacing:1.5,indent:720,list:'bullet',runs:[{text:'Nội dung ',bold:true,fontFamily:'Arial',fontSize:14,color:'b91c1c'},{text:'thử',italic:true,underline:true,strike:false}]} as const;
test('structured Word formatting round-trips without accepting HTML/CSS or inconsistent text',()=>{
 const [saved]=cleanWordEdits([edit]);assert.equal(saved!.runs![0]!.color,'B91C1C');assert.equal(saved!.lineSpacing,1.5);assert.equal(saved!.list,'bullet');
 for(const change of [{runs:[{text:'Khác'}]},{runs:'<script>'},{fontSize:200},{fontSize:NaN},{fontSize:12.3},{fontFamily:'url(https://outside.invalid)'},{color:'red'},{lineSpacing:20},{indent:-1},{list:'image'},{runs:[{text:edit.text,bold:'yes'}]}])assert.throws(()=>cleanWordEdits([{...edit,...change}]));
 const [clean]=cleanWordEdits([{...edit,html:'<script>x</script>',runs:[{text:edit.text,html:'<img src=x>',style:'position:fixed',bold:true}]}]);
 assert.doesNotMatch(JSON.stringify(clean),/script|position:fixed|<img/);
 assert.deepEqual(cleanWordEdits([{index:1,hash:'b'.repeat(64),text:'Bản cũ',bold:false}]),[{index:1,hash:'b'.repeat(64),text:'Bản cũ',bold:false}]);
});
test('Manager saves formatted contract edits with revision checks; approved-contract employee and malformed updates stay blocked',async()=>{
 const f=await setupLiquidation();const [before]=await f.db.select().from(salesContracts).where(eq(salesContracts.id,'liq-contract'));
 const url='/contracts/liq-contract',body={revision:before!.revision,details:{details:{representativeTitle:'Giám đốc'},edits:{HDKT:[edit],TAM_UNG:[],BBNT:[]}}};
 assert.equal((await f.call(url,f.emp,'PUT',body)).status,403);
 assert.equal((await f.call(url,f.mgr,'PUT',{...body,details:{edits:{HDKT:[{...edit,runs:[{text:'Không khớp'}]}]}}})).status,400);
 const saved=await f.call(url,f.mgr,'PUT',body);assert.equal(saved.status,200,JSON.stringify(saved.data));
 const [after]=await f.db.select().from(salesContracts).where(eq(salesContracts.id,'liq-contract'));const data=JSON.parse(after!.data);
 assert.equal(data.edits.HDKT[0].runs[0].bold,true);assert.equal(data.edits.HDKT[0].runs[0].color,'B91C1C');assert.equal(after!.value,before!.value);assert.equal(after!.depositAmount,before!.depositAmount);
 assert.equal((await f.call(url,f.mgr,'PUT',body)).status,409);
});
