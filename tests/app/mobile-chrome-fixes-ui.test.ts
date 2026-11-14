import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-ignore Browser module, pure helper only.
import {chatFabDirection} from '../../trial-ui/mobile-chat-fab.js';
const read=(p:string)=>readFileSync(new URL('../../trial-ui/'+p,import.meta.url),'utf8');

test('chat button tucks while reading down and returns on scroll up, at the top and at the end',()=>{
 const page={top:0,bottom:2000};
 assert.equal(chatFabDirection(300,400,page),'hide');
 assert.equal(chatFabDirection(400,300,page),'show');
 assert.equal(chatFabDirection(400,404,page),'keep','rung nhẹ không đổi trạng thái');
 assert.equal(chatFabDirection(100,20,page),'show');
 assert.equal(chatFabDirection(1900,1995,page),'show','tới cuối trang khoảng trống phía dưới đã chừa chỗ cho nút');
});

test('phone layout rules: compact back arrow, two-line page title, full-width profit selects, spaced scanner buttons',()=>{
 const mobile=read('mobile-design.css'),pos=read('pos.css'),app=read('app.js'),posJs=read('pos.js');
 assert.match(mobile,/\.topbar \.page-back \{[^}]*font-size:0/);assert.match(mobile,/\.topbar \.page-back::before \{ content:'‹'/);
 assert.match(mobile,/\.topbar #breadcrumb \{[^}]*-webkit-line-clamp:2/);
 assert.match(mobile,/\.pf-filters > select \{ flex:1 1 100%; \}/);
 assert.match(mobile,/body\.chat-fab-tucked \.chat-launcher \{[^}]*pointer-events:none/);
 assert.match(pos,/\.pos-scan-actions \{ display:flex;flex-wrap:wrap;gap:10px/);
 assert.match(posJs,/scanActions\.append\(button\('Nhập mã thủ công'/);
 assert.match(app,/installChatFab\(\);/);
});
