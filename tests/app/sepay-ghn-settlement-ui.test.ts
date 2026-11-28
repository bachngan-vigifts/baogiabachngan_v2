import assert from 'node:assert/strict';
import test from 'node:test';
const modulePath = '../../trial-ui/sepay-allocations.js';
const {allocationTotals,ghnSettlementDraft,isGhnSettlementMemo,parseGhnSettlementRows} = await import(modulePath);

test('GHN payout sender controls the filter, not an unrelated memo or a waybill',()=>{
 for(const memo of ['CTCP DICH VU GIAO HANG NHANH-TEST 26112026',' ctcp Dịch vụ Giao Hàng Nhanh – TEST']) assert.equal(isGhnSettlementMemo(memo),true);
 for(const memo of ['khach tra GHN','tra phi CTCP DICH VU GIAO HANG NHANH','CTCP DICH VU GIAO HANG NHANHX',null]) assert.equal(isGhnSettlementMemo(memo),false);
});
test('parse a whole payout with explicit per-waybill fees; reject unknown differences',()=>{
 const raw='DEMO123\t100.000\t5.000\t95.000\nDEMO456\t40,000\t0\t40,000';
 const rows=parseGhnSettlementRows(raw,135000);
 assert.deepEqual(rows,[{code:'DEMO123',cod:100000,fee:5000,net:95000},{code:'DEMO456',cod:40000,fee:0,net:40000}]);
 assert.throws(()=>parseGhnSettlementRows(raw,134000),/Tổng thực nhận/);
 assert.throws(()=>parseGhnSettlementRows(raw.replace('5.000','-5.000'),135000),/số tiền nguyên/);
 assert.throws(()=>parseGhnSettlementRows(raw.replace('DEMO456','demo123'),135000),/bị trùng/);
 assert.throws(()=>parseGhnSettlementRows(raw.replace('95.000','92.000'),132000),/COD phải bằng/);
 assert.throws(()=>parseGhnSettlementRows(raw.replace('5.000',''),135000),/số tiền nguyên/);
});
test('only exact unambiguous existing COD receipts become a draft; no fee hints used',()=>{
 const rows=parseGhnSettlementRows('DEMO123\t100000\t5000\t95000\nDEMO456\t40000\t0\t40000',135000);
 const a={targetId:'one',ghnCode:'NEWER12',ghnFeeHint:777,existingPayments:[{id:'receipt1',source:'ghn_cod',reference:'demo123',amount:100000}]};
 const b={targetId:'two',ghnCode:'DEMO456',ghnFeeHint:3000,existingPayments:[{id:'receipt2',source:'ghn_cod',reference:'DEMO456',amount:40000}]};
 const lines=ghnSettlementDraft(rows,[[a],[b]]);
 assert.deepEqual(lines.map((x: {ghnCode:string;existingPaymentId:string;ghnFee:number;amount:number})=>[x.ghnCode,x.existingPaymentId,x.ghnFee,x.amount]),[['DEMO123','receipt1',5000,95000],['DEMO456','receipt2',0,40000]]);
 assert.deepEqual(allocationTotals({remaining:135000},lines),{amount:135000,remaining:0,valid:true});
 assert.throws(()=>ghnSettlementDraft(rows,[[a,{...a,targetId:'third'}],[b]]),/đúng một/);
 assert.throws(()=>ghnSettlementDraft(rows,[[a],[{...b,targetId:'one'}]]),/trùng đơn/);
 assert.throws(()=>ghnSettlementDraft(rows,[[a],[{...b,existingPayments:[{...b.existingPayments[0],amount:39999}]}]]),/không khớp/);
 assert.throws(()=>ghnSettlementDraft(rows,[[a],[{...b,existingPayments:[]}]]),/không khớp/);
});
