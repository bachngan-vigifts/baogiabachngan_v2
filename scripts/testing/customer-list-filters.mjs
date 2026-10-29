/** Offline regression for real customer filter markup + mobile sheet; never contacts production. */
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const html=await readFile(new URL('../../trial-ui/index.html',import.meta.url),'utf8');
const start=html.lastIndexOf('<section',html.indexOf('id="view-customers"'));
const section=html.slice(start,html.indexOf('</section>',start)+10).replace(' hidden','');
const out=process.env.CUSTOMER_FILTER_SCREENSHOTS||'/workspace/scratch/customer-list-filters';await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try {for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/')return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/mobile-design.css"><style>body{padding:12px}#view-customers{display:block}</style><div id="workspace">${section}</div>
  <script type="module">
   import {customerListQuery,fillCustomerOwners,bindCustomerListFilters} from '/customer-list-filters.js';
   import {installMobileDesign} from '/mobile-design.js';import {mobileProfilesP1} from '/mobile-profiles-p1.js';
   const $=s=>document.querySelector(s);window.requests=[];
   async function load(){const q=customerListQuery($,{limit:50,offset:0,query:$('#customer-search').value});requests.push(q);
    fillCustomerOwners($('#customer-owner'),[{id:'emp',name:'Châu Yến'},{id:'new',name:'Nguyễn Xuân Hoa'}]);
    const owner=$('#customer-owner').value;const rows=[['emp','Khách An'],['new','Khách Bình']].filter(r=>!owner||r[0]===owner);
    $('#customer-list').innerHTML=rows.map(r=>'<tr><td>'+r[1]+'</td><td>Liên hệ</td><td>0900000000</td><td>—</td><td>'+r[0]+'</td><td>1</td><td><button>Báo giá</button></td></tr>').join('');$('#customer-count').textContent=rows.length+' khách hàng';$('#view-customers').dataset.resultCount=rows.length;
   }
   bindCustomerListFilters($,load);await load();installMobileDesign(mobileProfilesP1.filter(p=>p.root==='#view-customers'));window.ready=true;
  </script>`});
  if(/\.(css|js)$/.test(path)){try{return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':'text/css',body:await readFile(new URL('../../trial-ui'+path,import.meta.url),'utf8')});}catch{}}
  return route.abort();
 });
 await page.goto('https://crm.test/');await page.waitForFunction(()=>window.ready);
 const count=()=>page.evaluate(()=>requests.length);
 if(width<850)await page.getByRole('button',{name:'Lọc khách hàng',exact:true}).click();
 const before=await count();await page.locator('#customer-owner').selectOption('emp');
 await page.locator('#customer-from').fill('2026-10-29');await page.locator('#customer-sort').selectOption('name-asc');
 if(width<850){assert.equal(await count(),before,'editing sheet does not apply');await page.screenshot({path:out+'/390-sheet.png'});await page.locator('.crm-filter-foot .primary').click();}
 await page.waitForFunction(()=>new URLSearchParams(requests.at(-1)).get('owner')==='emp');
 const query=await page.evaluate(()=>Object.fromEntries(new URLSearchParams(requests.at(-1))));assert.equal(query.sort,'name-asc');assert.equal(query.from,'2026-10-29');assert.equal(query.filters,'1');
 assert.equal(await page.locator('#customer-list tr').count(),1);
 await page.screenshot({path:out+'/'+width+'.png',fullPage:true});
 if(width<850){await page.getByRole('button',{name:'Lọc khách hàng',exact:true}).click();const beforeCancel=await count();await page.locator('#customer-owner').selectOption('new');await page.getByRole('button',{name:'Đóng bộ lọc',exact:true}).click();assert.equal(await page.locator('#customer-owner').inputValue(),'emp');assert.equal(await count(),beforeCancel);
  await page.getByRole('button',{name:'Lọc khách hàng',exact:true}).click();await page.locator('.crm-filter-foot .secondary').click();await page.locator('.crm-filter-foot .primary').click();
 }else await page.locator('#customer-clear').click();
 await page.waitForFunction(()=>!new URLSearchParams(requests.at(-1)).get('owner'));
 assert.equal(await page.locator('#customer-list tr').count(),2);assert.equal(await page.locator('#customer-from').inputValue(),'');assert.equal(await page.locator('#customer-sort').inputValue(),'newest');
 await page.evaluate(()=>document.activeElement?.blur());
 await page.setViewportSize({width:width<850?1280:390,height:1000});
 if(width<850)await page.locator('#customer-owner').waitFor({state:'visible'});else await page.getByRole('button',{name:'Lọc khách hàng',exact:true}).waitFor({state:'visible'});
 assert.deepEqual(errors,[]);console.log('PASS customer filters '+width+'px: apply, payload, clear, cancel, resize');await page.close();
}}finally{await browser.close();}
