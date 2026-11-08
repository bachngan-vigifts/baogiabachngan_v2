import { contractTest as test, assert } from '../TEST_TEMPLATE.ts';
const {createNotificationFeed}=await import(new URL('../../trial-ui/notification-feed.js',import.meta.url).href);
const {isCacheable}=await import(new URL('../../trial-ui/page-cache.js',import.meta.url).href);
const { groupHomeEntries, homeTaskHref, homeGreeting } = await import(new URL('../../trial-ui/home.js',import.meta.url).href);
test('home groups only supplied permission-visible destinations, finds Vietnamese without accents, rejects external URLs',()=>{
 assert.equal(homeGreeting(Date.parse('2026-11-08T00:00:00Z')),'buổi sáng');assert.equal(homeGreeting(Date.parse('2026-11-08T08:00:00Z')),'buổi chiều');assert.equal(homeGreeting(Date.parse('2026-11-08T12:00:00Z')),'buổi tối');
 const entries=[{key:'customers',label:'Khách hàng',href:'#/customers',groupId:'customer',group:'Khách hàng'},
 {key:'payroll',label:'Bảng lương',href:'#/payroll',groupId:'admin',group:'Quản trị'},
 {key:'evil',label:'X',href:'javascript:alert(1)',groupId:'admin',group:'Quản trị'}];
 assert.deepEqual(groupHomeEntries(entries,'bang luong').map((g:any)=>g.items.map((e:any)=>e.key)),[['payroll']]);
 assert.deepEqual(groupHomeEntries(entries.filter(e=>e.key==='customers'),'luong'),[]);
 assert.equal(groupHomeEntries(entries).flatMap((g:any)=>g.items).length,2);
 assert.equal(new URL(homeTaskHref('all','overdue'),'https://test').searchParams.get('due'),null,'filters are hash routes');
 assert.equal(homeTaskHref('all','overdue'),'#/tasks?home=1&view=all&due=overdue');
 assert.equal(homeTaskHref('mine','today'),'#/tasks?home=1&view=mine&due=today');
 for(const path of ['/tasks/home','/tasks/home?filter=overdue'])assert.equal(isCacheable(path),false,'counts never persist as cached task details');
 assert.equal(isCacheable('/tasks/real-id'),true,'existing task cache retained');
});
test('bell and Home coalesce reads, invalidate on marking read, never retain another session notification snapshot',async()=>{
 let who='a',now=0,calls=0,finish:any;
 const api=async(_path:string,method='GET')=>{calls++;if(method==='POST')return{ok:true};return new Promise(resolve=>{finish=resolve;});};
 const feed=createNotificationFeed({api,identity:()=>who,now:()=>now}),a=feed.read('/notifications'),b=feed.read('/notifications');await Promise.resolve();assert.equal(calls,1);
 finish({notifications:[{id:'a-private'}]});await Promise.all([a,b]);await feed.read('/notifications');assert.equal(calls,1);
 await feed.read('/notifications/read','POST',{ids:['a-private']});const c=feed.read('/notifications');await Promise.resolve();assert.equal(calls,3);const finishA=finish;
 who='b';const d=feed.read('/notifications');await Promise.resolve();const finishB=finish;finishB({notifications:[]});await d;await feed.read('/notifications');assert.equal(calls,4);
 feed.clear();now=4000;const e=feed.read('/notifications');await Promise.resolve();assert.equal(calls,5);finish({notifications:[]});await e;
 finishA({notifications:[{id:'old-private'}]});await assert.rejects(c,/Phiên thông báo/);assert.deepEqual(await feed.read('/notifications'),{notifications:[]},'late old read cannot replace current session data');
});
