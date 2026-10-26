import {test} from 'node:test';
import assert from 'node:assert/strict';
import {manualLineDescription,manualLineNote} from '../../src/modules/quotes/domain/quote-math.ts';
import {cleanQuotation} from '../../src/modules/quotes/domain/quotation-schema.ts';
test('manual main and optional secondary text survive sanitization, including explicit clearing',()=>{
 const row={manualLine:true,name:'Túi giấy',manualDescription:'Dán logo hai mặt',qty:2,price:100};
 const cleaned=cleanQuotation({type:'B2B',rows:[row],vat:8,quoteNo:'BG',date:'2026-10-26'});
 assert.equal(cleaned.rows[0].manualDescription,row.manualDescription);
 assert.equal(manualLineDescription(row),'Túi giấy\nDán logo hai mặt');
 assert.equal(manualLineDescription({...row,manualDescription:'  ',bundleContents:'old'}),'Túi giấy');
 assert.equal(manualLineNote({bundleContents:'01 túi',printDescription:'Logo đỏ',packagingDescription:'theo tiêu chuẩn nhà sản xuất'}),'01 túi · Logo đỏ');
 assert.equal(manualLineDescription({sku:'001',name:'Sản phẩm chuẩn'}),null);
 assert.equal(manualLineDescription({...row,sku:'001'}),'Túi giấy\nDán logo hai mặt');
});
