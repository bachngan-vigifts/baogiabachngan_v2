import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
const code=readFileSync('web-shared/checkout-step3/store-mobile-checkout.php','utf8');
const css=code.match(/<style id="bnco-style">([\s\S]*?)<\/style>/)[1],js=code.match(/<script id="bnco-script">([\s\S]*?)<\/script>/)[1];
const browser=await chromium.launch();
export async function verify(browser,live=false){
 for(const [host,pid] of [['minhlongonline.com','21035'],['locknlockonline.com','19320']]){
 const origin='https://'+host,ctx=await browser.newContext({viewport:{width:390,height:844}}),page=await ctx.newPage();
 try{
 await page.route('**/*wc-ajax=checkout*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({result:'failure',messages:'<ul class="woocommerce-error"><li>Kiểm thử: chặn tạo đơn hàng.</li></ul>',refresh:false,reload:false})}));
 const add=await ctx.request.post(origin+'/?wc-ajax=add_to_cart',{timeout:90000,form:{product_id:pid,quantity:'1'}});if((await add.json()).error)throw Error('Guest cart failed');
 await page.goto(origin+'/gio-hang/',{waitUntil:'domcontentloaded',timeout:90000});
 const src=await page.locator('.cart_item .product-thumbnail img').first().getAttribute('src');

 if(!live)await page.route('**/thanh-toan/**',async route=>{
  if(!route.request().isNavigationRequest())return route.fallback();
  if(route.request().method()!=='GET')return route.fulfill({status:400,contentType:'text/plain',body:'Checkout navigation submission blocked in test'});
  const response=await route.fetch({timeout:90000});
  const html=(await response.text()).replace(/<script\b[^>]*\bid=["']bnco-script["'][^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*\bid=["']bnco-style["'][^>]*>[\s\S]*?<\/style>/gi,'');
  await route.fulfill({response,body:html});
 });
 await page.goto(origin+'/thanh-toan/',{waitUntil:'domcontentloaded',timeout:90000});
 await page.waitForTimeout(4000);
 if(!live){const active=await page.locator('#bnco-script').allTextContents();if(active.length){if(active.length!==1||active[0].trim()!==js.trim())throw Error('Different checkout candidate already active');}else{await page.addStyleTag({content:css});await page.addScriptTag({content:js});}}
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
 const ordered=await page.evaluate(()=>{const inv=document.querySelector('.claw-lnl-invoice-request--checkout,.claw-ml-invoice-request--checkout'),bill=document.querySelector('.woocommerce-billing-fields');return !inv||inv.getBoundingClientRect().top>=bill.getBoundingClientRect().bottom-1;});if(!ordered){console.log('INVOICE_LAYOUT '+host+' '+JSON.stringify(await page.evaluate(()=>{const e=document.querySelector('.claw-lnl-invoice-request--checkout,.claw-ml-invoice-request--checkout');const d=n=>({cls:n.className,id:n.id,display:getComputedStyle(n).display,order:getComputedStyle(n).order,position:getComputedStyle(n).position,y:n.getBoundingClientRect().y,h:n.getBoundingClientRect().height});return {invoice:d(e),parent:d(e.parentElement),siblings:[...e.parentElement.children].map(d)};})));throw Error('Invoice must appear after address fields');}
 const compact=await page.evaluate(()=>{
const ids=['mailpoet_woocommerce_checkout_optin','ship-to-different-address-checkbox'];
return ids.every(id=>{const e=document.getElementById(id);return !e||(!e.checked&&!e.getClientRects().length);});
});if(!compact)throw Error('Removed mobile options still visible or selected');
console.log('COMPACT_ADDRESS_OPTIONS_OK '+host);
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
 await page.locator('#order_comments').fill('Kiểm thử ghi chú — không tạo đơn');
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
  if(live)await page.waitForFunction(()=>[...document.querySelectorAll('.bnco-product-thumb')].length>0&&[...document.querySelectorAll('.bnco-product-thumb')].every(i=>i.complete&&i.naturalWidth>0));
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
 await page.locator('.lnl-voucher-modal[aria-hidden="false"] .lnl-voucher-close').click();
 await page.waitForFunction(()=>getComputedStyle(document.getElementById('bnco-footer')).visibility==='visible');
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
 if(params.get('ship_to_different_address')==='1'||params.get('mailpoet_woocommerce_checkout_optin')==='1'||params.get('order_comments')!=='Kiểm thử ghi chú — không tạo đơn')throw Error('Removed option or order note serialization incorrect');
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
 const changes=await page.evaluate(async()=>{const e=document.querySelector('.claw-lnl-invoice-request--checkout,.claw-ml-invoice-request--checkout');let n=0;const o=new MutationObserver(rs=>rs.forEach(r=>{if([...r.addedNodes].includes(e))n++;}));o.observe(document.querySelector('form.checkout'),{childList:true,subtree:true});await new Promise(r=>setTimeout(r,1000));o.disconnect();return n;});if(changes>1)throw Error('Repeated desktop invoice movement');
 console.log('DESKTOP_NATIVE_LAYOUT_OK '+host);
 }catch(e){console.log('CHECKOUT_DIAGNOSTIC '+host+' '+JSON.stringify(await page.evaluate(()=>({error:document.getElementById('bnco-error')?.textContent,images:[...document.querySelectorAll('.bnco-product-thumb')].map(i=>({src:i.currentSrc||i.src,loaded:i.complete,width:i.naturalWidth})),modal:document.querySelector('.lnl-voucher-modal[aria-hidden="false"]')?.textContent.slice(0,2200),step:document.body.className,fields:[...document.querySelectorAll('#customer_details input:not([type=hidden]),#customer_details select')].filter(e=>e.id.startsWith('billing_')).map(e=>({id:e.id,value:e.value})),cards:[...document.querySelectorAll('form.checkout,#customer_details,.woocommerce-billing-fields,.woocommerce-billing-fields__field-wrapper')].map(e=>({cls:e.className,padding:getComputedStyle(e).padding,margin:getComputedStyle(e).margin})),above:[...document.querySelector('form.checkout').parentElement.children].map(e=>({tag:e.tagName,id:e.id,cls:e.className,text:e.textContent.trim().slice(0,90)}))}))));await page.screenshot({path:'checkout-failure-'+host+'.png',fullPage:true});throw e;}finally{await ctx.close();}
 }
}
try{await verify(browser,process.env.LIVE==='1');}finally{await browser.close();}
