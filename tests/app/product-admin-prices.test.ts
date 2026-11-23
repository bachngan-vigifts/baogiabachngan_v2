import {test} from 'node:test';
import assert from 'node:assert/strict';
const admin=await import(process.env.PRODUCT_ADMIN_SOURCE||new URL('../../trial-ui/product-admin.js',import.meta.url).href);

test('integer VND and properly grouped thousands preserve the exact value',()=>{
 for(const [input,expected] of [['450000',450000],['450.000',450000],['450,000',450000],['1.234.567',1234567],['1,234,567',1234567],['450 000',450000],['450\u00a0000',450000],['450\u202f000',450000],[' 450.000 ',450000],['000450',450],['0',0],['1000000000000',1e12],['1.000.000.000.000',1e12]] as const)assert.equal(admin.parseProductPrice(input),expected,input);
 assert.equal(admin.parseProductPrice(450000),450000);
 for(const input of ['', '  ',null,undefined])assert.equal(admin.parseProductPrice(input),null);
});
test('fractional prices are rejected without stripping their separators or rounding',()=>{
 for(const input of ['123456.5','123456,5','123.456,5','123,456.5','123456.0','0.500','1.234.567,00',123456.5,123.456])assert.throws(()=>admin.parseProductPrice(input),/nguyên VNĐ/,String(input));
});
test('malformed groups, signs, exponents, currency text and out-of-range values are rejected',()=>{
 for(const input of ['12.34','1,23,456','1.234,567','1 2 3','1.234.','-1','+1','1e3','450.000đ','Infinity','NaN','1000000000001','9007199254740992'])assert.throws(()=>admin.parseProductPrice(input),/nguyên VNĐ/,input);
});
