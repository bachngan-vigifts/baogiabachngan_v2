import {test} from 'node:test';
import assert from 'node:assert/strict';
const h=await import(new URL('../../trial-ui/stocktake-view-data.js',import.meta.url).href);
test('date presets use Vietnam civil dates, month/quarter/year boundaries and lunar new year/month',()=>{
 assert.deepEqual(h.dateRange('Tháng này','2026-11-24'),{from:'2026-11-01',to:'2026-11-30'});
 assert.deepEqual(h.dateRange('Tháng trước','2026-01-05'),{from:'2025-12-01',to:'2025-12-31'});
 assert.deepEqual(h.dateRange('Tuần này','2026-11-24'),{from:'2026-11-23',to:'2026-11-29'});
 assert.deepEqual(h.dateRange('Quý trước','2026-01-05'),{from:'2025-10-01',to:'2025-12-31'});
 assert.deepEqual(h.lunarDate('2026-02-17'),{day:1,month:1,year:2026,leap:false});
 assert.deepEqual(h.dateRange('Năm này (âm lịch)','2026-11-24'),{from:'2026-02-17',to:'2027-02-05'});
 const current=h.dateRange('Tháng này (âm lịch)','2026-11-24'),previous=h.dateRange('Tháng trước (âm lịch)','2026-11-24');
 assert.equal(h.lunarDate(current.from).day,1);assert.equal(Date.parse(current.from)-Date.parse(previous.to),864e5);
});
test('import preserves code strings, zero and uncounted cells, rejects duplicate SKU and money as count',()=>{
 assert.deepEqual(h.parseImport([['Mã hàng','Thực tế','Thành tiền'],['00123',0,50000],['ABC','',90000]]),[{sku:'00123',countedQty:0},{sku:'ABC',countedQty:null}]);
 assert.throws(()=>h.parseImport([['Mã hàng','Thành tiền'],['00123',9000]]),/Thực tế/);
 assert.throws(()=>h.parseImport([['Mã hàng','Thực tế'],['00123',1],['00123',2]]),/trùng/);
 assert.throws(()=>h.parseImport([['Mã hàng','Thực tế'],['00123','33.000 đ']]),/không hợp lệ/);
 assert.deepEqual(h.parseImport([['SKU','Thực tế'],['00123','   ']]),[{sku:'00123',countedQty:null}]);
 assert.throws(()=>h.parseImport([['SKU','Thực tế','Số lượng thực tế'],['00123',1,2]]),/bị lặp/);
});
