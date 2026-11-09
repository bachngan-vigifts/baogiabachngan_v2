import assert from 'node:assert/strict';
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
   await month.locator('option[value="2026-11"]').waitFor({state:'attached'});await month.selectOption('2026-11');await card.locator('[data-score-member=emp]').click();
   await reports.locator('[data-report-stat=points]').getByText('3,5 / 5 điểm',{exact:true}).waitFor();await card.locator('.dash-kpi-main').waitFor();
   assert.equal(await reports.locator('[data-report-stat]').count(),4);assert.equal(await reports.locator('[data-report-stat=pending] strong').textContent(),'1');
   assert.equal(await card.evaluate(n=>n.parentElement.firstElementChild===n),true,'combined score card stays first');
   const before=apiRequests.length,kpi=await card.locator('.dash-donut-value').textContent();
   await card.locator('[data-score-member=new]').click();await reports.locator('[data-report-stat=points]').getByText('1 / 5 điểm',{exact:true}).waitFor();assert.equal(await card.locator('.dash-kpi-main').count(),0,'report-only employee never inherits another person KPI');
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
}
async function cardText(p){return p.locator('.dash-kpi-card').innerText().catch(()=>'');}
