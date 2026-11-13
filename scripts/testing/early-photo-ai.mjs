/** Kịch bản trình duyệt cho "Xin hàng trước bằng ảnh" đọc bằng AI. Bộ đọc AI là hàm giả trong tiến trình: không gọi dịch vụ ngoài, không dùng dữ liệu thật. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setupEarly} from '../../tests/helpers/purchase-early-fixture.ts';
import {AppError} from '../../src/core/errors.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.REVIEW_DIR||'/tmp/early-photo-ai-review';await mkdir(out,{recursive:true});
/** Kích thước ảnh JPEG đọc từ đoạn SOF, để biết trình duyệt đã xoay ảnh trước khi gửi hay chưa. */
function jpegSize(buffer){for(let i=2;i<buffer.length-9;){if(buffer[i]!==0xff){i++;continue;}const marker=buffer[i+1];if(marker>=0xc0&&marker<=0xc3)return {height:buffer.readUInt16BE(i+5),width:buffer.readUInt16BE(i+7)};i+=2+buffer.readUInt16BE(i+2);}return null;}
const seen=[];let mode='ok';
const photoReader=async image=>{const bytes=Buffer.from(image.data,'base64');seen.push({mediaType:image.mediaType,bytes:bytes.length,...jpegSize(bytes)});
 if(mode==='down')throw new AppError(503,'Bộ đọc ảnh AI đang quá tải. Thử lại sau ít phút.','photo_ai_busy');
 if(mode==='rejected')throw new AppError(422,'Ảnh không được bộ đọc AI chấp nhận. Chụp lại ảnh rõ hơn.','photo_ai_rejected');
 const rows=[{sku:'031106000',quantity:100,uncertain:false},{sku:'01654020803',quantity:2,uncertain:false},{sku:'ZZZ-404',quantity:5,uncertain:true}];
 return {output:{readable:true,rows,statedTotalQuantity:mode==='mismatch'?117:107,pxkNo:'000123',orderNo:'',supplierOrderNo:'',orderReference:''},model:'fake',inputTokens:1,outputTokens:1};};
