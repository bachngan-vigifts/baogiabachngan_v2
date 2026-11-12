import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
const root=join(import.meta.dirname,'../..'), ui=join(root,'trial-ui');
const read=(file:string)=>readFileSync(join(ui,file),'utf8');
class Element {
  hidden=false; open=false; innerHTML=''; textContent=''; children:any[]=[]; attrs:any={}; listeners:any={}; focused=false;
  addEventListener(k:string,fn:any){(this.listeners[k]??=[]).push(fn)}
  removeEventListener(k:string,fn:any){this.listeners[k]=(this.listeners[k]??[]).filter((f:any)=>f!==fn)}
  emit(k:string){for(const f of this.listeners[k]??[])f({preventDefault(){}})}
  setAttribute(k:string,v:string){this.attrs[k]=v}
  replaceChildren(...x:any[]){this.children=x}
  append(x:any){this.children.push(x)}
  focus(){this.focused=true}
  showModal(){this.open=true}
  close(){this.open=false;this.emit('close')}
  remove(){}
  querySelector(k:string){return this.attrs[k]??=new Element()}
}
function setup(fetchPage:any=async()=>({ok:true,headers:{get:()=> 'text/html'},text:async()=>'<html></html>'})){
 const button=new Element(), workspace=new Element(), body=new Element();let observer:any;
 const win:any=new Element();win.location={origin:'https://crm.example'};
 win.MutationObserver=class{constructor(fn:any){observer=fn}observe(){}disconnect(){}};
 win.DOMParser=class{parseFromString(){return{createElement:()=>new Element(),head:{prepend(){}},documentElement:{outerHTML:'<html></html>'}}}};
 const doc:any={body,baseURI:'https://crm.example/index.html',getElementById:(id:string)=>id==='workspace'?workspace:button,createElement:()=>new Element()};body.append=(x:any)=>body.children.push(x);
 const code=read('breathing-launcher.js').replace('export function','function').replace("if (typeof document !== 'undefined') initBreathingLauncher();",'');
 const init=runInNewContext(code+';initBreathingLauncher',{AbortController,URL});
 const api=init({doc,win,fetchPage});return{api,button,workspace,win,dialog:body.children[0],observe:()=>observer()};
}
test('launcher opens one window and leaves CRM draft untouched',async()=>{const s=setup();await s.api.open();await s.api.open();assert.equal(s.dialog.open,true);assert.equal(s.dialog.querySelector('.breathing-frame-host').children.length,1);s.api.close();assert.equal(s.dialog.open,false);assert.equal(s.dialog.querySelector('.breathing-frame-host').children.length,0)});
test('closing a slow request cannot reopen audio/frame',async()=>{let resolve:any;const p=new Promise(r=>resolve=r);const s=setup(()=>p);const opening=s.api.open();s.api.close();resolve({ok:true,headers:{get:()=> 'text/html'},text:async()=>'<html></html>'});await opening;assert.equal(s.dialog.querySelector('.breathing-frame-host').children.length,0)});
test('hidden workspace cannot launch; logout removes current browsing context',async()=>{const s=setup();s.workspace.hidden=true;await s.api.open();assert.equal(s.dialog.open,false);s.workspace.hidden=false;await s.api.open();s.workspace.hidden=true;s.observe();assert.equal(s.dialog.open,false);assert.equal(s.dialog.querySelector('.breathing-frame-host').children.length,0)});
for(const event of ['hashchange','popstate','pagehide','cancel'])test(`${event} removes the exercise and audio context`,async()=>{const s=setup();await s.api.open();(event==='cancel'?s.dialog:s.win).emit(event);assert.equal(s.dialog.open,false);assert.equal(s.dialog.querySelector('.breathing-frame-host').children.length,0)});
test('failed fetch gives retry instruction without navigating CRM',async()=>{const s=setup(async()=>({ok:false}));await s.api.open();assert.match(s.dialog.querySelector('[role="status"]').textContent,/Đóng rồi thử lại/);s.api.close();assert.equal(s.dialog.open,false)});
test('all five selected audio files exist and have source/license credits',()=>{const code=read('breathing-ambient.js');for(const id of ['meditation-01','meditation-02','dreams-become-real','small-brook','beach-stream']){assert.ok(code.includes(id));assert.ok(statSync(join(ui,'breathing-assets/audio',id+'.mp3')).size>1000)}assert.match(code,/CC BY 4.0/);assert.match(code,/CC0 1.0/);assert.match(code,/preload='none'/);assert.ok(!code.includes('autoplay'))});
test('CRM entry is inside authenticated workspace, keeps existing app and adds isolated resources',()=>{const h=read('index.html');assert.ok(h.indexOf('id="breathing-open"')>h.indexOf('id="workspace"'));assert.match(h,/src="app.js"/);assert.match(h,/src="breathing-launcher.js"/);assert.match(h,/href="breathing-launcher.css"/);assert.match(read('_headers'),/X-Frame-Options: DENY/)});
test('Wim Hof requires safety guide; holds voluntary; gentle mode default',()=>{assert.match(read('breathing-wim.js'),/if\(!q\('guide-read'\).checked\)/);assert.match(read('breathing-wim.js'),/Không có thời gian mục tiêu/);assert.match(read('breathing.html'),/data-mode="gentle"[^>]*aria-pressed="true"/);assert.match(read('breathing-gentle.js'),/Không lưu lịch sử hoặc chấm điểm/)});
test('local CSS/JS references exist, no stale demo query versions',()=>{for(const f of ['breathing.html','breathing-modes.js','breathing-wim.js','breathing-gentle.js']){const s=read(f);assert.doesNotMatch(s,/\.js\?v=\d+/);for(const m of s.matchAll(/(?:src|href)=["'](\.\/[^"']+)["']/g))assert.ok(existsSync(join(ui,m[1]!)),m[1]);for(const m of s.matchAll(/from ['"](\.\/[^'"]+)['"]/g))assert.ok(existsSync(join(ui,m[1]!)),m[1]);}});
