import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
export async function runHomeFlows({browser,origin,f,out,requests}) {
 const results=[];
 async function contextFor(id,width=1440,token=true){const c=await browser.newContext({viewport:{width,height:1000},locale:'vi-VN'});await c.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());if(token)await c.addInitScript(value=>{if(!localStorage.getItem('bn-v2-session'))localStorage.setItem('bn-v2-session',value);},f.cookies[id].split('=')[1]);const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));return{c,p,errors};}
 const ready=p=>p.waitForFunction(()=>document.querySelector('#view-home')?.dataset.ready==='true');
 for(const id of ['mgr','emp','wh','acct','counter','admin','restricted']) {
  const {c,p,errors}=await contextFor(id,id==='emp'?390:1440),start=requests.length;
  try{await p.goto(origin);await ready(p);await p.waitForTimeout(300);const actual=(await f.call('/tasks/home',f.cookies[id])).data;
   assert.equal(await p.locator('[data-home-stat=priority] b').textContent(),String(actual.counts.open));
   assert.equal(await p.locator('[data-home-stat=overdue] b').textContent(),String(actual.counts.overdue));
   if(id!=='mgr'){assert.equal(await p.locator('[data-home-stat=approvals]').count(),0);assert.doesNotMatch(await p.locator('#view-home').innerText(),/VIỆC RIÊNG KHÔNG ĐƯỢC LỘ/);assert.equal(requests.slice(start).some(r=>r.path==='/approvals'),false);}
   const permitted=await p.locator('.sidebar [data-nav]').evaluateAll(links=>links.filter(a=>!a.hidden&&!a.closest('[hidden]')).map(a=>a.getAttribute('href')));
   const links=await p.locator('[data-home-groups] nav a').evaluateAll(items=>items.map(a=>a.getAttribute('href')));assert.ok(links.every(h=>permitted.includes(h)));assert.equal(new Set(links).size,links.length);
   assert.equal(requests.slice(start).some(r=>/^\/(quotes\?|customers\?|admin\/members|catalog-snapshot)/.test(r.path)),false,'no unrelated full list at Home startup');
   assert.equal(await p.locator('.crm-mobile-nav').count(),1,'one footer only');
   if(id==='emp'){
    await p.locator('[data-home-bell]').click();assert.equal(await p.locator('#staff-bell .bell-panel').isVisible(),true,'Home opens the existing bell without an outside-click closing it');await p.locator('#staff-bell .bell').click();
    const before=requests.length;await p.locator('[data-home-search]').fill('bang luong');await p.waitForTimeout(60);assert.equal(requests.length,before);assert.match(await p.locator('[data-home-groups]').innerText(),/Không có chức năng/);await p.locator('[data-home-search]').fill('');
    await p.locator('[data-home-tab=overdue]').click();await p.waitForFunction(()=>document.querySelector('[data-home-work]').getAttribute('aria-busy')==='false');assert.equal(await p.locator('.home-task').count(),1);assert.match(await p.locator('.home-task').textContent(),/Xác nhận lịch giao hàng/);
    await p.locator('[data-home-all]').click();await p.waitForURL('**/#/tasks?home=1&view=mine&due=overdue');await p.locator('#tasks-list [data-task=home-late]').waitFor();assert.equal(await p.locator('#tasks-list [data-task=home-private]').count(),0);assert.equal(await p.locator('#tasks-list [data-task=home-today]').count(),0);
    await p.goto(origin+'/#/home');await ready(p);await p.locator('[data-home-actions] [data-home-action=new-quote]').click();await p.locator('#new-quote-dialog').waitFor({state:'visible'});await p.locator('#new-quote-dialog [data-close]').first().click().catch(async()=>p.keyboard.press('Escape'));
    await p.locator('[data-home-actions] [data-home-action=new-customer]').click();await p.locator('#customer-dialog').waitFor({state:'visible'});assert.equal(await p.locator('#customer-form [name=name]').getAttribute('required')!==null,true);await p.keyboard.press('Escape');
    await p.locator('[data-home-actions] [data-home-action=new-care]').click();await p.locator('dialog[open] .care-form').waitFor();await p.keyboard.press('Escape');
    await p.locator('[data-home-actions] [data-home-action=new-task]').click();await p.locator('#tasks-quick').waitFor({state:'visible'});await p.locator('#tasks-quick [name=title]').fill('Việc tạo từ Trang chủ');await p.locator('#tasks-quick [type=submit]').click();await p.waitForFunction(()=>document.querySelector('#tasks-list')?.textContent.includes('Việc tạo từ Trang chủ'));
    await p.goto(origin+'/#/home');await ready(p);assert.equal(await p.locator('[data-home-stat=priority] b').textContent(),String(actual.counts.open+1));
    const note=p.locator('[data-home-notice=home-note]');await note.waitFor();await note.click();await p.waitForURL('**/#/tasks/home-today');assert.equal((await f.call('/notifications',f.emp)).data.notifications.find(n=>n.id==='home-note').readAt!==null,true);
    await p.goto(origin+'/#/home');await ready(p);await p.screenshot({path:out+'/employee-mobile.png',fullPage:true});
   }
   if(id==='mgr'){
    await p.locator('[data-home-tab=approvals]').click();await p.waitForTimeout(100);assert.match(await p.locator('[data-home-work]').innerText(),/Không có hồ sơ/);
    const before=requests.length;await p.locator('[data-home-search]').fill('bang luong');await p.waitForTimeout(60);assert.equal(requests.length,before);assert.match(await p.locator('[data-home-groups]').innerText(),/Bảng lương/);await p.locator('[data-home-search]').fill('');
    await p.screenshot({path:out+'/manager-pc.png',fullPage:true});
   }
   if(id==='counter'){await p.locator('[data-home-actions] [data-home-action=pos]').click();await p.waitForURL('**/#/pos');await p.locator('#view-pos').waitFor({state:'visible'});}
   assert.deepEqual(errors,[]);results.push({role:id,countsMatchDatabase:true,scope:true,permissionGroups:true,lightStartup:true,errors});
  }catch(e){await p.screenshot({path:out+'/failure-'+id+'.png',fullPage:true});await writeFile(out+'/failure.json',JSON.stringify({id,error:e.message,errors,url:p.url(),requests:requests.slice(-15),quick:await p.locator('#tasks-quick').evaluate(n=>({text:n.textContent,assignee:n.elements.assigneeId?.value,htmlTitle:typeof n.title}))},null,2));throw e;}finally{await c.close();}
 }
 // Failure, request ordering and account changes use the same real APIs, with only response timing/failure injected.
 {
  const {c,p,errors}=await contextFor('emp',390);
  try {
   let failOnce=true;
   await p.route('**/api/staff/tasks/home?**',async route=>{if(failOnce){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Mất kết nối kiểm thử'})});}else await route.continue();});
   await p.goto(origin+'/#/home');await p.locator('[data-home-retry=tasks]').waitFor();assert.equal(await p.locator('[data-home-stat=priority] b').textContent(),'—');
   failOnce=false;await p.locator('[data-home-retry=tasks]').click();await ready(p);await p.unroute('**/api/staff/tasks/home?**');
   let release;const held=new Promise(resolve=>release=resolve);
   await p.route('**/api/staff/tasks/home?filter=overdue',async route=>{await held;await route.continue();});
   await p.locator('[data-home-tab=overdue]').click();await p.locator('[data-home-tab=today]').click();await p.waitForFunction(()=>document.querySelector('[data-home-work]').getAttribute('aria-busy')==='false'&&document.querySelector('[data-home-tab=today]').getAttribute('aria-selected')==='true');
   release();await p.waitForTimeout(200);assert.equal(await p.locator('[data-home-tab=today]').getAttribute('aria-selected'),'true');assert.doesNotMatch(await p.locator('[data-home-work]').innerText(),/Xác nhận lịch giao hàng/);
   await p.locator('#account-button-m').click();await p.locator('#logout').click();await p.locator('#auth').waitFor({state:'visible'});assert.equal(await p.locator('.bell-badge').isVisible(),false);
   await p.locator('#email').fill('restricted@x.vn');await p.locator('#password').fill('mat-khau-12345');await p.locator('#login-button').click();await ready(p);
   assert.equal(await p.locator('[data-home-stat=approvals]').count(),0);assert.doesNotMatch(await p.locator('#view-home').innerText(),/Thông báo kiểm thử|Xác nhận lịch giao hàng|VIỆC RIÊNG/);
   assert.equal((await f.call('/admin/members/restricted/approver',f.mgr,'PUT',{approver:true})).status,200);await p.reload();await p.locator('[data-home-stat=approvals]').waitFor();await ready(p);assert.doesNotMatch(await p.locator('[data-home-work]').innerText(),/VIỆC RIÊNG|Xác nhận lịch giao hàng/);
   assert.equal((await f.call('/approvals',f.cookies.restricted)).status,200);assert.equal((await f.call('/tasks/home',f.cookies.restricted)).data.scope,'mine');assert.deepEqual(errors,[]);
   results.push({failureRecovery:true,noFalseZero:true,latestResponseWins:true,logoutClears:true,accountBoundary:true,approverGrantDoesNotWidenTaskScope:true,errors});
  }catch(e){await p.screenshot({path:out+'/security-failure.png',fullPage:true});await writeFile(out+'/security-failure.json',JSON.stringify({error:e.message,errors,body:await p.locator('body').innerText(),requests:requests.slice(-20),serverApprover:(await f.call('/me',f.cookies.restricted)).data.user?.approver},null,2));throw e;}finally{await c.close();}
 }
 // A genuine login from a list opens Home; a document login preserves the intended document.
 for(const hash of ['#/quotes','#/tasks/home-late']){const{c,p,errors}=await contextFor('emp',390,false);try{await p.goto(origin+'/'+hash);await p.locator('#auth').waitFor({state:'visible'});await p.locator('#email').fill('emp@x.vn');await p.locator('#password').fill('mat-khau-12345');await p.locator('#login-button').click();if(hash==='#/quotes'){await ready(p);assert.equal(new URL(p.url()).hash,'#/home');}else{await p.waitForURL('**/#/tasks/home-late');await p.waitForFunction(()=>document.querySelector('#tasks-panel')?.textContent.includes('Xác nhận lịch giao hàng')||document.querySelector('dialog.task-dialog[open]')?.textContent.includes('Xác nhận lịch giao hàng'));}assert.deepEqual(errors,[]);results.push({loginHash:hash,correctDestination:true,errors});}finally{await c.close();}}
 await writeFile(out+'/flows.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}