const f=await setupEarly({photoReader});
await f.client.query("insert into products(sku,name,updated_at) values ('031106000','Chén cơm thử nghiệm','2026-10-21T00:00:00Z'),('01654020803','Bộ trà thử nghiệm','2026-10-21T00:00:00Z') on conflict do nothing");
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/staff/')){const chunks=[];for await(const c of req)chunks.push(c);const payload=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;const r=await f.call(u.pathname.slice(10)+u.search,f.cookies[req.headers['x-role']||'sa'],req.method,payload);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
 if(u.pathname==='/test'){res.writeHead(200,{'content-type':'text/html'}).end('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/early-request-page.css"></head><body></body></html>');return;}
 if(u.pathname.includes('..'))throw Error('path');const data=await readFile(root+u.pathname);res.writeHead(200,{'content-type':u.pathname.endsWith('.js')?'text/javascript':u.pathname.endsWith('.css')?'text/css':'application/octet-stream'}).end(data);
 }catch(e){res.writeHead(404).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
const open=(page,role,localRows)=>page.evaluate(async({role,localRows})=>{const {openEarlyRequestPhoto}=await import('/purchase-early-photo.js');
 const api=async(path,method='GET',body)=>{const r=await fetch('/api/staff'+path,{method,headers:{'content-type':'application/json','x-role':role},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Object.assign(Error(d.error||'Lỗi'),{status:r.status,code:d.code});return d;};
 window.localCalls=[];openEarlyRequestPhoto({api,suppliers:[{id:'a',name:'NCC a'},{id:'b',name:'NCC b'}],today:'2026-11-13',go:()=>{},requestHref:id=>'#/early-requests/'+id},{recognize:async(file,o)=>{window.localCalls.push(o.rotate);return {blocks:localRows};}});},{role,localRows});
const results=[];
try{
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:950},locale:'vi-VN',deviceScaleFactor:1});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());await page.goto(origin+'/test');
  // Ảnh giả nằm ngang 1600×900 (chữ vẽ bằng canvas, không phải phiếu thật).
  const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1600;c.height=900;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,1600,900);x.fillStyle='#111';x.font='34px Arial';['Mã Số        SL Giao','031106000        100','01654020803        2','ZZZ-404        5','Tổng SL giao: 107'].forEach((t,i)=>x.fillText(t,60,90+i*70));return c.toDataURL('image/png').split(',')[1];});
  mode='ok';seen.length=0;await open(page,'sa',[]);
  await page.getByText('dịch vụ AI (Anthropic)').waitFor();
  await page.getByLabel('Ảnh phiếu xin hàng').setInputFiles({name:'phieu.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
  await page.getByRole('button',{name:'Đọc ảnh',exact:true}).click();await page.getByLabel('Mã hàng dòng 3').waitFor();
  assert.deepEqual(seen.at(-1),{mediaType:'image/jpeg',bytes:seen.at(-1).bytes,width:1600,height:900});assert.ok(seen.at(-1).bytes<3_400_000);
  assert.equal(await page.getByLabel('Mã hàng dòng 1').inputValue(),'031106000');assert.equal(await page.getByLabel('Số lượng dòng 1').inputValue(),'100');assert.equal(await page.getByLabel('Số PXK chung',{exact:true}).inputValue(),'000123');
  const status=await page.getByRole('status').innerText();assert.match(status,/AI đã đọc 3 dòng/);assert.match(status,/khớp tổng in trên phiếu/);assert.match(status,/1 dòng đánh dấu ⚠/);
  assert.match(await page.locator('tr.early-photo-row-flag').innerText(),/mã chưa có trong CRM/);assert.match(await page.locator('tbody tr').first().innerText(),/Chén cơm thử nghiệm/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal page scroll');
  await page.screenshot({path:out+'/ai-read-'+width+'.png',fullPage:false});
  // Chưa đánh dấu đã kiểm thì không đi tiếp.
  await page.getByRole('button',{name:'Kiểm phiếu / đối chiếu đơn mua'}).click();assert.match(await page.getByRole('alert').innerText(),/Cần kiểm tra/);
  // Xoay ảnh: lượt đọc sau gửi ảnh đã xoay (900×1600).
  await page.getByRole('button',{name:'Xoay ảnh 90°'}).click();await page.getByRole('button',{name:'Đọc ảnh',exact:true}).click();await page.getByLabel('Mã hàng dòng 3').waitFor();
  assert.equal(seen.at(-1).width,900);assert.equal(seen.at(-1).height,1600);
  // Tổng lệch: cảnh báo rõ.
  mode='mismatch';await page.getByRole('button',{name:'Đọc ảnh',exact:true}).click();await page.getByText('KHÁC tổng in trên phiếu').waitFor();
  assert.equal(await page.getByRole('status').evaluate(n=>n.classList.contains('early-photo-warn')),true);
  await page.screenshot({path:out+'/ai-mismatch-'+width+'.png'});
  // AI từ chối ảnh: báo lỗi, hiện nút đọc trên máy, không tự chuyển.
  mode='rejected';await page.getByRole('button',{name:'Đọc ảnh',exact:true}).click();await page.getByText('không được bộ đọc AI chấp nhận').waitFor();
  assert.equal(await page.getByRole('button',{name:'Đọc bằng bộ đọc trên máy'}).isVisible(),true);assert.equal((await page.evaluate(()=>window.localCalls)).length,0);
  // AI quá tải: tự chuyển sang bộ đọc trên máy, giữ góc xoay.
  mode='down';await page.getByRole('button',{name:'Đọc ảnh',exact:true}).click();await page.getByText('Bộ đọc AI chưa dùng được nên đã đọc bằng bộ đọc trên máy').waitFor();
  assert.deepEqual(await page.evaluate(()=>window.localCalls),[90]);
  // Đọc lại bằng AI, bỏ dòng mã lạ, xác nhận và sang bước đối chiếu đơn mua.
  mode='ok';await page.getByRole('button',{name:'Đọc ảnh',exact:true}).click();await page.getByLabel('Mã hàng dòng 3').waitFor();
  await page.getByRole('button',{name:'Xoá dòng 3'}).click();await page.getByLabel('Đã kiểm tra mã hàng và số lượng với ảnh gốc').check();
  await page.getByRole('button',{name:'Kiểm phiếu / đối chiếu đơn mua'}).click();await page.locator('.early-file-dialog').waitFor();
  await page.screenshot({path:out+'/ai-next-'+width+'.png'});
  assert.deepEqual(errors,[]);results.push({width,reads:seen.length});await context.close();
 }
 // Người không có quyền: máy chủ từ chối, giao diện dùng lời giới thiệu của bộ đọc trên máy.
 const page=await browser.newPage();await page.goto(origin+'/test');await open(page,'kho',[]);await page.getByText('ảnh không gửi ra ngoài').waitFor();
 const denied=await page.evaluate(async()=>{const r=await fetch('/api/staff/purchase-early-photo/read',{method:'POST',headers:{'content-type':'application/json','x-role':'kho'},body:JSON.stringify({mediaType:'image/jpeg',data:'/9j/4AAQ'})});return r.status;});assert.equal(denied,403);
 console.log(JSON.stringify({ok:true,results}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
process.exit(0);
