import assert from 'node:assert/strict';
import {PASSWORD} from '../../tests/helpers/staff-fixture.ts';
export async function dashboardReportFlows({browser,origin,f,user,fixed,out,apiRequests}){
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:1100},locale:'vi-VN'});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:f.mgr.split('=')[1]});
  const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.clock.setFixedTime(new Date('2026-11-09T09:00:00+07:00'));
  try{
   await p.route('**/api/staff/dashboard/report-scores?**',async route=>{await new Promise(r=>setTimeout(r,1200));await route.continue();});
   const initialDone=p.waitForResponse(r=>r.url().includes('/dashboard/report-scores?')&&r.status()===200);
   await p.goto(origin+'/#/dashboard');const month=p.getByLabel('Tháng xem KPI và báo cáo',{exact:true}),card=p.locator('.dash-kpi-card'),reports=card.locator('.dash-report-card');
   await card.locator('.dash-kpi-main').waitFor();assert.equal(await reports.locator('[aria-busy="true"]').count(),1,'slow reports never collapse an already loaded KPI');await initialDone;await p.unroute('**/api/staff/dashboard/report-scores?**');
   assert.equal(await p.locator('.dash-filters [data-months="1"]').getAttribute('aria-pressed'),'true');assert.equal(await p.locator('.dash-filters [name=from]').inputValue(),'2026-11');assert.equal(await p.locator('.dash-filters [name=to]').inputValue(),'2026-11');await p.locator('.dash-filters [data-months="6"]').click();
   await month.locator('option[value="2026-11"]').waitFor({state:'attached'});await month.selectOption('2026-11');await card.locator('[data-score-member=emp]').click();
   await reports.locator('[data-report-stat=points]').getByText('3,5 / 5 điểm',{exact:true}).waitFor();await card.locator('.dash-kpi-main').waitFor();
   assert.equal(await reports.locator('[data-report-stat]').count(),4);assert.equal(await reports.locator('[data-report-stat=pending] strong').textContent(),'1');
   assert.equal(await card.evaluate(n=>n.parentElement.firstElementChild===n),true,'combined score card stays first');
   const before=apiRequests.length,kpi=await card.locator('.dash-donut-value').textContent();
   await card.locator('[data-score-member=new]').getByText('1 / 5 điểm',{exact:true}).waitFor();assert.match(await card.locator('[data-score-member=new]').innerText(),/Tuần 0\/4 đã nộp/);await card.locator('[data-score-member=new]').click();await reports.locator('[data-report-stat=points]').getByText('1 / 5 điểm',{exact:true}).waitFor();assert.equal(await card.locator('.dash-kpi-main').count(),0,'report-only employee never inherits another person KPI');assert.equal(await reports.locator('details').evaluate(n=>n.open),true);assert.doesNotMatch(await card.innerText(),/chưa có KPI Sale/);await reports.locator('summary').first().click();assert.equal(await reports.locator('details').evaluate(n=>n.open),false);await card.locator('[data-score-member=emp]').click();await card.locator('[data-score-member=new]').click();assert.equal(await reports.locator('details').evaluate(n=>n.open),false,'respect manual collapse on returning to the same member/month');
   await card.locator('[data-score-member=emp]').click();assert.equal(await card.locator('.dash-donut-value').textContent(),kpi);assert.equal(apiRequests.length,before,'employee selection reuses authorized projections without another API request');
   let release;const held=new Promise(r=>release=r);await p.route('**/api/staff/dashboard/kpi?**',async route=>{if(new URL(route.request().url()).searchParams.get('month')==='2026-10')await held;await route.continue();});
   await month.selectOption('2026-10');await month.selectOption('2026-11');await reports.locator('[data-report-stat=points]').getByText('3,5 / 5 điểm',{exact:true}).waitFor();release();await p.waitForTimeout(1000);assert.equal(await month.inputValue(),'2026-11');assert.equal(await card.locator('.dash-donut-value').textContent(),kpi);await p.unroute('**/api/staff/dashboard/kpi?**');
   await p.locator('.dash-filters select[name=owner]').selectOption('new');await reports.locator('.dash-kpi-name').getByText('Tên new',{exact:true}).waitFor();assert.equal(await card.locator('[data-score-member=emp]').count(),0);assert.equal(await card.locator('.dash-kpi-main').count(),0);
   await p.locator('.dash-filters select[name=owner]').selectOption('');await card.locator('[data-score-member=emp]').click();await reports.locator('[data-report-stat=points]').getByText('3,5 / 5 điểm',{exact:true}).waitFor();
   let fail=true;await p.route('**/api/staff/dashboard/report-scores?**',route=>fail?route.fulfill({status:503,contentType:'application/json',body:'{"error":"Lỗi mạng kiểm thử"}'}):route.continue());
   await p.locator('#view-dashboard .report-cache button').click();await reports.getByRole('button',{name:'Thử lại',exact:true}).waitFor();assert.equal(await reports.locator('[data-report-stat]').count(),0,'failure never becomes a zero report score');await card.locator('.dash-kpi-main').waitFor();
   fail=false;await reports.getByRole('button',{name:'Thử lại',exact:true}).click();await reports.locator('[data-report-stat=points]').getByText('3,5 / 5 điểm',{exact:true}).waitFor();await p.unroute('**/api/staff/dashboard/report-scores?**');
   await p.route('**/api/staff/dashboard/kpi?**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"Lỗi KPI kiểm thử"}'}));await p.locator('#view-dashboard .report-cache button').click();await card.locator('.dash-kpi').getByRole('button',{name:'Thử lại',exact:true}).waitFor();await reports.locator('[data-report-stat=points]').getByText('3,5 / 5 điểm',{exact:true}).waitFor();assert.equal(await card.locator('.dash-donut-value').count(),0);
   await p.unroute('**/api/staff/dashboard/kpi?**');await card.locator('.dash-kpi').getByRole('button',{name:'Thử lại',exact:true}).click();await card.locator('.dash-donut-value').waitFor();assert.equal(await card.locator('.dash-donut-value').textContent(),kpi);
   assert.equal(await reports.getByRole('link',{name:'Xem báo cáo tháng',exact:true}).getAttribute('href'),'#/monthly-reports?month=2026-11');assert.deepEqual(errors,[]);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);
   await card.screenshot({path:out+'/combined-'+width+'.png'});console.log(JSON.stringify({width,linkedPersonAndMonth:true,slowReportKeepsKpi:true,noExtraCallsOnPersonSwitch:true,reportOnlyEmployee:true,filterClearsPriorPerson:true,latestMonthWins:true,independentErrorsAndRetries:true,noFalseZero:true,errors}));
  }catch(e){await p.screenshot({path:out+'/failure-'+width+'.png',fullPage:true});console.log(JSON.stringify({message:e.message,errors,body:await cardText(p),apiRequests:apiRequests.slice(-12)}));throw e;}finally{await context.close();}
 }
 // A Sale Admin without a salary profile must see their own reports on entry, without a KPI request.
 await f.client.query('delete from hr_salary_profiles where member_id=$1',['new']);
 const login=await f.call('/login','','POST',{email:'new@x.vn',password:PASSWORD});assert.equal(login.status,200);const cookie=login.cookie;
 const own=(await f.call('/dashboard/report-scores?from=2026-11&to=2026-11&refresh=1',cookie)).data;
 assert.deepEqual(own.members.map(p=>p.id),['new']);assert.equal((await f.call('/dashboard/report-scores?from=2026-11&to=2026-11&owner=emp',cookie)).status,403);
 const adminUser=(await f.call('/me',cookie)).data.user;
 for(const width of [1440,390]){
  const c=await browser.newContext({viewport:{width,height:1100},locale:'vi-VN'});await c.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  await c.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user:adminUser,token:cookie.split('=')[1]});
  const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.clock.setFixedTime(new Date('2026-11-09T09:00:00+07:00'));const before=apiRequests.length;
  try{
   await p.goto(origin+'/#/dashboard');const card=p.locator('.dash-kpi-card'),reports=card.locator('.dash-report-card'),points=reports.locator('[data-report-stat=points]');await points.getByText('1 / 5 điểm',{exact:true}).waitFor();
   assert.match(await card.locator('h2').textContent(),/Sale Admin/);assert.equal(await card.locator('.dash-kpi-main').count(),0);assert.doesNotMatch(await card.innerText(),/chưa có KPI Sale|Đang tính KPI/);assert.equal(await reports.locator('[data-report-stat]').count(),4);assert.equal(await reports.locator('details').evaluate(n=>n.open),true);
   assert.equal(await p.locator('.dash-filters [data-months="1"]').getAttribute('aria-pressed'),'true');assert.equal(await p.locator('.dash-filters [name=from]').inputValue(),'2026-11');assert.equal(await p.locator('.dash-filters [name=to]').inputValue(),'2026-11');
   for(const [n,from]of [[3,'2026-09'],[6,'2026-06'],[12,'2025-12'],[1,'2026-11']]){await p.locator('.dash-filters [data-months="'+n+'"]').click();await points.getByText('1 / 5 điểm',{exact:true}).waitFor();assert.equal(await p.locator('.dash-filters [name=from]').inputValue(),from);assert.equal(await p.locator('.dash-filters [name=to]').inputValue(),'2026-11');assert.equal(await p.locator('.dash-filters [data-months="'+n+'"]').getAttribute('aria-pressed'),'true');}
   await reports.locator('summary').first().click();await p.locator('#view-dashboard .report-cache button').click();await points.getByText('1 / 5 điểm',{exact:true}).waitFor();assert.equal(await reports.locator('details').evaluate(n=>n.open),false,'refresh respects manual collapse');
   assert.equal(apiRequests.slice(before).some(path=>path.startsWith('/dashboard/kpi?')),false,'reports never wait for payroll KPI');assert.deepEqual(errors,[]);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);await reports.locator('summary').first().click();await reports.screenshot({path:out+'/sale-admin-ready-'+width+'.png'});
   console.log(JSON.stringify({width,role:'sale-admin',noSalaryProfile:true,reportsReadyOnEntry:true,defaultThisMonth:true,manualPresetsWork:true,noPayrollKpiRequest:true,ownReportOnly:true,detailsOpenByDefault:true,manualCollapsePreserved:true,errors}));
  }catch(e){console.log(JSON.stringify({error:e.message,errors,body:await cardText(p)}));throw e;}finally{await c.close();}
 }

 // Same-tab account changes must not retain the Manager's hidden employee/month filters.
 {
  const c=await browser.newContext({viewport:{width:390,height:1100},locale:'vi-VN'});await c.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  await c.addInitScript(({user,token})=>{if(!localStorage.getItem('bn-v2-session')){localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));}},{user,token:f.mgr.split('=')[1]});
  const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.clock.setFixedTime(new Date('2026-11-09T09:00:00+07:00'));
  try{
   await p.goto(origin+'/#/dashboard');await p.locator('[data-report-stat=points]').getByText('3,5 / 5 điểm',{exact:true}).waitFor();await p.locator('.dash-filters [data-months="6"]').click();await p.locator('.dash-filters [name=owner]').selectOption('emp');await p.locator('[data-report-stat=points]').getByText('3,5 / 5 điểm',{exact:true}).waitFor();
   await p.locator('#account-button-m').click();await p.locator('#logout').click();await p.locator('#auth').waitFor({state:'visible'});await p.locator('#email').fill('new@x.vn');await p.locator('#password').fill(PASSWORD);await p.locator('#login-button').click();await p.locator('#view-home').waitFor({state:'visible'});
   await p.goto(origin+'/#/dashboard');await p.locator('[data-report-stat=points]').getByText('1 / 5 điểm',{exact:true}).waitFor();assert.equal(await p.locator('.dash-filters [name=owner]').inputValue(),'');assert.equal(await p.locator('.dash-filters [name=group]').inputValue(),'');assert.equal(await p.locator('.dash-filters [name=from]').inputValue(),'2026-11');assert.equal(await p.locator('.dash-filters [data-months="1"]').getAttribute('aria-pressed'),'true');assert.doesNotMatch(await p.locator('.dash-kpi-card').innerText(),/Tên emp|3,5 \/ 5 điểm/);assert.deepEqual(errors,[]);
   console.log(JSON.stringify({sameTabAccountSwitch:true,noHiddenManagerFilters:true,noPreviousViewerScores:true,newViewerDefaultsThisMonth:true,errors}));
  }catch(e){console.log(JSON.stringify({error:e.message,errors,body:await p.locator('body').innerText()}));throw e;}finally{await c.close();}
 }

}
async function cardText(p){return p.locator('.dash-kpi-card').innerText().catch(()=>'');}
