import {chromium} from 'playwright';
const browser=await chromium.launch();
try{
for(const [host,pid] of [['minhlongonline.com','21035'],['locknlockonline.com','19320']]){
 const ctx=await browser.newContext({viewport:{width:390,height:844}}),page=await ctx.newPage();
 const add=await ctx.request.post('https://'+host+'/?wc-ajax=add_to_cart',{timeout:90000,form:{product_id:pid,quantity:'1'}});if((await add.json()).error)throw Error('Cannot create isolated guest cart');
 await page.goto('https://'+host+'/thanh-toan/',{waitUntil:'domcontentloaded',timeout:90000});
 await page.waitForTimeout(3000);
 const info=await page.evaluate(()=>{
 const form=document.querySelector('form.checkout');
 const desc=e=>({tag:e.tagName,id:e.id,cls:e.className});
 const parents=e=>{let a=[];for(let p=e?.parentElement;p&&a.length<4;p=p.parentElement)a.push(desc(p));return a;};
 return {
 form:form?desc(form):null,
 sections:['#customer_details','#order_review','#payment','#place_order','#order_review_heading','#lnl-shipping-eta'].map(s=>({selector:s,el:document.querySelector(s)?desc(document.querySelector(s)):null,parents:parents(document.querySelector(s))})),
 fields:[...form.querySelectorAll('input:not([type=hidden]),select,textarea')].map(e=>({id:e.id,name:e.name,type:e.type,required:e.required,wrapper:e.closest('.form-row')?.className,label:e.closest('.form-row')?.querySelector('label')?.textContent?.trim(),visible:!!e.getClientRects().length})),
 review:document.querySelector('#order_review')?.innerHTML.replace(/<script\b[\s\S]*?<\/script>/gi,'').replace(/value="[^"]*"/g,'value="[omitted]"').replace(/data-[\w-]*nonce="[^"]*"/g,'').slice(0,22000),
 images:[...document.querySelectorAll('#header img')].map(e=>({src:e.src,alt:e.alt})),
 invoice:[...form.querySelectorAll('[class*="invoice"]')].slice(0,12).map(desc)
 };
 });
 console.log('PUBLIC_CHECKOUT_STRUCTURE '+host+' '+JSON.stringify(info));
 await page.screenshot({path:'checkout-before-'+host+'.png',fullPage:true});
 await ctx.close();
}
}finally{await browser.close();}
