import {chromium} from '/tmp/qv-info/node_modules/playwright/index.mjs';
const b=await chromium.launch();const p=await b.newPage();
for(const url of ['https://minhlongonline.com/','https://minhlongonline.com/san-pham/noi-duong-sinh-ceres-kim-sa-thap-healthycook/']){
await p.goto(url,{waitUntil:'domcontentloaded',timeout:90000});
console.log('GIFT_SOURCE',url,JSON.stringify(await p.evaluate(()=>Array.from(document.querySelectorAll('[id*="gift"],[class*="gift"],[class*="promo"],[id*="promo"]')).filter(e=>!['SCRIPT','STYLE'].includes(e.tagName)).map(e=>({tag:e.tagName,id:e.id,cls:e.className,html:e.outerHTML.slice(0,16000)})).slice(0,35))));
}
await b.close();
