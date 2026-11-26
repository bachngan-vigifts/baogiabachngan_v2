import {test} from 'node:test';import assert from 'node:assert/strict';
// @ts-ignore Browser module.
import {parseTransferFile,TRANSFER_HEADERS} from '../../trial-ui/transfer-file.js';
const wh=[{id:'a',name:'Kho đi thử'},{id:'b',name:'Kho nhận thử'},{id:'c',name:'Kho khác'}];
test('transfer file keeps leading zeros, resolves warehouse names/IDs and accepts 30 distinct rows',()=>{
 const rows=Array.from({length:30},(_,i)=>['Kho đi thử','b','00'+i,i+1]);const parsed=parseTransferFile([TRANSFER_HEADERS,...rows],wh);assert.deepEqual(parsed.errors,[]);assert.equal(parsed.lines.length,30);assert.equal(parsed.lines[0].sku,'000');assert.equal(parsed.fromId,'a');assert.equal(parsed.toId,'b');
});
test('transfer import rejects malformed headers, duplicate SKU, numeric SKU, invalid quantity and mixed/unknown warehouses',()=>{
 for(const row of [['a','a','001',1],['a','missing','001',1],['a','b',123,1],['a','b','001',0],['a','b','001',-1],['a','b','001','1,000'],['a','b','001',10000001]])assert.ok(parseTransferFile([TRANSFER_HEADERS,row],wh).errors.length,JSON.stringify(row));
 assert.ok(parseTransferFile([TRANSFER_HEADERS,['a','b','001',1],['a','c','002',1]],wh).errors.length);
 assert.ok(parseTransferFile([TRANSFER_HEADERS,['a','b','001',1],['a','b','001',1]],wh).errors.length);
 assert.ok(parseTransferFile([['Mã hàng'],['001']],wh).errors.length);
 assert.ok(parseTransferFile([TRANSFER_HEADERS,...Array.from({length:201},(_,i)=>['a','b','00'+i,1])],wh).errors.length);
});
