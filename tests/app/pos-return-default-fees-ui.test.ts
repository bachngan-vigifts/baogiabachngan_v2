import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser module, pure helpers only.
import {remainingPosFees,returnsEverything} from '../../trial-ui/pos-returns.js';
test('fees charged on the bill are suggested once, minus fees already held by active requests',()=>{
 const order={posSnapshot:JSON.stringify({fees:{service:{amount:10800},shippingFee:20000}})};
 assert.deepEqual(remainingPosFees(order,[]),{service:10800,shipping:20000});
 assert.deepEqual(remainingPosFees(order,[{status:'pending',requestedServiceFee:10800,requestedShippingFee:5000},{status:'rejected',requestedServiceFee:10800,requestedShippingFee:20000}]),{service:0,shipping:15000});
 assert.deepEqual(remainingPosFees({posSnapshot:'{}'},[]),{service:0,shipping:0});
 assert.deepEqual(remainingPosFees({posSnapshot:'not json'},[]),{service:0,shipping:0});
});
test('only a return of everything still returnable counts as a full return',()=>{
 const row=(value:string,left:number)=>({qty:{value},left});
 assert.equal(returnsEverything([row('2',2),row('1',1)]),true);
 assert.equal(returnsEverything([row('2',2),row('',1)]),false);
 assert.equal(returnsEverything([row('1',2)]),false);
 assert.equal(returnsEverything([]),false);
});
