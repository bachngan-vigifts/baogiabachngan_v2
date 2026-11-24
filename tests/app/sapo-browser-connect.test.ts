import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('CRM có luồng đăng nhập Sapo thật và kết nối phiên bằng tiện ích, vẫn giữ cách dán thủ công',()=>{
 const html=readFileSync('trial-ui/index.html','utf8');
 assert.match(html,/id="sapo-browser-connect"/);
 assert.match(html,/https:\/\/bachngankiengiang\.mysapogo\.com\/admin/);
 assert.match(html,/name="cookie"/);
 const manifest=JSON.parse(readFileSync('trial-ui/sapo-connector/manifest.json','utf8'));
 assert.deepEqual(manifest.permissions,['cookies']);
 assert.deepEqual(manifest.host_permissions,['https://bachngankiengiang.mysapogo.com/*']);
 assert.equal(manifest.externally_connectable,undefined);
 assert.deepEqual(manifest.content_scripts[0].matches,['https://crm.minhlongonline.com/*']);
});

import {runInNewContext} from 'node:vm';
import {eq} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {sapoRuntimeSessions} from '../../src/modules/integrations/schema.ts';
import {decryptCookie} from '../../src/modules/integrations/domain/sapo-session.ts';
const extensionId='fixture-connector';
const sender={id:extensionId,frameId:0,tab:{id:7,url:'https://crm.minhlongonline.com/#/staff'}};
function worker(){const context:any={URL,Date,Map,Set};runInNewContext(readFileSync('trial-ui/sapo-connector/worker.js','utf8').replace(/^export /gm,'' )+'\nglobalThis.worker={allowedSender,sessionHeader,captureSession};',context);return context.worker;}
const cookie=(name:string,value:string,extra:object={})=>({name,value,domain:'bachngankiengiang.mysapogo.com',path:'/admin',httpOnly:true,...extra});

test('tiện ích chỉ chấp nhận content script của chính nó tại staff top-frame, không trang/iframe khác',async()=>{
 const w=worker();assert.equal(w.allowedSender(sender,extensionId),true);
 for(const bad of [{...sender,id:'other'},{...sender,frameId:1},{...sender,tab:{id:7,url:'https://evil.test/#/staff'}},{...sender,tab:{id:7,url:'https://crm.minhlongonline.com.evil.test/#/staff'}},{...sender,tab:{id:7,url:'https://crm.minhlongonline.com/#/products'}},{...sender,tab:{id:7,url:'http://crm.minhlongonline.com/#/staff'}}])assert.equal(w.allowedSender(bad,extensionId),false);
 let called=0;const api={runtime:{id:extensionId},cookies:{getAllCookieStores(){called++;throw Error('must not access');}}};
 assert.equal((await w.captureSession(api,{type:'BN_SAPO_CAPTURE',requestId:'bad'},sender)).ok,false);assert.equal(called,0);
});

test('chỉ lấy cookie phiên Sapo cho shop, giữ số/encoding, loại cookie khác, hết hạn và phân vùng; không đoán cookie trùng',()=>{
 const w=worker();assert.equal(w.sessionHeader([cookie('sapo-admin','abc%2B123'),cookie('_admin_session_id','sid'),cookie('tracking','secret'),cookie('sapo-admin','bad',{domain:'evil.test'}),cookie('.AspNetCore.Session','expired',{expirationDate:1}),cookie('.AspNetCore.Session','partition',{partitionKey:{topLevelSite:'https://evil.test'}})],2),'sapo-admin=abc%2B123; _admin_session_id=sid');
 assert.equal(w.sessionHeader([cookie('sapo-admin','ok',{domain:'.mysapogo.com'})]),'sapo-admin=ok');
 for(const rows of [[],[cookie('sapo-admin','x\r\nsecret')],[cookie('sapo-admin','x;y')],[cookie('sapo-admin','x'),cookie('sapo-admin','different')],[cookie('sapo-admin','x'.repeat(30000))]])assert.throws(()=>w.sessionHeader(rows));
});

test('cookie store phải là profile/tab CRM; lỗi browser không bị trả nguyên văn',async()=>{
 const w=worker(),queries:any[]=[],message={type:'BN_SAPO_CAPTURE',requestId:'12345678-1234-1234-1234-123456789abc'};
 const api={runtime:{id:extensionId},cookies:{getAllCookieStores:async()=>[{id:'other',tabIds:[5]},{id:'current',tabIds:[7]}],getAll:async(q:any)=>{queries.push(q);return[cookie('sapo-admin','value')];}}};
 const r=await w.captureSession(api,message,sender);assert.equal(r.cookie,'sapo-admin=value');assert.deepEqual(JSON.parse(JSON.stringify(queries)),[{url:'https://bachngankiengiang.mysapogo.com/admin',storeId:'current'}]);
 api.cookies.getAll=async()=>{throw Error('secret cookie should not appear');};const failed=await w.captureSession(api,message,sender);assert.equal(failed.code,'NO_SESSION');assert.ok(!JSON.stringify(failed).includes('secret'));
});

test('kết nối bằng API cũ vẫn Manager-only, mã hoá, không trả cookie; phiên sai giữ bản đã lưu',async()=>{
 const f=await setup(),secret='fixture-sapo-secret-01234567890123456789';let expired=false,calls=0;
 Object.assign(f.env,{sapoSyncToken:secret,sapoFetch:async()=>{calls++;return expired?new Response('',{status:302,headers:{location:'/admin/login'}}):Response.json({accounts:[]});}});
 const body={cookie:'sapo-admin=fixture-admin; _admin_session_id=fixture-http-only'};
 assert.equal((await f.call('/admin/sapo-session',f.emp,'POST',body)).status,403);assert.equal(calls,0);
 const saved=await f.call('/admin/sapo-session',f.mgr,'POST',body);assert.equal(saved.status,200);assert.ok(!JSON.stringify(saved.data).includes('fixture-admin'));
 const [row]=await f.db.select().from(sapoRuntimeSessions).where(eq(sapoRuntimeSessions.id,'active'));assert.ok(!row!.encryptedCookie.includes('fixture-admin'));assert.equal(await decryptCookie(secret,row!.encryptedCookie),body.cookie);
 expired=true;const invalid=await f.call('/admin/sapo-session',f.mgr,'POST',body);assert.equal(invalid.status,503);assert.equal(invalid.data.code,'SAPO_SESSION_EXPIRED');
 assert.deepEqual(await f.db.select().from(sapoRuntimeSessions).where(eq(sapoRuntimeSessions.id,'active')),[row]);
});

test('ZIP tải từ CRM khớp ba file đã review, không kèm khoá/chứng thực hay dữ liệu riêng',async()=>{
 const {packageConnector}=await import(new URL('../../scripts/package-sapo-connector.mjs',import.meta.url).href);
 assert.deepEqual(readFileSync('trial-ui/sapo-connector.zip'),packageConnector());
});
