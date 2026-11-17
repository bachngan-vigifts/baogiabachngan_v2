import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
const code=readFileSync('web-shared/checkout-step3/store-mobile-checkout.php','utf8');
const css=code.match(/<style id="bnco-style">([\s\S]*?)<\/style>/)[1],js=code.match(/<script id="bnco-script">([\s\S]*?)<\/script>/)[1];
const browser=await chromium.launch();
export async function verify(browser,live=false){
 for(const [host,pid] of [['minhlongonline.com','21035'],['locknlockonline.com','19320']]){
 const origin='https://'+host,ctx=await browser.newContext({viewport:{width:390,height:844}}),page=await ctx.newPage();
 try{
 const add=await ctx.request.post(origin+'/?wc-ajax=add_to_cart',{timeout:90000,form:{product_id:pid,quantity:'1'}});if((await add.json()).error)throw Error('Guest cart failed');
 await page.goto(origin+'/gio-hang/',{waitUntil:'domcontentloaded',timeout:90000});
 const src=await page.locator('.cart_item .product-thumbnail img').first().getAttribute('src');
 await page.goto(origin+'/thanh-toan/',{waitUntil:'domcontentloaded',timeout:90000});
 await page.waitForTimeout(4000);
 if(!live){await page.addStyleTag({content:css});await page.addScriptTag({content:js});}
 const thumbs=async()=>{if(!live)await page.evaluate(src=>document.querySelectorAll('.woocommerce-checkout-review-order-table .cart_item .product-name').forEach(e=>{if(!e.querySelector('.bnco-product-thumb')){const i=document.createElement('img');i.src=src;i.className='bnco-product-thumb';e.prepend(i);}}),src);};
 await thumbs();
 await page.locator('#bnco-shell').waitFor({state:'visible'});
 const settle=async()=>{await page.waitForFunction(()=>!document.querySelector('form.checkout.processing,.blockUI')&&!document.querySelector('#bnco-next')?.disabled,{},{timeout:90000});await page.waitForTimeout(300);};
 await settle();
 for(const width of [390,320,430]){
 await page.setViewportSize({width,height:844});await page.waitForTimeout(300);
 const checks=await page.evaluate(()=>{
 const f=document.getElementById('bnco-footer').getBoundingClientRect(),input=document.getElementById('billing_first_name').getBoundingClientRect();
 return {overflow:document.documentElement.scrollWidth>innerWidth+2,footer:f.left>=0&&f.right<=innerWidth+1,input:input.width>200&&input.right<=innerWidth,hidden:getComputedStyle(document.getElementById('header')).display==='none',review:getComputedStyle(document.getElementById('order_review')).display==='none'};
 });if(checks.overflow||!checks.footer||!checks.input||!checks.hidden||!checks.review)throw Error('Step1 geometry '+host+' '+width+' '+JSON.stringify(checks));
 await page.screenshot({path:'checkout-step1-'+host+'-'+width+'.png',fullPage:true});
 }
 console.log('PHASE_1_FORM_LAYOUT_OK '+host);
 console.log('FORM_SPACING '+host+' '+JSON.stringify(await page.evaluate(()=>({gap:document.querySelector('label[for="billing_first_name"]').getBoundingClientRect().top-document.querySelector('.woocommerce-billing-fields').getBoundingClientRect().top,children:[...document.querySelector('.woocommerce-billing-fields__field-wrapper').children].map(e=>({id:e.id,cls:e.className,h:e.getBoundingClientRect().height,display:getComputedStyle(e).display,order:getComputedStyle(e).order}))}))));
 console.log('PROMO_LABEL_STRUCTURE '+host+' '+JSON.stringify(await page.evaluate(()=>({promo:[...document.querySelectorAll('body *')].filter(e=>e.children.length===0&&e.textContent.includes('QUÀ TẶNG BLACK FRIDAY')).map(e=>({html:e.parentElement.outerHTML.slice(0,4500),parent:e.parentElement.parentElement.className})),labels:[...document.querySelectorAll('label[for="billing_first_name"]')].map(e=>({html:e.outerHTML,style:getComputedStyle(e).cssText,display:getComputedStyle(e).display,position:getComputedStyle(e).position,clip:getComputedStyle(e).clip,color:getComputedStyle(e).color,parent:e.parentElement.outerHTML.slice(0,1500)}))}))));
 console.log('LAYOUT_STRUCTURE '+host+' '+JSON.stringify(await page.evaluate(()=>({above:[...document.querySelector('form.checkout').parentElement.children].map(e=>({tag:e.tagName,id:e.id,cls:e.className,text:e.textContent.trim().slice(0,70)})),parents:(()=>{let e=document.querySelector('form.checkout'),a=[];for(let i=0;e&&i<5;i++,e=e.parentElement)a.push({cls:e.className,padding:getComputedStyle(e).padding,margin:getComputedStyle(e).margin});return a;})()}))));
 await page.setViewportSize({width:390,height:844});
 await page.locator('#bnco-next').click();
 if(!await page.locator('#bnco-error').isVisible())throw Error('Empty address accepted');
 await page.locator('#billing_first_name').fill('Kiểm thử giao diện');
 await page.locator('#billing_phone').fill('0900000000');
 await page.locator('#billing_address_1').fill('123 Đường kiểm thử');
 async function choose(id,val){await page.waitForFunction(({id,val})=>[...document.getElementById(id).options].some(o=>o.value===val),{id,val},{timeout:90000});await page.evaluate(({id,val})=>{window.jQuery('#'+id).val(val).trigger('change');},{id,val});}
 await choose('billing_ghn_province_id','220');
 await choose('billing_ghn_district_id','1572');
 await choose('billing_ghn_ward_code','550111');
 await settle();await thumbs();
 await page.locator('#bnco-next').click();
 await page.waitForFunction(()=>document.body.classList.contains('bnco-step2'),{},{timeout:90000});
 if(!(await page.locator('#bnco-address-copy').textContent()).includes('123 Đường kiểm thử'))throw Error('Address missing');
 await page.locator('#bnco-edit').click();
 if(await page.locator('#billing_first_name').inputValue()!=='Kiểm thử giao diện')throw Error('Address lost on back');
 await page.locator('#bnco-next').click();await settle();await thumbs();
 await page.waitForFunction(()=>/\d{2}\/\d{2}\/\d{4}/.test(document.querySelector('.bnco-review-eta')?.textContent||''),{},{timeout:60000});
 console.log('GHN_DATE_VISIBLE_IN_REVIEW_OK '+host);
 console.log('PHASE_2_ADDRESS_VALIDATION_BACK_PERSISTENCE_OK '+host);
 for(const width of [390,320,430]){
 await page.setViewportSize({width,height:844});await page.waitForTimeout(300);
 const result=await page.evaluate(()=>{
 const total=document.querySelector('.order-total .amount')?.textContent.trim(),shown=document.getElementById('bnco-amount').textContent;
 return {total:total===shown,overflow:document.documentElement.scrollWidth>innerWidth+2,customer:getComputedStyle(document.getElementById('customer_details')).display==='none',native:document.querySelectorAll('#place_order').length,nonce:document.querySelectorAll('[name="woocommerce-process-checkout-nonce"]').length};
 });if(!result.total||result.overflow||!result.customer||result.native!==1||result.nonce!==1)throw Error('Step2 checks '+JSON.stringify(result));
 await page.screenshot({path:'checkout-step2-'+host+'-'+width+'.png',fullPage:true});
 }
 await page.setViewportSize({width:390,height:844});
 
 const qty=page.locator('.claw-checkout-qty-input,.lnl-checkout-qty-input').first();
 const oldSubtotal=await page.locator('.cart-subtotal .amount').first().textContent();
 await qty.fill('2');await qty.dispatchEvent('change');
 await page.waitForFunction(old=>document.querySelector('.cart-subtotal .amount')?.textContent!==old,oldSubtotal,{timeout:90000});
 await settle();await thumbs();
 if(await qty.inputValue()!=='2')throw Error('Quantity update lost');
 await page.waitForFunction(()=>document.getElementById('bnco-amount').textContent===document.querySelector('.order-total .amount').textContent.trim());
 console.log('QUANTITY_AND_NATIVE_TOTAL_SYNC_OK '+host);
 const opener=page.locator('.context-checkout [data-lnl-voucher-open]').first();
 if(await opener.isVisible()){
 await opener.click();
 const coupon=host==='minhlongonline.com'?'ml10k':'lnl10k';
 const modal=page.locator('.lnl-voucher-modal[aria-hidden="false"]');
 await modal.locator('input:not([type="hidden"])').first().fill(coupon);
 await modal.getByRole('button',{name:'ÁP DỤNG',exact:true}).click();
 await page.waitForFunction(()=>!!document.querySelector('.woocommerce-checkout-review-order-table .cart-discount'),{},{timeout:90000});
 await settle();await thumbs();
 await page.waitForFunction(()=>document.getElementById('bnco-amount').textContent===document.querySelector('.order-total .amount').textContent.trim());
 console.log('VOUCHER_NATIVE_TOTAL_SYNC_OK '+host);
 }
 await page.locator('#payment_method_cod').check();await settle();
 if(await page.locator('#terms').count())await page.locator('#terms').check();
 if(await page.locator('#bnco-review-confirm').count())await page.locator('#bnco-review-confirm').check();
 let submitted=false;
 await page.route('**/*wc-ajax=checkout*',async route=>{
 const params=new URLSearchParams(route.request().postData()||'');
 if(params.get('billing_first_name')!=='Kiểm thử giao diện'||params.get('billing_phone')!=='0900000000'||params.get('payment_method')!=='cod'||!params.get('woocommerce-process-checkout-nonce'))throw Error('Serialized order fields incorrect');
 submitted=true;await route.fulfill({contentType:'application/json',body:JSON.stringify({result:'failure',messages:'<ul class="woocommerce-error"><li>Kiểm thử giao diện: không tạo đơn hàng.</li></ul>',refresh:false,reload:false})});
 });
 await page.locator('#bnco-next').click();
 await page.waitForFunction(()=>document.querySelector('.woocommerce-error')?.textContent.includes('Kiểm thử giao diện'),{},{timeout:30000});
 if(!submitted)throw Error('Checkout request not intercepted');
 console.log('PHASE_3_NATIVE_SUBMISSION_FIELDS_OK_NO_ORDER_CREATED '+host);
 await page.setViewportSize({width:1484,height:1004});await page.waitForTimeout(500);
 if(await page.locator('#bnco-footer').isVisible())throw Error('Mobile footer leaked desktop');
 if(await page.locator('#header').evaluate(e=>getComputedStyle(e).display==='none'))throw Error('Desktop header hidden');
 if(await page.locator('#payment #place_order').count()!==1)throw Error('Desktop payment row not restored');
 await page.screenshot({path:'checkout-desktop-'+host+'.png',fullPage:true});
 console.log('DESKTOP_NATIVE_LAYOUT_OK '+host);
 }catch(e){console.log('CHECKOUT_DIAGNOSTIC '+host+' '+JSON.stringify(await page.evaluate(()=>({error:document.getElementById('bnco-error')?.textContent,modal:document.querySelector('.lnl-voucher-modal[aria-hidden="false"]')?.textContent.slice(0,2200),step:document.body.className,fields:[...document.querySelectorAll('#customer_details input:not([type=hidden]),#customer_details select')].filter(e=>e.id.startsWith('billing_')).map(e=>({id:e.id,value:e.value})),cards:[...document.querySelectorAll('form.checkout,#customer_details,.woocommerce-billing-fields,.woocommerce-billing-fields__field-wrapper')].map(e=>({cls:e.className,padding:getComputedStyle(e).padding,margin:getComputedStyle(e).margin})),above:[...document.querySelector('form.checkout').parentElement.children].map(e=>({tag:e.tagName,id:e.id,cls:e.className,text:e.textContent.trim().slice(0,90)}))}))));await page.screenshot({path:'checkout-failure-'+host+'.png',fullPage:true});throw e;}finally{await ctx.close();}
 }
}
try{await verify(browser,process.env.LIVE==='1');}finally{await browser.close();}
