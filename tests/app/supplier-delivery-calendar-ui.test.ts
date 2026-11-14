import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-ignore Browser module, pure helpers only.
import {monthCells,groupByDay,shiftMonth} from '../../trial-ui/supplier-delivery-calendar.js';

test('month grid starts on Monday, pads to whole weeks and handles leap years',()=>{
 const nov=monthCells(2026,11);assert.equal(nov.length%7,0);assert.equal(nov.indexOf('2026-11-01'),6,'1/11/2026 là Chủ nhật');assert.equal(nov.filter(Boolean).length,30);assert.equal(nov.at(-1),null);
 const june=monthCells(2026,6);assert.equal(june[0],'2026-06-01','1/6/2026 là thứ Hai');assert.equal(june.filter(Boolean).length,30);
 assert.equal(monthCells(2028,2).filter(Boolean).length,29);assert.equal(monthCells(2026,2).filter(Boolean).length,28);
 assert.deepEqual(shiftMonth(2026,12,1),[2027,1]);assert.deepEqual(shiftMonth(2026,1,-1),[2025,12]);
});

test('orders are grouped by promised day; cancelled and undated orders stay off the calendar',()=>{
 const days=groupByDay([{id:'a',expected:'2026-11-17',quantity:670,status:'confirmed'},{id:'b',expected:'2026-11-17',quantity:30,status:'awaiting_confirmation'},{id:'c',expected:'2026-11-30',quantity:2000,status:'confirmed'},{id:'d',expected:'2026-11-17',quantity:999,status:'cancelled'},{id:'e',expected:null,quantity:5,status:'confirmed'},{id:'f',expected:'17/11/2026',quantity:5,status:'confirmed'},{id:'g',expected:'2026-11-18',quantity:null,status:'confirmed'}]);
 assert.deepEqual([...days.keys()].sort(),['2026-11-17','2026-11-18','2026-11-30']);
 assert.deepEqual(days.get('2026-11-17').orders.map((o:any)=>o.id),['a','b']);assert.equal(days.get('2026-11-17').quantity,700);assert.equal(days.get('2026-11-18').quantity,0);
});

test('calendar is read-only and reachable from the supplier overview',()=>{
 const calendar=readFileSync(new URL('../../trial-ui/supplier-delivery-calendar.js',import.meta.url),'utf8'),workspace=readFileSync(new URL('../../trial-ui/supplier-workspace.js',import.meta.url),'utf8');
 assert.doesNotMatch(calendar,/'POST'|'PUT'|'PATCH'|'DELETE'|\bfetch\(|localStorage|innerHTML=[^`'"<]*\+\s*o\./);
 assert.match(calendar,/dateField:'expected'/);assert.match(workspace,/href=\\?"#calendar\\?"/);assert.match(workspace,/key==='calendar'/);
});
