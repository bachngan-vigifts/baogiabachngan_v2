import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';

const source=readFileSync(new URL('../../trial-ui/app.js',import.meta.url),'utf8');
const home=source.slice(source.indexOf('const KHO_HOME ='),source.indexOf('// ---------------------------------------------------------------- đăng nhập'));
const open=source.slice(source.indexOf('function openWorkspace('),source.indexOf('function refreshWorkspaceUser('));

function harness(positionId:string,role='employee',perms=['pos.sell','page.quotes']){
 const user={positionId,role};
 const context:any={state:{user},location:{hash:'#/orders',pathname:'/index.html'},
  isWarehouse:()=>role==='employee'&&positionId==='warehouse',can:(key:string)=>role==='manager'||perms.includes(key),
  applyWorkspaceUser:()=>true,currentHash:'',route(){},loadAll(){},notifier:{start(){}},
  dataRefresh:{start(){},tick(){}},pulse:{start(){}},qrPhoneView:()=>({start(){}}),requestPriority:{idle:()=>Promise.resolve()},history:{replaceState(_a:unknown,_b:unknown,url:string){context.location.hash=url.slice(url.indexOf('#'));}}};
 runInNewContext(home+'\n'+open+'\nthis.homeHash=homeHash;this.start=(fresh)=>{loginToHome=fresh;openWorkspace(state.user);};',context);
 return context;
}

test('warehouse login opens its workbench; other positions keep common Home without granting page permissions',()=>{
 for(const role of ['employee','manager'])for(const position of ['sales-ml','sales-lock','sale','sale-admin','warehouse','accounting','custom']){
  const app=harness(position,role,[]),expected=role==='employee'&&position==='warehouse'?'#/kho':'#/home';assert.equal(app.homeHash(),expected);
  app.start(true);assert.equal(app.location.hash,expected);
 }
});
test('resume and direct document login retain the requested route; login from a generic list opens Home',()=>{
 for(const role of ['employee','manager']){
  const app=harness('sale',role);app.location.hash='#/orders/existing';app.start(true);assert.equal(app.location.hash,'#/orders/existing');
  app.location.hash='#/customers/abc';app.start(false);assert.equal(app.location.hash,'#/customers/abc');
  app.location.hash='#/quotes';app.start(true);assert.equal(app.location.hash,'#/home');
  app.location.hash='';app.start(false);assert.equal(app.location.hash,'#/home');
 }
});
