import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {createTestDb} from '../helpers/postgres.ts';
import {seedStaff,PASSWORD,T} from '../helpers/staff-fixture.ts';
import {createStaffRouter,type StaffEnv} from '../../src/modules/staff/api/auth-routes.ts';
import {credentials,employees} from '../../src/modules/staff/schema.ts';
import {sha256Hex} from '../../src/modules/staff/domain/session.ts';
import {hashPassword} from '../../src/core/auth/password.ts';
const origin='https://crm.test';
async function world(){
 const {db,d1}=await createTestDb();await seedStaff(d1);let now=T.now,fail=false;const sent:any[]=[];
 const pw=await hashPassword(PASSWORD,1000);
 for(const [id,email,role,active] of [['customer','customer@x.vn','customer',true],['disabled','disabled@x.vn','customer',false],['phone','kh-0901234567@sdt.invalid','customer',true]] as const){
  await db.insert(employees).values({id,name:id,email,phone:'0901234567',role,positionId:role,active,createdAt:new Date().toISOString()});await db.insert(credentials).values({memberId:id,passwordHash:pw});
 }
 const env:StaffEnv={db,nowSec:()=>now,passwordIterations:1000,mailer:{apiKey:'test-resend-private-key',from:'Bách Ngân <mail@crm.test>',alwaysCc:['orders-copy@crm.test'],fetch:(async(_url,init)=>{
  assert.equal((init?.headers as Record<string,string>).authorization,'Bearer test-resend-private-key');const message=JSON.parse(String(init?.body));
  if(fail)return Response.json({message:'private provider data'},{status:500});sent.push(message);return Response.json({id:'mail-'+sent.length});
 }) as typeof fetch}};
 const router=createStaffRouter();
 const call=async(path:string,body?:unknown,cookie='',ip='192.0.2.1',requestOrigin=origin)=>{const r=await router.handle(new Request(origin+'/api/staff'+path,{method:body===undefined?'GET':'POST',headers:{origin:requestOrigin,'content-type':'application/json',cookie,'cf-connecting-ip':ip},body:body===undefined?undefined:JSON.stringify(body)}),env);return {status:r.status,data:await r.json() as any,cookie:r.headers.get('set-cookie')?.split(';')[0]||''};};
 const row=async(id:string)=>(await db.select().from(credentials).where(eq(credentials.memberId,id)))[0]!;
 const link=()=>new URL(sent.at(-1).text.match(/https:\/\/\S+/)[0]);
 const token=()=>new URLSearchParams(link().hash.slice(1)).get('token')!;
 return {db,env,sent,call,row,link,token,clock:(t:number)=>now=t,fail:()=>fail=true};
}
test('NCC reset uses existing mailer privately; password/session stay valid until one-use redemption',async()=>{
 const f=await world(),before=await f.row('ncc'),login=await f.call('/login',{email:'ncc@x.vn',password:PASSWORD});
 const requested=await f.call('/forgot-password',{email:' NCC@x.vn ',audience:'supplier'});assert.equal(requested.status,200);assert.deepEqual(Object.keys(requested.data).sort(),['message','ok']);
 assert.equal(f.sent.length,1);assert.deepEqual(f.sent[0].to,['ncc@x.vn']);assert.equal(f.sent[0].from,f.env.mailer!.from);assert.equal(f.sent[0].cc,undefined);assert.equal(f.sent[0].reply_to,undefined);
 assert.equal(f.link().origin,origin);assert.equal(f.link().pathname,'/reset-password.html');assert.equal(f.link().search,'');assert.equal(new URLSearchParams(f.link().hash.slice(1)).get('portal'),'supplier');
 const token=f.token(),after=await f.row('ncc');assert.equal(after.activationHash,sha256Hex(token));assert.equal(after.passwordHash,before.passwordHash);assert.equal(after.version,before.version);assert.equal(after.activationExpires,T.now+3600);assert.equal((await f.call('/me',undefined,login.cookie)).status,200);
 assert.ok(!JSON.stringify(requested.data).includes(token));assert.equal((await f.call('/activate',{token,password:'new-password-123'})).status,200);
 assert.equal((await f.call('/me',undefined,login.cookie)).status,401);assert.equal((await f.call('/login',{email:'ncc@x.vn',password:PASSWORD})).status,401);assert.equal((await f.call('/login',{email:'ncc@x.vn',password:'new-password-123'})).status,200);
 assert.equal((await f.call('/activate',{token,password:'other-password-123'})).status,400);
});
test('customer link resets once even with concurrent redemption',async()=>{
 const f=await world();assert.equal((await f.call('/forgot-password',{email:'customer@x.vn',audience:'customer'})).status,200);
 assert.equal(new URLSearchParams(f.link().hash.slice(1)).get('portal'),'customer');const token=f.token();
 const results=await Promise.all([f.call('/activate',{token,password:'customer-new-123'}),f.call('/activate',{token,password:'other-new-123'})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
 assert.equal((await f.row('customer')).activationHash,null);
});
test('unknown/inactive/internal/phone-only/wrong portal return same generic response and send no mail',async()=>{
 const f=await world(),before=await f.row('emp');let generic='';
 for(const data of [{email:'unknown@x.vn'},{email:'disabled@x.vn'},{email:'emp@x.vn'},{email:'mgr@x.vn'},{email:'kh-0901234567@sdt.invalid'},{email:'ncc@x.vn',audience:'customer'}]){
  const r=await f.call('/forgot-password',data);assert.equal(r.status,200);if(!generic)generic=JSON.stringify(r.data);assert.equal(JSON.stringify(r.data),generic);
 }
 assert.equal(f.sent.length,0);assert.deepEqual(await f.row('emp'),before);
});
test('new link replaces old, expires after an hour, and ordinary password change revokes pending link',async()=>{
 const f=await world();await f.call('/forgot-password',{email:'ncc@x.vn'});const first=f.token();await f.call('/forgot-password',{email:'ncc@x.vn'});const second=f.token();assert.notEqual(first,second);
 assert.equal((await f.call('/activation-info',{token:first})).status,400);assert.equal((await f.call('/activation-info',{token:second})).status,200);
 f.clock(T.now+3601);assert.equal((await f.call('/activation-info',{token:second})).status,400);
 await f.call('/forgot-password',{email:'ncc@x.vn'});const third=f.token();const login=await f.call('/login',{email:'ncc@x.vn',password:PASSWORD});assert.equal((await f.call('/password',{currentPassword:PASSWORD,password:'self-changed-123'},login.cookie)).status,200);
 assert.equal((await f.call('/activation-info',{token:third})).status,400);
});
test('provider failure rolls back token update, preserves prior link/password, and does not disclose account',async()=>{
 const f=await world();const ok=await f.call('/forgot-password',{email:'ncc@x.vn'});const before=await f.row('ncc'),token=f.token();f.fail();
 const failure=await f.call('/forgot-password',{email:'ncc@x.vn'});assert.deepEqual(failure.data,ok.data);assert.equal(failure.status,200);assert.deepEqual(await f.row('ncc'),before);assert.equal((await f.call('/activation-info',{token})).status,200);assert.equal((await f.call('/login',{email:'ncc@x.vn',password:PASSWORD})).status,200);
});
test('recovery validates input/origin/config and limits both email and IP',async()=>{
 const f=await world();assert.equal((await f.call('/forgot-password',{email:'bad'})).status,400);assert.equal((await f.call('/forgot-password',{email:'ncc@x.vn',audience:'employee'})).status,400);assert.equal((await f.call('/forgot-password',{email:'ncc@x.vn'},'','192.0.2.1','https://evil.test')).status,403);
 for(let i=0;i<3;i++)assert.equal((await f.call('/forgot-password',{email:'unknown@x.vn'})).status,200);assert.equal((await f.call('/forgot-password',{email:'unknown@x.vn'})).status,429);
 for(let i=0;i<10;i++)assert.equal((await f.call('/forgot-password',{email:`other${i}@x.vn`},'','192.0.2.2')).status,200);assert.equal((await f.call('/forgot-password',{email:'extra@x.vn'},'','192.0.2.2')).status,429);
 f.env.mailer=undefined;assert.equal((await f.call('/forgot-password',{email:'not-configured@x.vn'},'','192.0.2.3')).status,503);
});

test('Edge background mail uses waitUntil while keeping a generic response',async()=>{
 const f=await world(),jobs:Promise<unknown>[]=[];f.env.waitUntil=job=>jobs.push(job);
 const r=await f.call('/forgot-password',{email:'ncc@x.vn',audience:'supplier'});assert.equal(r.status,200);assert.equal(jobs.length,1);await Promise.all(jobs);assert.equal(f.sent.length,1);assert.equal((await f.row('ncc')).activationHash,sha256Hex(f.token()));
});
