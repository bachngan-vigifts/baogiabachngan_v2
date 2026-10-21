import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup} from '../helpers/pos-fixture.ts';
import {cashDrawers,cashReconciliations} from '../../src/modules/sales/cash-schema.ts';
// @ts-ignore presentation uses the server's expected balance
import {shiftFigures} from '../../trial-ui/shift-report-view.js';
// @ts-ignore shared K80 report rows
import {shiftSummaryRows,shiftReportSections} from '../../trial-ui/pos-report.js';

test('current shift: opening 1, posted correction -1 -> expected 0, void/replay are safe, close and next opening 0',async()=>{
 const f=await setup();await f.db.update(cashDrawers).set({openingAmount:1});
 const s=await f.open();assert.equal(s.openingCash,1);
 const body={key:crypto.randomUUID(),kind:'adjustment',direction:'out',amount:1,reason:'Đếm nhầm 1 đồng đầu ca'};
 const saved=await f.call('/cash/entries',f.mgr,'POST',body);assert.equal(saved.status,201,JSON.stringify(saved.data));
 const report=async()=>(await f.call('/cash/shifts/'+s.id,f.emp)).data;
 let d=await report();assert.equal(d.expectedCash,0);assert.equal(d.shift.openingCash,1,'retain original audit count');
 assert.equal(d.currentAdjustmentNet,-1);assert.equal(d.manual.length,0,'correction is not real expense');assert.equal(d.cash,0);
 assert.equal(d.bookAdjustments[0].affectsShiftCash,true);
 const figures=shiftFigures(d);assert.equal(figures.adjustment,-1);assert.equal(figures.expected,0);assert.equal(figures.other,0);
 const rows=shiftSummaryRows(d);assert.deepEqual(rows.find((r:any)=>r[0]==='Điều chỉnh két ca này'),['Điều chỉnh két ca này','-1 đ']);
 assert.deepEqual(shiftReportSections(d).find((s:any)=>s.key==='drawer').rows.find((r:any)=>r[0]==='Điều chỉnh két ca này'),['Điều chỉnh két ca này','-1 đ']);
 assert.equal((await f.call('/cash/entries',f.mgr,'POST',body)).data.replayed,true);assert.equal((await report()).expectedCash,0);
 assert.equal((await f.call('/cash/entries/'+saved.data.id+'/void',f.mgr,'POST',{reason:'Kiểm tra hoàn tác'})).status,200);
 assert.equal((await report()).expectedCash,1);
 await f.call('/cash/entries',f.mgr,'POST',{...body,key:crypto.randomUUID()});
 const close=await f.call('/cash/shifts/'+s.id+'/close',f.emp,'POST',{countedCash:0});assert.equal(close.status,200,JSON.stringify(close.data));
 assert.equal(close.data.expectedCash,0);assert.equal(close.data.cashDifference,0);
 assert.equal((await f.db.select().from(cashReconciliations)).length,0,'no false reconciliation');
 assert.equal((await f.call('/cash/shifts/'+s.id,f.emp)).data.expectedCash,0,'saved report agrees');
 const next=await f.open();assert.equal(next.openingCash,0);
});

test('correction linked to this shift opening discrepancy affects expected cash; pending/voided corrections do not',async()=>{
 const f=await setup();await f.db.update(cashDrawers).set({openingAmount:0});
 const opened=await f.call('/pos/shifts/open',f.emp,'POST',{key:crypto.randomUUID(),registerId:f.registerId,openingCash:1});
 assert.equal(opened.status,201,JSON.stringify(opened.data));
 const [rec]=await f.db.select().from(cashReconciliations);assert.ok(rec);assert.equal(rec.shiftId,opened.data.id);
 const correction=await f.call('/cash/entries',f.mgr,'POST',{key:crypto.randomUUID(),kind:'adjustment',direction:'out',amount:1,reason:'Sửa đếm đầu ca này',reconciliationId:rec.id});
 assert.equal(correction.status,201,JSON.stringify(correction.data));
 let d=(await f.call('/cash/shifts/'+opened.data.id,f.emp)).data;assert.equal(d.expectedCash,0);assert.equal(d.currentAdjustmentNet,-1);
 const pending=await f.call('/cash/entries',f.mgr,'POST',{key:crypto.randomUUID(),kind:'adjustment',direction:'in',amount:1000000,reason:'Chưa duyệt không tính'});
 assert.equal(pending.data.status,'pending');
 d=(await f.call('/cash/shifts/'+opened.data.id,f.emp)).data;assert.equal(d.expectedCash,0);assert.equal(d.currentAdjustmentNet,-1);
 assert.equal((await f.call('/cash/shifts/'+opened.data.id+'/close',f.emp,'POST',{countedCash:0})).status,409);
 await f.call('/cash/entries/'+pending.data.id+'/void',f.mgr,'POST',{reason:'Huỷ phiếu chưa duyệt'});
 assert.equal((await f.call('/cash/shifts/'+opened.data.id+'/close',f.emp,'POST',{countedCash:0})).status,200);
});
