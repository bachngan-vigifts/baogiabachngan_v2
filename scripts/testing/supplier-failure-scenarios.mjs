/** Adverse-path browser tests. Local assets and synthetic identity responses only. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createReviewServer} from '../review-supplier-workspace.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=process.env.SUPPLIER_REVIEW_DIR||'/workspace/output/supplier-workspace-review';await mkdir(out,{recursive:true});
const server=createReviewServer().listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
const api='/api/review-staff',password='fixture-password-123',identity={id:'fixture-supplier',role:'supplier',positionId:'supplier',name:'NCC giả lập'};
async function scenario(name,config,check){
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors=[],external=[],calls=[];
 const state={authed:!!config.saved,loginCount:0,meCount:0,listCount:0,logoutCount:0,respondCount:0,responded:false,forgotCount:0};
 await context.addInitScript(({saved,blocked})=>{
  if(saved&&!sessionStorage.getItem('fixture-initialized')){localStorage.setItem('bn-v2-session','fixture-session');sessionStorage.setItem('fixture-initialized','yes');}
  if(blocked)for(const key of ['getItem','setItem','removeItem'])Storage.prototype[key]=()=>{throw new DOMException('Storage blocked','SecurityError');};
  window.challenge={renders:0,resets:0};window.turnstile={render(_node,options){challenge.options=options;challenge.renders++;options.callback('challenge-first');return 'fixture-widget';},reset(){challenge.resets++;challenge.options.callback('challenge-reset-'+challenge.resets);}};
 },{saved:config.saved,blocked:config.blocked});
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin){external.push(u.origin);return route.abort();}
  if(!u.pathname.startsWith(api+'/'))return route.continue();
  const path=u.pathname.slice(api.length);calls.push({path,method:route.request().method(),body:route.request().postDataJSON()});
  const json=(data,status=200)=>route.fulfill({status,json:data});
  if(path==='/auth-config')return config.configError?json({error:'Cấu hình tạm lỗi'},503):json({turnstileSiteKey:config.captcha?'fixture-key':''});
  if(path==='/me'){state.meCount++;if(config.readRetry&&state.meCount<3)return json({error:'Tạm quá tải'},503);if(!state.authed||config.expired)return json({error:'Phiên đăng nhập đã hết hạn.'},401);return json({user:{...identity,...config.user}});}
  if(path==='/login'){
   state.loginCount++;const body=route.request().postDataJSON();if(config.loginAbort&&state.loginCount===1)return route.abort();
   if(config.loginHtml)return route.fulfill({status:config.loginHtml,contentType:'text/html',body:'<html>Temporary upstream error</html>'});
   if(config.loginStatus)return json({error:config.loginStatus===429?'Đăng nhập quá nhiều lần. Vui lòng thử lại sau.':'Chưa xác minh chống bot.'},config.loginStatus);
   if(config.captcha&&!body.turnstileToken)return json({error:'Chưa xác minh chống bot.'},422);
   state.authed=true;return json({sessionToken:'fixture-session',ok:true});
  }
  if(path==='/supplier-portal/early-requests'){
   state.listCount++;if(config.list401)return config.list401==='html'?route.fulfill({status:401,contentType:'text/html',body:'<h1>Unauthorized</h1>'}):json({error:'Phiên đăng nhập đã hết hạn.'},401);
   if(config.unmapped)return json({error:'Tài khoản chưa được gắn với NCC đang hoạt động.'},403);
   const status=state.responded?'accepted':'pending';
   const request={id:'fixture-request',ticketNumber:'XH-FIXTURE',requestStatus:'submitted',status,createdAt:'2026-11-12T01:00:00Z',lines:[{id:'fixture-line',sku:'FIXTURE-01',name:config.malicious?'<img data-injected="yes" src=x>':'Sản phẩm kiểm thử',unit:'Cái',quantity:4,status,allocations:[{id:'fixture-allocation',supplierId:'a',supplierName:'NCC kiểm thử',orderId:'fixture-order',ticketNumber:'PO-FIXTURE',supplierOrderNo:'NCC-FIXTURE',quantity:4,status,due:'2026-11-15'}]}]};
   return json({requests:config.pending?[request]:[],canRespond:config.user?.role!=='manager'});
  }
  if(path==='/supplier-portal/early-requests/fixture-line/respond'){
   state.respondCount++;await new Promise(r=>setTimeout(r,100));if(config.respondAbort)return route.abort();
   if(config.respond401)return json({error:'Phiên đăng nhập đã hết hạn.'},401);
   if(config.respondConflict)return json({error:'Phiếu đã được xử lý. Vui lòng tải lại.'},409);
   state.responded=true;return json({ok:true});
  }
  if(path==='/logout'){state.logoutCount++;if(config.logoutError)return json({error:'Chưa đăng xuất được.'},503);state.authed=false;return json({sessionToken:'',ok:true});}
  if(path==='/forgot-password'){state.forgotCount++;await new Promise(r=>setTimeout(r,100));return json({ok:true,message:'Nếu email khớp tài khoản đang hoạt động, hệ thống sẽ gửi liên kết đặt lại mật khẩu.'});}
  return json({error:'Unexpected fixture route'},404);
 });
 const p=await context.newPage();p.setDefaultTimeout(3500);p.on('pageerror',e=>errors.push(e.message));
 const auth=()=>p.locator('#supplier-auth:not([hidden])').waitFor(),workspace=()=>p.locator('#supplier-workspace:not([hidden])').waitFor();
 const submit=async()=>{await p.locator('#login-name').fill('supplier@example.test');await p.locator('#login-password').fill(password);await p.locator('#login-form').evaluate(f=>f.requestSubmit());};
 try{await p.goto(origin+'/crm/supplier.html');await check({p,state,calls,auth,workspace,submit});assert.deepEqual(errors,[]);assert.deepEqual(external,[]);results.push({name,passed:true,requests:calls.map(c=>c.method+' '+c.path)});}
 catch(error){results.push({name,passed:false,error:error.message.split('\n').slice(0,3).join(' ')});}
 finally{await context.close();}
}
try{
 await scenario('Invalid email and short password do not POST',{},async({p,auth,state})=>{await auth();await p.locator('#login-name').fill('invalid');await p.locator('#login-password').fill('short');await p.locator('#login-form').evaluate(f=>f.requestSubmit());assert.equal(state.loginCount,0);});
 await scenario('Network error does not replay login; explicit retry succeeds',{loginAbort:true,captcha:true},async({p,auth,submit,state,workspace})=>{await auth();await submit();await p.locator('#supplier-auth-error').filter({hasText:'Mạng chập chờn'}).waitFor();assert.equal(state.loginCount,1);assert.equal(await p.locator('#login-submit').isEnabled(),true);await submit();await workspace();assert.equal(state.loginCount,2);});
 await scenario('Rate-limited login is not retried automatically',{loginStatus:429},async({p,auth,submit,state})=>{await auth();await submit();await p.locator('#supplier-auth-error').filter({hasText:'quá nhiều'}).waitFor();assert.equal(state.loginCount,1);assert.equal(await p.locator('#login-submit').isEnabled(),true);});
 await scenario('HTML 503 on login gives readable message and releases button',{loginHtml:503},async({p,auth,submit,state})=>{await auth();await submit();await p.locator('#supplier-auth-error').filter({hasText:/máy chủ|Máy chủ|Không thực hiện/}).waitFor();assert.equal(state.loginCount,1);assert.equal(await p.locator('#login-submit').isEnabled(),true);});
 await scenario('Malformed successful write reports unknown result without retry',{loginHtml:200},async({p,auth,submit,state})=>{await auth();await submit();await p.locator('#supplier-auth-error').filter({hasText:'chưa rõ máy chủ'}).waitFor();assert.equal(state.loginCount,1);assert.equal(await p.locator('#supplier-workspace').isHidden(),true);});
 await scenario('Valid saved session avoids login and captcha calls',{saved:true},async({workspace,state,calls})=>{await workspace();assert.equal(state.loginCount,0);assert.ok(!calls.some(c=>c.path==='/auth-config'));});
 await scenario('Expired saved session hides all business content',{saved:true,expired:true},async({p,auth})=>{await auth();assert.equal(await p.locator('#supplier-workspace').isHidden(),true);assert.equal(await p.locator('#supplier-startup').isHidden(),true);});
 await scenario('Read-only Manager still enters existing portal',{saved:true,user:{role:'manager',positionId:'manager'}},async({p,workspace})=>{await workspace();assert.ok((await p.locator('#supplier-who').textContent()).includes('Chỉ xem'));});
 await scenario('Employee remains outside supplier portal',{saved:true,user:{role:'employee',positionId:'sale'}},async({p,auth,state})=>{await auth();assert.equal(state.listCount,0);assert.equal(await p.locator('#supplier-workspace').isHidden(),true);});
 await scenario('Missing supplier mapping is visible and no supplier data shown',{saved:true,unmapped:true},async({p,workspace})=>{await workspace();await p.getByText('Tài khoản chưa được gắn với NCC đang hoạt động.',{exact:true}).waitFor();assert.equal(await p.locator('.early-request-card').count(),0);});
 await scenario('Expired challenge cannot silently mark login successful',{captcha:true},async({p,auth,submit,state})=>{await auth();await p.waitForFunction(()=>window.challenge.renders===1);await p.evaluate(()=>challenge.options['expired-callback']());await submit();await p.locator('#supplier-auth-error').filter({hasText:'Chưa xác minh'}).waitFor();assert.equal(state.loginCount,1);assert.equal(await p.locator('#supplier-workspace').isHidden(),true);});
 await scenario('Challenge is renewed when session expires after login',{captcha:true,list401:'json'},async({p,auth,submit,state})=>{await auth();await submit();await p.locator('#supplier-auth-error').filter({hasText:'hết hạn'}).waitFor();assert.equal(state.listCount,1);assert.ok(await p.evaluate(()=>challenge.resets>=1),'used challenge must be reset on return to auth');});
 await scenario('HTML 401 hides workspace just like JSON 401',{saved:true,list401:'html'},async({p,auth})=>{await auth();assert.equal(await p.locator('#supplier-workspace').isHidden(),true);});
 await scenario('Transient identity reads retry at most twice',{saved:true,readRetry:true},async({workspace,state})=>{await workspace();assert.equal(state.meCount,3);assert.equal(state.loginCount,0);});
 await scenario('Successful logout clears storage and returns to auth',{saved:true},async({p,auth,workspace,state})=>{await workspace();await p.locator('#logout').click();await auth();assert.equal(state.logoutCount,1);assert.equal(await p.evaluate(()=>localStorage.getItem('bn-v2-session')),null);assert.equal(await p.evaluate(()=>sessionStorage.getItem('bn-v2-session')),null);});
 await scenario('Failed logout is not replayed or falsely shown as success',{saved:true,logoutError:true},async({p,workspace,state})=>{await workspace();await p.locator('#logout').click();await p.locator('#supplier-error').filter({hasText:'Chưa đăng xuất'}).waitFor();assert.equal(state.logoutCount,1);assert.equal(await p.locator('#supplier-workspace').isVisible(),true);});
 await scenario('Blocked browser storage still permits in-memory login',{blocked:true},async({auth,submit,workspace,state})=>{await auth();await submit();await workspace();assert.equal(state.loginCount,1);});
 await scenario('Unavailable captcha config does not cause POST retries',{configError:true,loginStatus:422},async({p,auth,submit,state})=>{await auth();await submit();await p.locator('#supplier-auth-error').filter({hasText:'Chưa xác minh'}).waitFor();assert.equal(state.loginCount,1);});
 await scenario('Forgot-password uses supplier audience, generic message and one POST',{captcha:true},async({p,auth,state,calls})=>{await auth();await p.locator('#login-name').fill('supplier@example.test');await p.locator('#supplier-forgot-password').click();const dialog=p.getByRole('dialog',{name:'Quên mật khẩu',exact:true});assert.equal(await dialog.locator('input[type=email]').inputValue(),'supplier@example.test');await dialog.locator('form').evaluate(f=>{f.requestSubmit();f.requestSubmit();});await dialog.getByRole('status').filter({hasText:'Nếu email khớp'}).waitFor();assert.equal(state.forgotCount,1);const body=calls.find(c=>c.path==='/forgot-password').body;assert.equal(body.audience,'supplier');assert.equal(typeof body.turnstileToken,'string');await dialog.getByRole('button',{name:'Đóng',exact:true}).click();assert.equal(await dialog.count(),0);});
 await scenario('Double-click supplier confirmation sends exactly one POST',{saved:true,pending:true},async({p,workspace,state})=>{await workspace();const accept=p.getByRole('button',{name:'Đồng ý mã FIXTURE-01',exact:true});await accept.evaluate(b=>{b.click();b.click();});await p.locator('.early-status-accepted').waitFor();assert.equal(state.respondCount,1);assert.equal(await accept.count(),0);});
 await scenario('Response network failure never replays a business write',{saved:true,pending:true,respondAbort:true},async({p,workspace,state})=>{await workspace();await p.getByRole('button',{name:'Đồng ý mã FIXTURE-01',exact:true}).click();await p.locator('.early-request-line .error').filter({hasText:'chưa rõ máy chủ'}).waitFor();assert.equal(state.respondCount,1);assert.equal(state.responded,false);});
 await scenario('Expired session while confirming hides all supplier rows',{saved:true,pending:true,respond401:true},async({p,workspace,auth,state})=>{await workspace();await p.getByRole('button',{name:'Đồng ý mã FIXTURE-01',exact:true}).click();await auth();assert.equal(await p.locator('#supplier-workspace').isHidden(),true);assert.equal(state.respondCount,1);assert.equal(state.responded,false);});
 await scenario('409 response conflict is shown instead of a success state',{saved:true,pending:true,respondConflict:true},async({p,workspace,state})=>{await workspace();await p.getByRole('button',{name:'Đồng ý mã FIXTURE-01',exact:true}).click();await p.locator('.early-request-line .error').filter({hasText:'đã được xử lý'}).waitFor();assert.equal(state.respondCount,1);assert.equal(state.responded,false);});
 await scenario('Supplier product name is text rather than executable HTML',{saved:true,pending:true,malicious:true},async({p,workspace})=>{await workspace();await p.locator('.early-request-line b').filter({hasText:'<img'}).waitFor();assert.equal(await p.locator('[data-injected]').count(),0);});
 await scenario('Review URL date payload cannot create HTML attributes',{},async({p})=>{for(const key of ['from','to','asOf']){await p.goto(origin+'/#'+(key==='asOf'?'balances':'orders')+'?'+key+'='+encodeURIComponent('2026-11-01" data-injected="yes'));assert.equal(await p.locator('[data-injected]').count(),0);}});
 await scenario('Editing an already-previewed form clears stale success',{},async({p})=>{await p.goto(origin+'/#advances');await p.locator('[data-primary]').click();await p.locator('#action-source').selectOption('order-0');await p.locator('#action-amount').fill('100');await p.locator('#review-action').evaluate(f=>f.requestSubmit());await p.locator('#action-result').filter({hasText:'hợp lệ'}).waitFor();await p.locator('#action-amount').fill('999999999');assert.equal(await p.locator('#action-result').textContent(),'');});
 await scenario('Fast navigation cancels pending search updates',{},async({p})=>{await p.goto(origin+'/#products');await p.locator('#f-q').fill('binh');await p.goto(origin+'/#stock');await p.waitForTimeout(180);assert.equal(await p.locator('h1').textContent(),'Kiểm tồn');assert.equal(await p.locator('#f-q').inputValue(),'');});
 await scenario('Filter URL survives reload and navigation to other pages',{},async({p})=>{await p.goto(origin+'/#orders');await p.locator('[data-toggle-filters]').click();await p.locator('#f-status').selectOption('confirmed');const before=await p.locator('#records tbody tr').count();await p.reload();assert.equal(await p.locator('#records tbody tr').count(),before);await p.goto(origin+'/#products');await p.goto(origin+'/#orders');assert.equal(await p.locator('#f-status').inputValue(),'confirmed');});
 await scenario('Unknown detail ID never shows another record',{},async({p})=>{await p.goto(origin+'/#orders?detail=other-supplier-record');assert.equal(await p.locator('.detail').count(),0);assert.ok(await p.locator('#records tbody tr').count());});
 await scenario('Small and landscape screens retain visible popup controls',{},async({p})=>{for(const [width,height]of [[320,568],[844,390]]){await p.setViewportSize({width,height});await p.goto(origin+'/#orders');assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await p.locator('[data-open]').first().click();assert.equal(await p.locator('.detail-foot').evaluate(n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1;}),true);await p.keyboard.press('Escape');}});
 console.log(JSON.stringify(results));assert.equal(results.filter(r=>!r.passed).length,0,'Adverse scenarios failed');
}finally{await writeFile(out+'/failure-scenarios.json',JSON.stringify(results,null,2));await browser.close();server.close();}
