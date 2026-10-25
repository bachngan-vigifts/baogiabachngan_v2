import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveEarlyOrderSources as resolve,EarlySourceError} from '../../src/modules/suppliers/domain/early-order-sources.ts';
const orders=[
 {id:'1',lineId:'l1',ticketNumber:'DMH_001',internalNo:'000123',quantity:5,unit:'Cái'},
 {id:'2',lineId:'l2',ticketNumber:'DMH_002',internalNo:'000124',quantity:8,unit:'Cái'},
];
test('supplier-only matches exact identifier, retains leading zeros and rejects ambiguous/mismatched references',()=>{
 assert.deepEqual(resolve(orders,[{orderNo:'',supplierOrderNo:'000123',quantity:3}]).sources,[{orderNo:'DMH_001',supplierOrderNo:'000123',quantity:3}]);
 for(const supplierOrderNo of ['123','MISSING'])assert.throws(()=>resolve(orders,[{orderNo:'',supplierOrderNo,quantity:1}]),{code:'EARLY_QUANTITY_EXCEEDED'});
 assert.throws(()=>resolve([...orders,{...orders[1]!,internalNo:'000123'}],[{orderNo:'',supplierOrderNo:'000123',quantity:1}]),{code:'EARLY_SOURCE_AMBIGUOUS'});
 assert.throws(()=>resolve(orders,[{orderNo:'DMH_002',supplierOrderNo:'000123',quantity:1}]),EarlySourceError);
});
test('named source reserves before automatic rows; overlapping references cannot overbook the same purchase line',()=>{
 const resolved=resolve(orders,[{orderNo:'',supplierOrderNo:'',quantity:8},{orderNo:'DMH_001',supplierOrderNo:'',quantity:5}]);
 assert.deepEqual(resolved.sources,[{orderNo:'DMH_001',supplierOrderNo:'',quantity:5},{orderNo:'DMH_002',supplierOrderNo:'',quantity:8}]);
 assert.equal(resolved.groups[0]!.allocations[0]!.order.ticketNumber,'DMH_002');
 const overlap=[{orderNo:'DMH_001',supplierOrderNo:'',quantity:3},{orderNo:'',supplierOrderNo:'000123',quantity:2}];
 assert.equal(resolve(orders,overlap).allocations.length,1);assert.equal(resolve(orders,overlap).allocations[0]!.quantity,5);
 assert.throws(()=>resolve(orders,[...overlap,{orderNo:'DMH_001',supplierOrderNo:'000123',quantity:1}]),{code:'EARLY_QUANTITY_EXCEEDED'});
 assert.throws(()=>resolve([...orders,{...orders[1]!,unit:'Bộ'}],[{orderNo:'',supplierOrderNo:'',quantity:6}]),{code:'EARLY_UNIT_CONFLICT'});
});
