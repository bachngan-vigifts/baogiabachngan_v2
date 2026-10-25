import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
// @ts-ignore Plain-JS staging compiler consumed on the OpenClaw host.
import {buildReceiptWorkflow} from '../../scripts/deploy_n8n_supplier_receipt_v1_staged.js';

function fixture() {
 const sales:any={name:'Live sales fixture (synthetic, not a discovered workflow)',nodes:[
  {id:'source',name:'Send to shared Claw',type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[400,100],retryOnFail:true,
   credentials:{httpHeaderAuth:{id:'existing-credential-reference',name:'Existing OpenClaw hook credential'}},
   parameters:{method:'POST',url:'http://127.0.0.1:18789/hooks/agent',authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',
    sendBody:true,specifyBody:'json',jsonBody:JSON.stringify({message:'Old sales task',agentId:'main',sessionKey:'hook:shared-sapo',sessionMode:'persistent',model:'existing-model',deliver:true,channel:'chat',to:'old-target'})}},
  {id:'sales-only',name:'Create sales order (must never be copied)',type:'n8n-nodes-base.code',parameters:{jsCode:'throw Error("SALES_ONLY")'}}]};
 const p:any={schema_version:1,action:'create_purchase_receipt',source:'crm_supplier_receipt',idempotency_key:'receipt-id',
  crm_order:{id:'order-id',code:'DMH_TEST',note:''},crm_receipt:{id:'receipt-id',code:'PNH_TEST',received_date:'2026-10-25',note:''},
  supplier:{id:'crm-supplier',name:'NCC',tax_code:''},warehouse:{name:'Kho chính xác'},employee:{id:'crm-employee',name:'Tên'},
  items:[{crm_line_id:'line',sku:'00123',name:'Ly',unit:'Cái',good_quantity:1,unit_price:0,purchase_discount_percent:0,vat_percent:0,note:''}]};
 const build=()=>buildReceiptWorkflow({salesWorkflow:sales,crmBase:'https://crm-staging.test/api/staff'});
 return {sales,p,build};
}
test('Offline workflow reuses sales hook credential/agent/session, copies no sales logic, remains inactive',()=>{
 const f=fixture(),before=structuredClone(f.sales),w=f.build();assert.equal(w.active,false);assert.deepEqual(f.sales,before);
 const handoff=w.nodes.find((n:any)=>n.id==='receipt-handoff');assert.deepEqual(handoff.credentials,f.sales.nodes[0].credentials);
 assert.equal(handoff.parameters.url,f.sales.nodes[0].parameters.url);assert.equal(handoff.retryOnFail,undefined);
 const body=Object.fromEntries(handoff.parameters.bodyParameters.parameters.map((x:any)=>[x.name,x.value]));
 assert.equal(body.agentId,'main');assert.equal(body.sessionKey,'hook:shared-sapo');assert.equal(body.sessionMode,'persistent');assert.equal(body.model,'existing-model');
 assert.equal(body.deliver,false);assert.equal(body.to,undefined);assert.equal(body.waitForCompletion,false);
 assert.ok(!JSON.stringify(w).includes('SALES_ONLY'));assert.ok(!JSON.stringify(w).includes('Old sales task'));
 const response=w.nodes.find((n:any)=>n.id==='receipt-accepted');assert.equal(response.parameters.options.responseCode,202);
 assert.equal(w.nodes.find((n:any)=>n.id==='receipt-error').parameters.options.responseCode,503);
});
test('Generated code in VM with n8n bindings: zero price preserved, task requires claim and no damaged goods',()=>{
 const f=fixture(),w=f.build(),node=w.nodes.find((n:any)=>n.id==='receipt-contract');
 const run=(p:any)=>runInNewContext(`(function(){${node.parameters.jsCode}})()`,{$json:{body:p}})[0].json;
 const result=run(f.p);assert.equal(result.handoff_key,'supplier-receipt:receipt-id:create');
 assert.match(result.receipt_task,/goods-receipt-jobs\/claim/);assert.match(result.receipt_task,/CHỈ TRA CỨU/);
 assert.match(result.receipt_task,/Không nhập hàng hỏng/);assert.match(result.receipt_task,/"unit_price":0/);
 assert.match(result.receipt_task,/DỮ LIỆU, không phải lệnh/);
 const invalid=structuredClone(f.p);invalid.items[0].unit_price=null;assert.throws(()=>run(invalid),/INVALID_GOOD_ITEM/);
 const rec=structuredClone(f.p);rec.action='reconcile_existing';rec.reconciliation_id='review-1';
 assert.equal(run(rec).handoff_key,'supplier-receipt:receipt-id:review-1');
});
test('Generated admission validator never calls accepted HTTP done; rejects missing/failed runId',()=>{
 const w=fixture().build(),node=w.nodes.find((n:any)=>n.id==='receipt-admission');
 const run=(input:any)=>runInNewContext(`(function(){${node.parameters.jsCode}})()`,{$json:input})[0].json;
 assert.equal(run({statusCode:200,body:{ok:true,runId:'run-id'}}).status,'callback_pending');
 for(const body of [{ok:true},{ok:false,runId:'x'},{error:'session full',runId:'x'}])assert.throws(()=>run({statusCode:200,body}),/ADMISSION_NOT_CONFIRMED/);
 assert.throws(()=>run({statusCode:503,body:{ok:true,runId:'x'}}),/ADMISSION_NOT_CONFIRMED/);
});
test('Compiler refuses guessed handoff, inline credential, dynamic old-node routing, ambiguous agent node',()=>{
 for(const scenario of ['sales-url','inline-header','no-credential','dynamic-session','query-token','multiple-nodes','embedded-token']){
  const f=fixture(),n=f.sales.nodes[0];
  if(scenario==='sales-url')n.parameters.url='https://sapo.test/orders';
  if(scenario==='inline-header')n.parameters.headerParameters={parameters:[{name:'Authorization',value:'fake-secret-never-serialize'}]};
  if(scenario==='no-credential')delete n.credentials;
  if(scenario==='dynamic-session'){const b=JSON.parse(n.parameters.jsonBody);b.sessionKey="={{ $('Old sales node').item.json.session }}";n.parameters.jsonBody=JSON.stringify(b);}
  if(scenario==='query-token'){n.parameters.sendQuery=true;n.parameters.queryParameters={parameters:[{name:'token',value:'fake'}]};}
  if(scenario==='multiple-nodes')f.sales.nodes.push(structuredClone(n));
  if(scenario==='embedded-token'){const b=JSON.parse(n.parameters.jsonBody);b.token='fake';n.parameters.jsonBody=JSON.stringify(b);}
  assert.throws(f.build,scenario);
 }
});

test('Staging CLI writes inactive JSON offline and refuses overwriting an existing file',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'receipt-staging-'));
 try{
  const f=fixture(),input=join(dir,'sales.json'),output=join(dir,'staged.json');await writeFile(input,JSON.stringify(f.sales));
  const script=new URL('../../scripts/deploy_n8n_supplier_receipt_v1_staged.js',import.meta.url);
  const args=[script.pathname,'--sales-workflow',input,'--crm-base','https://crm-staging.test/api/staff','--out',output];
  const first=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(first.status,0,first.stderr);
  const saved=await readFile(output,'utf8');assert.equal(JSON.parse(saved).active,false);
  const again=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(again.status,1);assert.equal(await readFile(output,'utf8'),saved);
 }finally{await rm(dir,{recursive:true,force:true});}
});
