import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync('trial-ui/app-startup.js','utf8');
function setup(){
 const elements:Record<string,any>={};for(const id of ['app-startup','app-startup-message','app-startup-retry','auth','workspace'])elements[id]={hidden:id!=='app-startup',textContent:'',addEventListener:(name:string,fn:Function)=>{elements[id][name]=fn;}};
 const events:Record<string,Function>={};let changed!:Function,slow!:Function,disconnected=false,reloaded=0,cleared=false;
 runInNewContext(source,{document:{getElementById:(id:string)=>elements[id]},window:{addEventListener:(n:string,fn:Function)=>events[n]=fn,removeEventListener:(n:string)=>delete events[n]},location:{reload:()=>reloaded++},MutationObserver:class{constructor(fn:Function){changed=fn;}observe(){}disconnect(){disconnected=true;}},setTimeout:(fn:Function)=>{slow=fn;return 1;},clearTimeout:()=>cleared=true});
 return{elements,events,slow:()=>slow(),changed:()=>changed(),get disconnected(){return disconnected;},get reloaded(){return reloaded;},get cleared(){return cleared;}};
}
test('startup: pending session has a visible screen; slow request offers reload without erasing session',()=>{
 const s=setup();assert.equal(s.elements['app-startup'].hidden,false);s.slow();assert.match(s.elements['app-startup-message'].textContent,/Kết nối đang chậm/);assert.equal(s.elements['app-startup-retry'].hidden,false);s.elements['app-startup-retry'].click();assert.equal(s.reloaded,1);
});
test('startup: module/resource failure offers recovery, later successful startup clears it',()=>{
 const s=setup();s.events.error!();assert.match(s.elements['app-startup-message'].textContent,/Chưa tải được CRM/);assert.equal(s.elements['app-startup-retry'].hidden,false);s.elements.workspace.hidden=false;s.changed();assert.equal(s.elements['app-startup'].hidden,true);assert.equal(s.disconnected,true);assert.equal(s.cleared,true);assert.equal(s.events.error,undefined);
});
test('startup: login/activation also dismisses loader; ordinary later errors cannot cover the app',()=>{
 const s=setup();s.elements.auth.hidden=false;s.changed();assert.equal(s.elements['app-startup'].hidden,true);assert.equal(s.events.unhandledrejection,undefined);assert.equal(s.elements['app-startup-retry'].hidden,true);
});
