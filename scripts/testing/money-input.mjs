/** Ô số tiền tự có dấu chấm (money-input.js): định dạng khi gõ, code vẫn đọc số gốc, FormData/ẩn hiện/gán giá trị; POS "Khách đưa" tính tiền thối đúng. Trang tĩnh cục bộ. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const page1=`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><body><form id="f">
<label>Số tiền (VNĐ)<input type="number" name="amount" id="amount" min="0" max="999999999"></label>
<label>Số lượng<input type="number" name="qty" id="qty"></label>
<label>Thuế suất VAT (%)<input type="number" id="vat"></label>
<label>Cước nhập tay (đ/kg)<input type="number" id="perkg"></label>
<label>Đơn giá<input type="number" id="price" step="any"></label>
<label>Khối lượng<input type="number" id="kg" step="0.001"></label>
<input type="number" id="labelled" aria-label="Giá mua · SKU1">
<input type="number" id="off" data-money="0" aria-label="Giá vốn">
<label>Chỉ tiêu tháng sau<input name="target" id="target" data-money="1" inputmode="numeric" value="450.000.000"></label>
<label>Ghi chú<input name="note" id="note" inputmode="numeric"></label>
<label>Đến (₫)<input type="number" id="to"></label>
</form><script type="module">import {initMoneyInputs} from '/money-input.js';initMoneyInputs();window.inputs=0;document.querySelector('#amount').addEventListener('input',()=>window.inputs++);window.ready=true;</script>`;
const server=createServer(async(req,res)=>{try{const p=new URL(req.url,'http://l').pathname;if(p==='/')return res.writeHead(200,{'content-type':'text/html'}).end(page1);res.setHeader('content-type',p.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(root+p.slice(1)));}catch{res.writeHead(404).end();}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{});
try{
 for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:900}});await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:'+server.address().port+'/')?r.continue():r.abort());await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.waitForFunction(()=>window.ready);
 const kinds=await page.evaluate(()=>Object.fromEntries([...document.querySelectorAll('input[type=number]')].map(i=>[i.id,!!i.previousElementSibling?.dataset.moneyProxy])));
 assert.deepEqual(kinds,{amount:true,qty:false,vat:false,perkg:true,price:false,kg:false,labelled:true,off:false,to:true},'nhận diện ô tiền');
 const view=page.getByLabel('Số tiền (VNĐ)');await view.click();await page.keyboard.type('1500000');
 assert.equal(await view.inputValue(),'1.500.000');assert.equal(await page.evaluate(()=>document.querySelector('#amount').value),'1500000','code đọc số gốc');
 assert.equal(await page.evaluate(()=>window.inputs),7,'mỗi lần gõ phát sự kiện input trên ô gốc');
 // Sửa giữa số: con trỏ giữ đúng chỗ.
 await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await page.keyboard.type('2');assert.equal(await view.inputValue(),'12.500.000');
 assert.equal(await page.evaluate(()=>new FormData(document.querySelector('#f')).get('amount')),'12500000','FormData lấy số gốc');
 await page.evaluate(()=>{document.querySelector('#amount').value=2000;});assert.equal(await view.inputValue(),'2.000','gán từ code → ô hiển thị');
 await page.evaluate(()=>{document.querySelector('#amount').hidden=true;});assert.equal(await view.isVisible(),false);await page.evaluate(()=>{document.querySelector('#amount').hidden=false;});assert.equal(await view.isVisible(),true);
 await page.evaluate(()=>{document.querySelector('#amount').disabled=true;});await page.waitForTimeout(50);assert.equal(await view.isDisabled(),true);
 await page.evaluate(()=>{const a=document.querySelector('#amount');a.disabled=false;a.value='';});await view.fill('abc12x3');assert.equal(await view.inputValue(),'123','bỏ ký tự không phải số');
 assert.equal(await page.evaluate(()=>document.querySelectorAll('input[type=number]').length),9,'ô gốc vẫn còn cho code dùng');
 // Ô chữ đánh dấu data-money="1": hiển thị có dấu, ô gốc giữ số gốc sau khi sửa; ô chữ không đánh dấu thì không đụng.
 const tv=page.locator('#target').locator('xpath=preceding-sibling::input[1]');assert.equal(await tv.inputValue(),'450.000.000');
 await tv.fill('');await tv.type('1200000');assert.equal(await tv.inputValue(),'1.200.000');assert.equal(await page.evaluate(()=>new FormData(document.querySelector('#f')).get('target')),'1200000');
 assert.equal(await page.evaluate(()=>!!document.querySelector('#note').previousElementSibling?.dataset?.moneyProxy),false,'ô chữ không đánh dấu giữ nguyên');
 // A fractional value assigned by code must remain fractional when the user edits it.
 await page.evaluate(()=>{document.querySelector('#amount').value=123456.5;});
 assert.equal(await view.inputValue(),'123456.5','không biến 123456.5 thành 1.234.565');
 await view.focus();await page.keyboard.press('End');await page.keyboard.press('Backspace');await page.keyboard.type('6');
 assert.equal(await page.evaluate(()=>new FormData(document.querySelector('#f')).get('amount')),'123456.6','sửa một chữ số không nhân giá lên 10 lần');
 assert.equal(await page.locator('#amount').getAttribute('aria-hidden'),null);assert.equal(await page.locator('#amount').getAttribute('tabindex'),null);
 for(const value of ['-12.5','123456.0','1e3']){
  await page.evaluate(value=>{document.querySelector('#amount').value=value;},value);
  assert.equal(await view.inputValue(),value);assert.equal(await page.evaluate(()=>new FormData(document.querySelector('#f')).get('amount')),value);
 }
 await page.evaluate(()=>{const l=document.createElement('label');l.textContent='Giá lẻ ban đầu';l.innerHTML+='<input id="initial-fraction" name="initialFraction" type="number" data-money="1" value="123456.5">';document.querySelector('#f').append(l);});
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 assert.equal(await page.getByLabel('Giá lẻ ban đầu').inputValue(),'123456.5');
 assert.equal(await page.evaluate(()=>new FormData(document.querySelector('#f')).get('initialFraction')),'123456.5');
 console.log('ok money-input '+width);await page.close();
 }
}finally{await browser.close();server.close();}
