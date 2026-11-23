/** Monetary-input review regressions. Local DOM only; all external requests blocked. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.REVIEW_DIR||'/tmp/money-input-review';await mkdir(out,{recursive:true});
const html=`<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><form id="f">
<label for="amount" id="label">Giá vốn</label><input id="amount" name="amount" type="number" data-money="1" value="1200">
<label>Chỉ tiêu<input id="text" name="text" data-money="1" value="1200"></label>
<label>Giá lẻ ban đầu<input id="fraction" name="fraction" type="number" data-money="1" value="123456.5"></label>
<label>Giá có step riêng<input id="explicit" name="explicit" type="number" data-money="1" step="0.25" value="1200"></label>
</form><script type="module">import {initMoneyInputs} from '/money-input.js';initMoneyInputs();window.ready=true;</script></body></html>`;
const server=createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;if(p==='/')return res.writeHead(200,{'content-type':'text/html'}).end(html);res.writeHead(200,{'content-type':p.endsWith('.js')?'text/javascript':'text/css'}).end(await readFile(p==='/money-input.js'&&process.env.MONEY_SOURCE_PATH?process.env.MONEY_SOURCE_PATH:root+p.slice(1)));}catch{res.writeHead(404).end();}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const settle=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const value=(p,id)=>p.evaluate(id=>document.getElementById(id).value,id);
const shown=(p,id)=>p.evaluate(id=>{const i=document.getElementById(id),v=i.previousElementSibling;return v?.dataset.moneyProxy&&!v.hidden?v.value:i.value;},id);
const results=[];
const cases=[
 ['integer-recovery',async p=>{await p.evaluate(()=>{amount.value=123456.5;});assert.equal(await shown(p,'amount'),'123456.5');await p.evaluate(()=>{amount.value=123456;});assert.equal(await shown(p,'amount'),'123.456');}],
 ['fraction-edit-keeps-decimal',async p=>{await p.evaluate(()=>{amount.value=123456.5;});await p.getByLabel('Giá vốn',{exact:true}).focus();await p.keyboard.press('End');await p.keyboard.press('Backspace');await p.keyboard.type('6');assert.equal(await p.evaluate(()=>new FormData(document.getElementById('f')).get('amount')),'123456.6');}],
 ['float-without-rounding',async p=>{await p.evaluate(()=>{amount.value=1650000.0000000002;});assert.equal(await value(p,'amount'),'1650000.0000000002');await p.evaluate(()=>{amount.value=1650000;});assert.equal(await shown(p,'amount'),'1.650.000');}],
 ['initial-fraction-recovery',async p=>{assert.equal(await value(p,'fraction'),'123456.5');await p.evaluate(()=>{fraction.value=123456;});assert.equal(await shown(p,'fraction'),'123.456');}],
 ['no-blur-when-removing-proxy',async p=>{
  await p.locator('#label').click();await p.evaluate(()=>{window.blurs=0;amount.addEventListener('blur',()=>window.blurs++);const view=amount.previousElementSibling,remove=view.remove;view.remove=function(){this.dispatchEvent(new FocusEvent('blur'));return remove.call(this);};amount.value=123456.5;});
  assert.equal(await p.evaluate(()=>window.blurs),0,'cleanup must suppress even a blur dispatched during removal');assert.equal(await p.evaluate(()=>document.activeElement.id),'amount');await p.locator('#label').click();assert.equal(await p.evaluate(()=>document.activeElement.id),'amount');
 }],
 ['text-fraction-is-not-digit-stripped',async p=>{await p.evaluate(()=>{document.getElementById('text').value='123456.5';});assert.equal(await shown(p,'text'),'123456.5');await p.getByLabel('Chỉ tiêu',{exact:true}).fill('123456.6');assert.equal(await p.evaluate(()=>new FormData(document.getElementById('f')).get('text')),'123456.6');await p.evaluate(()=>{document.getElementById('text').value='123456';});assert.equal(await shown(p,'text'),'123.456');}],
 ['valueAsNumber-and-step',async p=>{await p.evaluate(()=>{amount.valueAsNumber=123456;});assert.equal(await shown(p,'amount'),'123.456');await p.evaluate(()=>amount.stepUp());assert.equal(await shown(p,'amount'),'123.457');await p.evaluate(()=>amount.stepDown(2));assert.equal(await shown(p,'amount'),'123.455');await p.evaluate(()=>{amount.valueAsNumber=123456.5;});assert.equal(await shown(p,'amount'),'123456.5');assert.equal(await p.evaluate(()=>new FormData(document.getElementById('f')).get('amount')),'123456.5');}],
 ['attribute-reset-and-cancelled-reset',async p=>{await p.evaluate(()=>amount.setAttribute('value','3300'));await settle(p);assert.equal(await shown(p,'amount'),'3.300');await p.evaluate(()=>{amount.value=4400;amount.setAttribute('value','5500');});await settle(p);assert.equal(await shown(p,'amount'),'4.400','dirty native value must not be overwritten by defaultValue');await p.evaluate(()=>document.getElementById('f').reset());await settle(p);assert.equal(await shown(p,'amount'),'5.500');await p.evaluate(()=>{amount.value=6600;document.getElementById('f').addEventListener('reset',e=>e.preventDefault(),{once:true});document.getElementById('f').reset();});await settle(p);assert.equal(await shown(p,'amount'),'6.600');}],
 ['temporary-step-any-and-explicit-step',async p=>{await p.evaluate(()=>{amount.value=123456.5;});assert.equal(await p.locator('#amount').getAttribute('step'),'any');assert.equal(await p.evaluate(()=>amount.validity.stepMismatch),false);assert.equal(await p.evaluate(()=>document.getElementById('f').checkValidity()),true);await p.evaluate(()=>{amount.value=123456;});assert.equal(await p.locator('#amount').getAttribute('step'),null);await p.evaluate(()=>{explicit.value=1200.5;});assert.equal(await p.locator('#explicit').getAttribute('step'),'0.25');assert.equal(await p.evaluate(()=>explicit.validity.stepMismatch),false);}],
 ['fresh-controls-for-native-notations',async p=>{
  for(const v of ['-12.5','123456.0','1e3']){await p.evaluate(()=>{const old=document.getElementById('fresh');if(old?.previousElementSibling?.dataset.moneyProxy)old.previousElementSibling.remove();old?.remove();const i=document.createElement('input');i.id='fresh';i.name='fresh';i.type='number';i.dataset.money='1';i.value='1200';document.getElementById('f').append(i);});await settle(p);assert.equal(await shown(p,'fresh'),'1.200','each value starts in an enhanced control');await p.evaluate(v=>{fresh.value=v;},v);assert.equal(await value(p,'fresh'),v);assert.equal(await shown(p,'fresh'),v);assert.equal(await p.evaluate(()=>new FormData(document.getElementById('f')).get('fresh')),v);await p.evaluate(()=>{fresh.value=2200;});assert.equal(await shown(p,'fresh'),'2.200');}
 }],
];
try{for(const width of [390,1280])for(const [name,run] of cases){
 const context=await browser.newContext({viewport:{width,height:900},locale:'vi-VN'}),errors=[];await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 try{await page.goto(origin);await page.waitForFunction(()=>window.ready);await run(page);assert.deepEqual(errors,[]);results.push({width,name,passed:true,errors});}
 catch(e){results.push({width,name,passed:false,error:e.message,errors});}
 finally{await context.close();}
}assert.equal(browser.contexts().length,0);
}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));await browser.close();server.close();}
process.exitCode=results.some(r=>!r.passed)?1:0;
