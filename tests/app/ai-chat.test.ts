import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {aiChatQuestions} from '../../src/modules/ai-chat/schema.ts';

const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
test('AI public questions: employee access, privacy rejection, webhook contract, token isolation and one-time callbacks',async()=>{
 const f=await setup(),sent:any[]=[];
 f.env.aiChatIntegration={webhookUrl:'https://n8n.fixture.invalid/hook',webhookToken:'x'.repeat(64),callbackOrigin:'https://crm.fixture.invalid',fetch:(async(_url,init)=>{sent.push({body:JSON.parse(String(init?.body)),auth:new Headers(init?.headers).get('authorization')});return new Response('{}');}) as typeof fetch};
 const callback=async(id:string,token:string,body:any)=>{
  const r=await f.router.handle(new Request('https://trial.test/api/staff/integrations/ai-chat/'+id+'/result',{method:'POST',headers:{origin:'https://trial.test',authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)}),f.env);
  return {status:r.status,data:await r.json()};
 };
 {
  assert.equal((await f.call('/ai-chat/questions')).status,401);
  assert.equal((await f.call('/ai-chat/questions',f.ncc)).status,403);
  for(const question of ['Mật khẩu thử nghiệm của tôi là fixture','Số điện thoại 0901234567 cần hỗ trợ','Tra cứu lương của nhân viên'])assert.equal((await f.call('/ai-chat/questions',f.emp,'POST',{question})).status,422);
  assert.equal(sent.length,0);
  const made=ok(await f.call('/ai-chat/questions',f.emp,'POST',{question:'Hướng dẫn kiểm tra phiếu lấy trước trong CRM?'}),202);
  const hook=sent[0];assert.equal(hook.auth,'Bearer '+'x'.repeat(64));assert.equal(hook.body.visibility,'all_employees');assert.equal(hook.body.question.author.id,'emp');
  assert.equal(hook.body.callback.url,'https://crm.fixture.invalid/api/staff/integrations/ai-chat/'+made.id+'/result');
  const listing=ok(await f.call('/ai-chat/questions',f.mgr));assert.equal(listing.items.length,1);
  assert.equal(JSON.stringify(listing).includes(hook.body.callback.token),false);assert.equal(listing.items[0].callbackTokenHash,undefined);
  assert.equal((await callback(made.id,crypto.randomUUID(),{status:'answered',answer:'Sai mã'})).status,401);
  assert.equal((await callback(made.id,hook.body.callback.token,{status:'answered',answer:''})).status,422,'invalid result must not consume callback');
  const replies=await Promise.all(['Kết quả A','Kết quả B'].map(answer=>callback(made.id,hook.body.callback.token,{status:'answered',answer})));
  assert.deepEqual(replies.map(x=>x.status).sort(),[200,401]);
  const [row]=await f.db.select().from(aiChatQuestions).where(eq(aiChatQuestions.id,made.id));assert.equal(row!.callbackTokenHash,null);assert.ok(['Kết quả A','Kết quả B'].includes(row!.answer));
  assert.equal((await callback(made.id,hook.body.callback.token,{status:'answered',answer:'Ghi đè'})).status,401);
  ok(await f.call('/ai-chat/questions/'+made.id+'/helpful',f.emp,'POST',{}));ok(await f.call('/ai-chat/questions/'+made.id+'/helpful',f.emp,'POST',{}));
  assert.equal(ok(await f.call('/ai-chat/questions',f.mgr)).items[0].helpful,1);
  ok(await f.call('/ai-chat/questions/'+made.id+'/helpful',f.emp,'POST',{on:false}));assert.equal(ok(await f.call('/ai-chat/questions',f.emp)).items[0].helpful,0);
  assert.equal((await f.call('/ai-chat/questions/'+made.id+'/helpful',f.ncc,'POST',{})).status,403);
  assert.equal(ok(await f.call('/ai-chat/questions?q=khong-co-ket-qua',f.emp)).total,0);
 }
});

test('AI webhook unavailable: no config writes nothing; unknown delivery stays reviewable and accepts a late callback',async()=>{
 const f=await setup();let payload:any;
 {
  assert.equal((await f.call('/ai-chat/questions',f.emp,'POST',{question:'Quy trình kiểm tra phiếu giao hàng?'})).status,503);
  assert.equal((await f.db.select().from(aiChatQuestions)).length,0);
  f.env.aiChatIntegration={webhookUrl:'https://n8n.fixture.invalid/hook',webhookToken:'x'.repeat(64),fetch:(async(_u,i)=>{payload=JSON.parse(String(i?.body));throw new Error('fixture timeout');}) as typeof fetch};
  const made=ok(await f.call('/ai-chat/questions',f.emp,'POST',{question:'Cách kiểm tra nguồn hàng trong CRM?'}),202);
  assert.equal(ok(await f.call('/ai-chat/questions',f.emp)).items[0].status,'needs_review');
  const r=await f.router.handle(new Request('https://trial.test/api/staff/integrations/ai-chat/'+made.id+'/result',{method:'POST',headers:{origin:'https://trial.test',authorization:'Bearer '+payload.callback.token,'content-type':'application/json'},body:JSON.stringify({status:'answered',answer:'Kiểm tra nguồn tại chi tiết đơn.'})}),f.env);
  assert.equal(r.status,200);assert.equal(ok(await f.call('/ai-chat/questions',f.emp)).items[0].status,'answered');
 }
});
