import {chromium} from 'playwright';
const browser=await chromium.launch();
try{
const context=await browser.newContext({viewport:{width:1484,height:1004}}),page=await context.newPage(),origin='https://minhlongonline.com';
await page.goto(origin+'/?preorder_public_check='+process.env.GITHUB_RUN_ID,{waitUntil:'domcontentloaded',timeout:90000});
await page.waitForTimeout(5000);
for(let i=0;i<3&&await page.locator('.mfp-close:visible').count();i++){await page.locator('.mfp-close:visible').last().click();await page.waitForTimeout(400);}
const quick=page.locator('a.quick-view[data-prod="33570"]').first();await quick.locator('xpath=ancestor::div[contains(@class,"box-image")]').hover();await quick.click();
const notice=page.locator('.mfp-content .mlpo-notice');await notice.waitFor({state:'visible'});
const buy=page.locator('.mfp-content .ml-popup-buy-now');
await page.waitForFunction(()=>document.querySelector('.mfp-content .ml-popup-buy-now')?.textContent.includes('ĐẶT TRƯỚC'));
await buy.scrollIntoViewIfNeeded();
await buy.click({trial:true});
await page.screenshot({path:'ml-preorder-public-quickview.png'});
await Promise.all([page.waitForURL('**/thanh-toan/**',{waitUntil:'domcontentloaded',timeout:60000}),buy.click()]);
await page.locator('[data-mlpo-only="1"]').waitFor({state:'visible'});
const cart=await (await context.request.get(origin+'/wp-json/wc/store/v1/cart')).json();
if(cart.items.length!==1||cart.items[0].id!==33570||Number(cart.items[0].totals.line_total)!==889380)throw Error('Unexpected public Buy Now cart');
console.log('PUBLIC_PREORDER_BUY_NOW_OK price=889380 quantity=1');
await page.locator('[data-mlpo-only="1"]').scrollIntoViewIfNeeded();await page.screenshot({path:'ml-preorder-public-checkout.png'});
console.log('PUBLIC_PREORDER_VERIFIED; no order submitted');
}finally{await browser.close();}
