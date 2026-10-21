import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webOrderFinancials,webFinancialDescription,readWebOrderFinancials} from '../../src/modules/sales/domain/web-order-financials.ts';
const sample={total:'38390020',discount_total:'150000',discount_tax:'0',shipping_total:'0',shipping_tax:'0',total_tax:'0',line_items:[{subtotal:'38545020',subtotal_tax:'0',total:'38395020',total_tax:'0'}],coupon_lines:[{code:'lnl150k',discount:'150000',discount_tax:'0'}],fee_lines:[{name:'Đổi điểm',total:'-5000',total_tax:'0'}],shipping_lines:[{method_title:'Miễn phí vận chuyển',method_id:'free_shipping',total:'0',total_tax:'0'}]};
test('Giữ coupon, phí âm đổi điểm, miễn ship và tổng nguồn; không trừ đổi điểm thêm lần nữa',()=>{
 const d=webOrderFinancials(sample)!;assert.equal(d.total,38390020);assert.equal(d.itemsSubtotal,38545020);assert.equal(d.fees[0]!.total,-5000);assert.equal(d.fees[0]!.points,true);assert.equal(d.shippingTotal,0);
 assert.equal(d.itemsSubtotal!-d.discountTotal!+d.fees[0]!.total!+d.shippingTotal!,d.total);
 assert.match(webFinancialDescription(d),/lnl150k/);assert.match(webFinancialDescription(d),/-5\.000/);assert.match(webFinancialDescription(d),/Miễn phí vận chuyển/);
 assert.deepEqual(readWebOrderFinancials(JSON.stringify(d)),d);
});
test('Phân biệt dữ liệu chưa gửi với 0; cập nhật chỉ trạng thái không tạo snapshot giả',()=>{
 assert.equal(webOrderFinancials({status:'completed',total:'1000',line_items:[]}),null);
 const d=webOrderFinancials({total:'1000',coupon_lines:[],fee_lines:[],shipping_total:'0'})!;assert.equal(d.discountTotal,null);assert.equal(d.shippingTotal,0);assert.equal(d.itemsSubtotal,null);
 assert.equal(readWebOrderFinancials('{}'),null);assert.equal(readWebOrderFinancials('bad'),null);
});
test('Thuế, ship có phí và điểm qua coupon giữ riêng; metadata điểm chỉ tham chiếu',()=>{
 const d=webOrderFinancials({...sample,total:'120000',coupon_lines:[{code:'points-redemption',discount:'10000',discount_tax:'800'}],fee_lines:[],shipping_total:'30000',shipping_tax:'2400',points_redemption:{points:5000,amount:'10800'}})!;
 assert.equal(d.coupons[0]!.points,true);assert.equal(d.shippingTotal,30000);assert.equal(d.shippingTax,2400);assert.equal(d.points!.redeemed,5000);assert.equal(d.total,120000);
 assert.match(webFinancialDescription(d),/32\.400/);assert.match(webFinancialDescription(d),/không trừ thêm/);
});
test('Từ chối số tiền hỏng và điểm thập phân, không ép dữ liệu lỗi thành 0',()=>{
 for(const total of ['NaN',{},'1,000',Infinity,-1])assert.throws(()=>webOrderFinancials({...sample,total}));
 assert.throws(()=>webOrderFinancials({...sample,points_redemption:{points:1.5}}));
});
