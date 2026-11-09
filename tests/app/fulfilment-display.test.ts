import {test} from 'node:test';
import assert from 'node:assert/strict';
const ui=await import(new URL('../../trial-ui/fulfilment-display.js',import.meta.url).href);
test('line color respects cancellation and delivered quantities before overdue/scheduling hints',()=>{
 const row={orderStatus:'confirmed',remainingQty:10,deliveredQty:0,availableQty:10,overdue:false};
 assert.equal(ui.orderProductState(row),'unscheduled');
 assert.equal(ui.orderProductState({...row,availableQty:0}),'planned');
 assert.equal(ui.orderProductState({...row,trips:[{status:'in_transit'}]}),'in_transit');
 assert.equal(ui.orderProductState({...row,trips:[{status:'cancelled'}]}),'unscheduled');
 assert.equal(ui.orderProductState({...row,deliveredQty:2}),'partial');
 assert.equal(ui.orderProductState({...row,deliveredQty:2,overdue:true}),'overdue');
 assert.equal(ui.orderProductState({...row,remainingQty:0,overdue:true}),'delivered');
 assert.equal(ui.orderProductState({...row,orderStatus:'cancelled',remainingQty:0,overdue:true}),'cancelled');
});
