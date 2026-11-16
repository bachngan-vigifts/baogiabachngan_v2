import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const code=readFileSync('web-lock/chatbot/lnl-store-ai-bridge.php','utf8');
const start=code.indexOf('<style id="lnl-chat-ui-v2">'),end=code.indexOf('</script>',start)+9;
assert(start>0);
const html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><button id="claw-ai-launcher">Old chat</button><section id="claw-ai-panel">Old suggestions</section>'+code.slice(start,end);
const browser=await chromium.launch();
try{
for(const viewport of [{width:1280,height:900},{width:390,height:844},{width:320,height:568}]){
 const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let requests=0,lastBody;
 await page.route('https://chat.test/**',route=>{
  if(route.request().method()==='POST'){requests++;lastBody=route.request().postDataJSON();return route.fulfill({contentType:'application/json',body:JSON.stringify({reply:'Bạn nên chọn dung tích phù hợp nhu cầu. <img src=x onerror=alert(1)>',provider:'gemini',products:[]})});}
  return route.fulfill({contentType:'text/html',body:html});
 });
 await page.goto('https://chat.test/');
 assert.equal(await page.locator('#claw-ai-launcher').isVisible(),false);
 await page.getByRole('button',{name:'Chat với AI',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Gửi tin nhắn',exact:true}).isEnabled(),false);
 const bounds=await page.locator('#lnl-chat-dialog').boundingBox();
 assert(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width+1&&bounds.y+bounds.height<=viewport.height+1);
 await page.getByRole('textbox',{name:'Tin nhắn',exact:true}).fill('Tôi cần tư vấn');
 await page.getByRole('textbox',{name:'Tin nhắn',exact:true}).press('Enter');
 await page.locator('.lnl-chat-msg.bot').waitFor();
 assert.equal(requests,1);assert.equal(await page.locator('.lnl-chat-msg.bot img').count(),0);
 await page.getByRole('textbox',{name:'Tin nhắn',exact:true}).fill('Thế còn loại nhỏ?');
 await page.getByRole('button',{name:'Gửi tin nhắn',exact:true}).click();
 await page.locator('.lnl-chat-msg.bot').nth(1).waitFor();
 assert.equal(lastBody.history.length,2);
 await page.getByRole('button',{name:'Cuộc trò chuyện mới',exact:true}).click();
 assert.equal(await page.locator('.lnl-chat-msg').count(),0);
 await page.getByRole('textbox',{name:'Tin nhắn',exact:true}).fill('Câu mới');
 await page.getByRole('button',{name:'Gửi tin nhắn',exact:true}).click();
 await page.locator('.lnl-chat-msg.bot').waitFor();
 assert.equal(lastBody.history.length,0);
 await page.getByRole('button',{name:'Đóng cửa sổ chat',exact:true}).click();
 assert.equal(await page.locator('#lnl-chat-dialog').isVisible(),false);
 assert.deepEqual(errors,[]);await page.close();
 console.log('CHAT_UI_OK '+viewport.width+'x'+viewport.height);
}
}finally{await browser.close();}
