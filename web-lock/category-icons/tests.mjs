import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const php=readFileSync('web-lock/category-icons/lnl-home-category-icons.php','utf8');
const css=php.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
const raw=php.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
const slugs=['binh-giu-nhiet','hop-com-giu-nhiet','hop-thuy-tinh','thiet-bi-gia-dung','thiet-bi-nha-bep','lam-dep-suc-khoe','do-dung-sinh-hoat','bep-dien-tu-bep-hong-ngoai'];
const src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="25" height="25"><rect width="25" height="25" fill="blue"/></svg>');
const script=raw.replace(/<\?php[\s\S]*?\?>/,JSON.stringify(Object.fromEntries(slugs.map(s=>[s,src]))));
const browser=await chromium.launch();
try{
 for(const width of [1360,390]){
 const page=await browser.newPage({viewport:{width,height:900}});
 await page.setContent('<html><head><meta charset="utf-8"><style>'+css+'</style></head><body class="home"><div class="MenuInBanner">'+slugs.map(s=>'<a class="ux-menu-link__link" href="https://locknlockonline.com/danh-muc/'+s+'/">'+s+'</a>').join('')+'</div><a class="ux-menu-link__link" href="https://locknlockonline.com/danh-muc/binh-giu-nhiet/">Outside menu</a></body></html>');
 await page.addScriptTag({content:script});
 if(width===1360){await page.waitForFunction(()=>document.querySelectorAll('.lnl-has-product-icon').length===8);assert.equal(await page.locator('.lnl-category-product-icon').count(),8);}
 else assert.equal(await page.locator('.lnl-category-product-icon').count(),0);
 assert.equal(await page.locator('body > a img').count(),0);
 console.log('ICON_SCOPE_OK '+width);
 await page.close();
 }
}finally{await browser.close();}
