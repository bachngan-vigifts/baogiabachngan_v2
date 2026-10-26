import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';

const source=readFileSync(new URL('../../trial-ui/app.js',import.meta.url),'utf8');
const home=source.slice(source.indexOf('const KHO_HOME ='),source.indexOf('// ---------------------------------------------------------------- đăng nhập'));
const open=source.slice(source.indexOf('function openWorkspace('),source.indexOf('function refreshWorkspaceUser('));

function harness(positionId:string,role='employee',perms=['pos.sell','page.quotes']){
 const user={positionId,role};
 const context:any={state:{user},location:{hash:'#/orders/existing',pathname:'/index.html'},
  isWarehouse:()=>positionId==='warehouse',can:(key:string)=>role==='manager'||perms.includes(key),
  applyWorkspaceUser:()=>true,currentHash:'',route(){},loadAll(){},notifier:{start(){}},
  dataRefresh:{start(){},tick(){}},pulse:{start(){}},history:{replaceState(_a:unknown,_b:unknown,url:string){context.location.hash=url.slice(url.indexOf('#'));}}};
 runInNewContext(home+'\n'+open+'\nthis.homeHash=homeHash;this.start=(fresh)=>{loginToHome=fresh;openWorkspace(state.user);};',context);
 return context;
}

test('NVBH ML/LOCK login goes directly to POS even with a previous route; resume preserves the document',()=>{
 for(const position of ['sales-ml','sales-lock']){
  const app=harness(position);
  assert.equal(app.homeHash(),'#/pos');
  app.start(true);assert.equal(app.location.hash,'#/pos');
  app.location.hash='#/orders/existing';app.start(false);
  assert.equal(app.location.hash,'#/orders/existing');
  app.location.hash='';app.start(false);assert.equal(app.location.hash,'#/pos');
 }
});

test('POS home respects permission and does not change other roles',()=>{
 for(const position of ['sales-ml','sales-lock','sale','sale-admin','accounting']){
  const app=harness(position,'employee',['page.quotes']);
  assert.equal(app.homeHash(),'#/quotes');app.start(true);assert.equal(app.location.hash,'#/orders/existing');
 }
 assert.equal(harness('sales-ml','employee',[]).homeHash(),'#/tasks');
 assert.equal(harness('manager','manager').homeHash(),'#/quotes');
 assert.equal(harness('warehouse').homeHash(),'#/kho');
});
