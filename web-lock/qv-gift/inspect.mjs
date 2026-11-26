import {chromium} from '/tmp/qv-info/node_modules/playwright/index.mjs';
const b=await chromium.launch();const p=await b.newPage();
await p.goto('https://locknlockonline.com/',{waitUntil:'domcontentloaded',timeout:90000});await p.waitForTimeout(5000);
const url=await p.locator('.product-small .name a').first().getAttribute('href');
await p.goto(url,{waitUntil:'domcontentloaded',timeout:90000});await p.waitForTimeout(4000);
console.log('PRODUCT',p.url());
console.log('SUMMARY',await p.locator('.product-info.summary').innerText());
console.log('PROMO',JSON.stringify(await p.locator('.product-info.summary').evaluate(root=>Array.from(root.querySelectorAll('div,section,aside,span')).filter(e=>/tặng|quà|BLACK FRIDAY/i.test(e.textContent)&&e.textContent.length<1500).map(e=>e.outerHTML.slice(0,5000)))));
await b.close();