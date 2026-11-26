import {chromium} from '/tmp/qv-info/node_modules/playwright/index.mjs';
const b=await chromium.launch();const p=await b.newPage();
for(const url of ['https://minhlongonline.com/','https://minhlongonline.com/san-pham/noi-duong-sinh-ceres-kim-sa-thap-healthycook/']){
const r=await p.goto(url,{waitUntil:'domcontentloaded',timeout:90000});await p.waitForTimeout(5000);
console.log('PAGE',r.status(),p.url(),await p.title(),(await p.locator('body').innerText()).slice(0,16000));
console.log('GIFT_HTML',JSON.stringify(await p.evaluate(()=>Array.from(document.querySelectorAll('div,section,aside,span,template')).filter(e=>/quà tặng|Gourmet|BLACK FRIDAY/i.test(e.textContent)&&e.textContent.length<1800).map(e=>e.outerHTML.slice(0,6000)).slice(0,40))));
}
await b.close();