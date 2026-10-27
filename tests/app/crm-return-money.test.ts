import {test} from 'node:test';
import assert from 'node:assert/strict';
import {crmReturnAmounts} from '../../src/modules/sales/domain/crm-return-money.ts';
import {orderTotals} from '../../src/modules/sales/domain/sales.ts';
import {returnPortion} from '../../src/modules/sales/domain/pos-return-money.ts';
test('CRM returns allocate original document rounding exactly across mixed tax rates and repeated partial returns',()=>{
 for(let i=1;i<=200;i++){
  const lines=[{id:'a',amount:i*13.1234,taxRate:8},{id:'b',amount:i*7.2456,taxRate:10},{id:'c',amount:i*.4567,taxRate:0}];const total=orderTotals(lines),amounts=crmReturnAmounts(total,lines);
  assert.equal([...amounts.values()].reduce((n,l)=>n+l.subtotal,0),total.subtotal);assert.equal([...amounts.values()].reduce((n,l)=>n+l.tax,0),total.tax);assert.equal(amounts.get('c')!.tax,0);
  for(const line of amounts.values())for(const amount of [line.subtotal,line.tax]){let allocated=0;for(let already=0;already<3;already++)allocated+=returnPortion(amount,3,already,1,allocated);assert.equal(allocated,amount);}
 }
});
test('CRM returns reject mismatched totals and invalid source values before assigning credit',()=>{
 assert.throws(()=>crmReturnAmounts({subtotal:1,tax:0,total:2},[{id:'a',amount:1,taxRate:0}]),/không khớp/);
 assert.throws(()=>crmReturnAmounts({subtotal:-1,tax:0,total:-1},[{id:'a',amount:-1,taxRate:0}]),/không khớp/);
});
