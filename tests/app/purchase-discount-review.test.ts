import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultCostDiscount} from '../../src/modules/quotes/domain/quote-math.ts';
// @ts-expect-error Native browser module.
import {purchaseCostReviewRows,missingPurchaseCost} from '../../trial-ui/purchase-cost-review.js';

test('Hoàng Cung / Đài Các mặc định 27%, nhận tên có/không dấu và pattern; các nhóm cũ giữ nguyên',()=>{
  for(const p of [{brand:'MINH LONG',name:'Bộ trà Hoàng Cung'},{brand:'MINH LONG',name:'Bộ trà 1.3 L Đài các T.tri hoa'},{name:'DAI CAC'},{pattern:'HOANG CUNG'},{name:'Đài Các - Trắng'}])assert.equal(defaultCostDiscount(p),27,JSON.stringify(p));
  assert.equal(defaultCostDiscount({brand:'MINH LONG',name:'Bộ trà thông thường'}),25);
  assert.equal(defaultCostDiscount({brand:'LocknLock'}),58);
  assert.equal(defaultCostDiscount({brand:'Healthy Cook'}),15);
  assert.equal(defaultCostDiscount({brand:'Minh Long - Lys'}),19);
  assert.equal(defaultCostDiscount({name:'Đại Cát'}),null);
});

test('Bảng CK giữ số nhập tay %, kể cả 0; giá nhập tay; chỉ gợi ý khi còn trống',()=>{
  const rows=[{name:'Bộ trà Đài Các',price:7900000,purchaseDiscount:29},{name:'Bộ trà Hoàng Cung',price:7900000,purchaseDiscount:0},{name:'Bộ trà Đài Các',price:7900000,costMode:'manual',costPrice:5000000},{name:'Bộ trà Đài Các',price:7900000},{name:'Chưa biết nhóm',price:2000}];
  const original=JSON.stringify(rows),review=purchaseCostReviewRows(rows);
  assert.deepEqual(review.map((r:any)=>[r.mode,r.value,r.suggested]),[['discount',29,27],['discount',0,27],['manual',5000000,27],['discount',27,27],['discount',null,null]]);
  assert.equal(JSON.stringify(rows),original,'mở popup / huỷ không sửa dữ liệu');
});

test('Thông tin SKU mới vẫn giữ CK của dòng cũ; SKU lặp được chỉnh riêng từng dòng',()=>{
  const rows=[{sku:'A',name:'Bộ trà Đài Các',purchaseDiscount:28},{sku:'A',name:'Bộ trà Đài Các',purchaseDiscount:30}];
  const review=purchaseCostReviewRows(rows,[{sku:'A',brand:'MINH LONG',name:'Bộ trà Đài Các'}]);
  assert.deepEqual(review.map((r:any)=>[r.index,r.value,r.suggested]),[[0,28,27],[1,30,27]]);
});

test('approval only requests missing active costs, preserving explicit zero and unused rows',()=>{
 const rows=[{name:'Missing',qty:2},{name:'Zero',qty:1,costPrice:0},{name:'Ready',qty:4,costPrice:150000},{name:'Unused',qty:0},{name:'Negative qty',qty:-1},{qty:1},{name:'Legacy',qty:1,costPrice:1000}];
 assert.deepEqual(rows.map(missingPurchaseCost),[true,false,false,false,false,false,false]);
});
