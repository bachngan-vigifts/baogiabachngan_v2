import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
async function setup(allowed=true){
 const events:Record<string,Function>={},attrs:Record<string,string>={},calls:string[]=[],navigation:string[]=[],timeouts:Function[]=[];
 const button={hidden:true,title:'',dataset:{} as Record<string,string>,setAttribute:(k:string,v:string)=>attrs[k]=v,addEventListener:(k:string,fn:Function)=>events[k]=fn};
 const badge={textContent:'',hidden:false};let count=7,manager=allowed,uid='mgr',failure=false,pending:Promise<any>|null=null;
 const context:any={document:{hidden:false,addEventListener(){}},setInterval:()=>1,clearInterval(){},setTimeout:(fn:Function)=>{timeouts.push(fn);return timeouts.length;},clearTimeout(){}};
 runInNewContext(readFileSync(new URL('../../trial-ui/approval-launcher.js',import.meta.url),'utf8').replace('export function initApprovalLauncher','globalThis.initApprovalLauncher = function'),context);
 const api=async(path:string)=>{calls.push(path);if(pending)return pending;if(failure)throw Object.assign(Error('Mất kết nối'),{status:0});return{counts:{total:count,quote:count?3:0,order:count?4:0}};};
 const ui=context.initApprovalLauncher({api,button,badge,canApprove:()=>manager,userId:()=>uid,go:(h:string)=>navigation.push(h)});
 return{ui,button,badge,attrs,calls,navigation,events,timeouts,setCount:(n:number)=>count=n,fail:()=>failure=true,setPending:(p:Promise<any>)=>pending=p,logout:()=>{uid='';manager=false;ui.stop();}};
}
test('icon cần duyệt: hiện tổng/theo loại, mở đúng hộp và cập nhật sau duyệt',async()=>{
 const s=await setup();await s.ui.start();assert.equal(s.button.hidden,false);assert.equal(s.badge.textContent,'7');assert.match(s.button.title,/Báo giá: 3/);assert.equal(s.calls[0],'/approvals?summary=1');
 s.events.click!();assert.deepEqual(s.navigation,['#/tasks/approvals']);s.setCount(0);s.ui.scheduleRefresh();await s.timeouts.at(-1)!();assert.equal(s.badge.textContent,'0');assert.match(s.button.title,/Không có việc/);
});
test('icon cần duyệt: ẩn với người không được duyệt; lỗi không biến thành số 0',async()=>{
 const denied=await setup(false);await denied.ui.start();assert.equal(denied.calls.length,0);assert.equal(denied.button.hidden,true);
 const s=await setup();await s.ui.start();s.fail();await s.ui.refresh();assert.equal(s.badge.textContent,'!');assert.match(s.button.title,/Mất kết nối/);
});
test('icon cần duyệt: phản hồi phiên cũ không hiện lại sau đăng xuất',async()=>{
 const s=await setup();let resolve!:(x:any)=>void;s.setPending(new Promise(r=>resolve=r));const loading=s.ui.start();s.logout();resolve({counts:{total:999}});await loading;assert.equal(s.button.hidden,true);assert.equal(s.badge.textContent,'0');
});
