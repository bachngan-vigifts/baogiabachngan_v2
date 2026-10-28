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

test('fresh employee login opens process flow when allowed; resume preserves the current document',()=>{
 for(const position of ['sales-ml','sales-lock','sale','sale-admin','accounting','warehouse']){
  const app=harness(position,'employee',['pos.sell','page.quotes','page.flow']);assert.equal(app.homeHash(),'#/flow');
  app.start(true);assert.equal(app.location.hash,'#/flow');app.location.hash='#/orders/existing';app.start(false);assert.equal(app.location.hash,'#/orders/existing');
 }
});
test('home never grants process-flow permission and preserves Manager default',()=>{
 assert.equal(harness('sales-lock').homeHash(),'#/pos');
 assert.equal(harness('sale','employee',['page.quotes']).homeHash(),'#/quotes');
 assert.equal(harness('manager','manager').homeHash(),'#/quotes');
 assert.equal(harness('warehouse','employee',[]).homeHash(),'#/kho');
});
