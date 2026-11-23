import {chromium} from '/tmp/qv-info/node_modules/playwright/index.mjs';
const browser=await chromium.launch();
try{
 const page=await browser.newPage();
 await page.route('**/*',r=>['GET','HEAD'].includes(r.request().method())?r.continue():r.abort());
 await page.goto('https://locknlockonline.com/',{waitUntil:'domcontentloaded',timeout:90000});
 await page.waitForTimeout(3000);
 console.log('PUBLIC_INFO',JSON.stringify(await page.evaluate(()=>({
  candidates:Array.from(document.querySelectorAll('[id*="voucher"],[id*="coupon"],[class*="voucher"],[id="lnl-ship-tip"]')).slice(0,35).map(n=>({tag:n.tagName,id:n.id,class:n.className,text:n.textContent.slice(0,7000),html:n.outerHTML.slice(0,14000)})),
  links:Array.from(document.querySelectorAll('a[href]')).filter(a=>/vận chuyển|giỏ hàng|voucher/i.test(a.textContent)).map(a=>({text:a.textContent,url:a.href})).slice(0,20),
  scripts:Array.from(document.scripts).filter(s=>/voucher|coupon/i.test(s.textContent)).map(s=>({id:s.id,src:s.src,context:s.textContent.slice(Math.max(0,s.textContent.search(/voucher|coupon/i)-150),Math.max(0,s.textContent.search(/voucher|coupon/i)-150)+2000)}))
 }))));
}finally{await browser.close();}
