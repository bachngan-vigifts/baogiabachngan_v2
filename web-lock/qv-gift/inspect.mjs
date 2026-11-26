import {chromium} from '/tmp/qv-info/node_modules/playwright/index.mjs';
const b=await chromium.launch();const p=await b.newPage();
await p.goto('https://locknlockonline.com/',{waitUntil:'domcontentloaded',timeout:90000});await p.waitForTimeout(5000);
console.log('GIFT_PUBLIC',JSON.stringify(await p.evaluate(()=>Array.from(document.querySelectorAll('div,aside,section,template')).filter(e=>/quà tặng|tặng kèm|tặng.*đơn|BLACK FRIDAY/i.test(e.textContent)&&e.textContent.length<2500).map(e=>e.outerHTML.slice(0,5000)).slice(-35))));
console.log('GIFT_SCRIPTS',JSON.stringify(await p.evaluate(()=>Array.from(document.scripts).filter(e=>/gift|quà tặng|BLACK FRIDAY/i.test(e.textContent)).map(e=>({id:e.id,text:e.textContent.slice(0,10000)})))));
await b.close();