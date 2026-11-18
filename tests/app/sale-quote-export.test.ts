import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {runInNewContext} from 'node:vm';
import {after,totals,discounted,manualLineDescription} from '../../src/modules/quotes/domain/quote-math.ts';
// @ts-ignore browser exports
import {saleExportRows,buildSalePdf,buildSaleWorkbook,SALE_EXPORT_COLUMNS} from '../../trial-ui/sale-quote-export.js';
// @ts-ignore browser module
import {SALE_LAYOUT_COLUMNS,saleDesignProblem,saleProductDescription} from '../../trial-ui/sale-quote-layout.js';
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const banner={width:1688,height:212,dataUrl:'data:image/png;base64,'+readFileSync(new URL('../../trial-ui/vigifts-letterhead.png',import.meta.url)).toString('base64')};
const images=Array.from({length:3},()=>({dataUrl:PNG,width:1,height:1}));
const root=new URL('../../trial-ui/',import.meta.url);
const c:any={Uint8Array,ArrayBuffer,TextEncoder,TextDecoder,setTimeout,clearTimeout,Buffer};
for(const file of ['pdf-lib.min.js','fontkit.umd.min.js','exceljs.min.js','hrc-pdf.js','editable-pdf.js'])runInNewContext(readFileSync(new URL(file,root),'utf8'),c);
Object.assign(c,{after,discounted,SALE_LAYOUT_COLUMNS,saleDesignProblem,saleProductDescription,QuoteMath:{after,totals,manualLineDescription}});runInNewContext(readFileSync(new URL('sale-quote-export.js',root),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','')+';globalThis.buildPdf=buildSalePdf;globalThis.buildWorkbook=buildSaleWorkbook;',c);
const assets={PDFLib:c.PDFLib,fontkit:c.fontkit,fonts:['TimesNewRoman.ttf','TimesNewRomanBold.ttf'].map(f=>new Uint8Array(readFileSync(new URL('fonts/'+f,root))))};
const rows=[{name:'Bình gốm tiếng Việt',qty:100,price:280556,discount:45,discountType:'percent',printFee:8000,suggestedAverage:150000,image:'https://example.invalid/image.png',sku:'SECRET_SKU',unit:'SECRET_UNIT',costPrice:321,commission:{value:123}},
 {name:'Túi giấy',qty:2.5,price:20000,discount:1000,discountType:'amount',printFee:500,taxRate:10,manualDescription:'SECRET_DESCRIPTION'},
 {name:'=SUM(A1:A9)',qty:1,price:1,discount:0,printFee:0}];
const state=(type='B2B')=>({type,rows,vat:8,quoteNo:'SALE-BG-TEST',date:'2026-11-12',owner:'Nhân viên thử nghiệm',ownerPhone:'0900000000',contact:'Liên hệ thử nghiệm',customer:'Khách kiểm thử',internalNote:'SECRET_INTERNAL',notes:'Thanh toán theo thỏa thuận thử nghiệm',shipping:{rate:999,payer:'sender'}});
test('eight-column allowlist retains exact quote net amounts for HRC, B2B and VIGIFTS without changing source rows',()=>{
 for(const type of ['HRC','B2B','VIGIFTS']){
  const doc=state(type),before=JSON.stringify(doc),result=saleExportRows(doc);
  assert.deepEqual(Object.keys(result[0]),['index','name','quantity','average','unitPrice','printFee','amount']);
  assert.equal(result[0].unitPrice,discounted(rows[0] as never));assert.equal(result[0].printFee,type==='HRC'?0:8000);assert.equal(result[0].average,150000);assert.equal(result[1].average,null);
  assert.equal(result.reduce((n:number,r:any)=>n+r.amount,0),totals(doc as never).subtotal);
  assert.equal(JSON.stringify(doc),before);assert.doesNotMatch(JSON.stringify(result),/SECRET_/);
 }
 assert.throws(()=>saleExportRows({type:'B2B',rows:[]}),/Chưa có/);
 assert.throws(()=>saleExportRows({type:'B2B',rows:[{name:'a',qty:NaN,price:1}]}),/không hợp lệ/);
});
test('actual XLSX contains one sheet, exactly eight columns with embedded designs, numeric amounts and literal names; no hidden extras',async()=>{
 const book=c.buildWorkbook(state(),c.ExcelJS,{images}),bytes=await book.xlsx.writeBuffer(),loaded=new c.ExcelJS.Workbook();await loaded.xlsx.load(bytes);
 assert.equal(loaded.worksheets.length,1);const sheet=loaded.worksheets[0];assert.equal(sheet.columnCount,8);assert.equal(sheet.rowCount,4);
 assert.deepEqual(Array.from({length:8},(_,i)=>sheet.getRow(1).getCell(i+1).value),SALE_EXPORT_COLUMNS);
 const actual=saleExportRows(state());actual.forEach((r:any,i:number)=>{
  assert.equal(sheet.getRow(i+2).getCell(3).value,r.name);assert.equal(sheet.getRow(i+2).getCell(4).value,r.quantity);
  assert.equal(sheet.getRow(i+2).getCell(6).value,r.unitPrice);assert.equal(sheet.getRow(i+2).getCell(8).value,r.amount);
 });
 const values:any[]=[];sheet.eachRow((r:any)=>{assert.ok(!r.hidden);r.eachCell((cell:any)=>values.push(cell.value));});
 assert.doesNotMatch(JSON.stringify(values),/SECRET_/);assert.ok(sheet.columns.every((col:any)=>!col.hidden));assert.equal(book.model.media.length,3);assert.equal(sheet.getImages().length,3);assert.equal(sheet.getRow(2).getCell(5).value,150000);assert.equal(sheet.getRow(3).getCell(5).value,null);
 assert.throws(()=>c.buildWorkbook({...state(),template:'sale',rows:[{...rows[0],designImage:true}]},c.ExcelJS),/đủ ảnh thiết kế/);
});
test('actual Sale PDF preserves Vigifts frame and notes, paginates long names and excludes private product fields',async()=>{
 const doc=state(),large={...doc,notes:doc.notes+'\nThanh toán: '+('Nội dung điều kiện thanh toán dài để kiểm tra xuống dòng. '.repeat(80)),rows:Array.from({length:90},(_,i)=>({...rows[i%3],name:'Bộ quà tặng – thiết kế riêng có tên rất dài '.repeat(i===0?180:2)+i}))};
 const bytes=await c.buildPdf(large,assets,{images:Array.from({length:90},()=>images[0]),banner}),pdf=await c.PDFLib.PDFDocument.load(bytes);assert.ok(pdf.getPageCount()>2);
 const dir=mkdtempSync(join(tmpdir(),'sale-export-'));
 try{const file=join(dir,'sale.pdf');writeFileSync(file,bytes);// Decode the actual saved PDF with Mozilla's independent reader. No system package or renderer-specific parser.
  const loadingTask=getDocument({data:Uint8Array.from(readFileSync(file)),useSystemFonts:false,useWasm:false});
  const decoded=await loadingTask.promise;
  let text='';try{assert.equal(decoded.numPages,pdf.getPageCount());for(let page=1;page<=decoded.numPages;page++){const content=await(await decoded.getPage(page)).getTextContent();for(const item of content.items)if('str' in item&&item.str.trim()){assert.ok(item.transform[4]>=20&&item.transform[4]+item.width<=575.3,`text stays within horizontal margins: ${item.str}`);assert.ok(item.transform[5]>=20&&item.transform[5]<=822,`text stays on page: ${item.str}`);}text+=content.items.map(item=>'str' in item?item.str+(item.hasEOL?'\n':' '):'').join('')+'\n';}}finally{await loadingTask.destroy();}
  for(const title of ['STT','Hình ảnh','Tên sản phẩm','Giá bán','Phí in','Thành tiền'])assert.ok(text.includes(title),title);assert.ok(text.includes('trung bình'));
  assert.ok(text.includes('Bộ quà tặng'));assert.ok(text.includes('89'));
  assert.doesNotMatch(text,/SECRET_|Chiết khấu|ĐVT|Mã hàng/);
  for(const expected of ['BẢNG CHÀO GIÁ','SALE-BG-TEST','Khách kiểm thử','Nhân viên thử nghiệm','Tổng thành tiền','Tổng thanh toán','Số tiền bằng chữ','Thanh toán theo thỏa thuận thử nghiệm','Phụ trách kinh doanh'])assert.ok(text.includes(expected),expected);
  assert.ok(pdf.getPages().every((p:any)=>Math.abs(p.getWidth()-595.28)<.01&&Math.abs(p.getHeight()-841.89)<.01),'A4 portrait, matching Vigifts');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

async function pdfText(bytes:Uint8Array){
 const task=getDocument({data:Uint8Array.from(bytes),useSystemFonts:false,useWasm:false});
 try{const pdf=await task.promise,items:any[]=[];for(let p=1;p<=pdf.numPages;p++){const content=await(await pdf.getPage(p)).getTextContent();for(const item of content.items)if('str' in item)items.push({...item,page:p});}return items;}finally{await task.destroy();}
}
test('Sale uses the exact Vigifts header geometry and original quote totals for every quote type',async()=>{
 for(const type of ['HRC','B2B','VIGIFTS']){
  const doc=state(type),before=JSON.stringify(doc);
  const sale=await pdfText(await c.buildPdf(doc,assets,{images,banner}));
  const reference=await pdfText(await c.EditableQuotePdf.create({state:{...doc,type:'VIGIFTS'},images,banner,resources:assets}));
  for(const label of ['BẢNG CHÀO GIÁ','Số BG: SALE-BG-TEST','Tên khách hàng: Khách kiểm thử','Phụ trách: Nhân viên thử nghiệm','Kính gửi: Khách kiểm thử;']){
   const actual=sale.find(x=>x.str===label),expected=reference.find(x=>x.str===label);assert.ok(actual,label);assert.ok(expected,label);assert.deepEqual(actual.transform,expected.transform,label);
  }
  const expected=totals(doc as never);for(const amount of [expected.subtotal,expected.tax,expected.total])assert.ok(sale.some(x=>x.str===Math.round(amount).toLocaleString('vi-VN')),`${type}: ${amount}`);
  assert.equal(JSON.stringify(doc),before);assert.ok(sale.some(x=>x.str.includes(doc.notes)));
  const tableTop=sale.find(x=>x.str==='STT')!.transform[5],tableBottom=sale.find(x=>x.str==='Tổng thành tiền')!.transform[5];
  const table=sale.filter(x=>x.page===1&&x.transform[5]<=tableTop&&x.transform[5]>tableBottom).map(x=>x.str).join(' ');
  assert.doesNotMatch(table,/SECRET_|VAT|CK|ĐVT|Mã hàng/);
 }
 await assert.rejects(()=>c.buildPdf(state(),assets,{images}),/tiêu đề Vigifts/);
});

test('ordinary HRC, B2B and Vigifts PDF exports retain their original product columns',async()=>{
 for(const type of ['HRC','B2B','VIGIFTS']){
  const items=await pdfText(await c.EditableQuotePdf.create({state:state(type),images,banner,resources:assets}));
  const text=items.map(x=>x.str).join(' ');
  assert.match(text,/ĐVT/);assert.match(text,/SECRET_SKU/);assert.doesNotMatch(text,/trung bình/);
  assert.ok(text.includes(type==='HRC'?'BẢNG BÁO GIÁ':'BẢNG CHÀO GIÁ'));
 }
});

test('Sale product notes reach PDF and XLSX without adding columns, leaking private fields or changing totals',async()=>{
 const row={...rows[0],designImage:true,sku:'LG-143509',brand:'Thương hiệu gốc',materialDescription:'Thủy tinh',brandDescription:'Lucky Thái Lan',volumeDescription:'255ml',printDescription:'In logo 01 màu 01 vị trí trên sp',packagingDescription:'Hộp carton'};
 const doc={...state(),template:'sale',rows:[row]},before=JSON.stringify(doc),expected=totals(doc as never);
 const exported=saleExportRows(doc);assert.match(exported[0].name,/Chất liệu: Thủy tinh/);assert.match(exported[0].name,/Chế tác:/);assert.doesNotMatch(JSON.stringify(exported),/SECRET_|costPrice/);
 const book=c.buildWorkbook(doc,c.ExcelJS,{images:[images[0]]}),bytes=await book.xlsx.writeBuffer(),loaded=new c.ExcelJS.Workbook();await loaded.xlsx.load(bytes);
 const sheet=loaded.worksheets[0];assert.equal(sheet.columnCount,8);assert.equal(sheet.getCell('C2').value,exported[0].name);assert.equal(sheet.getCell('H2').value,expected.subtotal);assert(sheet.getRow(2).height>=66);
 const items=await pdfText(await c.buildPdf(doc,assets,{images:[images[0]],banner}));const text=items.map(x=>x.str).join(' ');
 for(const value of ['Chất liệu:','Thủy tinh','Thương hiệu:','Lucky Thái Lan','Mã sản phẩm:','LG-143509','Thể tích:','255ml','Chế tác:','In logo 01 màu','Đóng gói:','Hộp carton'])assert(text.includes(value),value);
 assert.doesNotMatch(text,/SECRET_|costPrice/);assert.equal(JSON.stringify(doc),before);
 const details=items.filter(x=>/Chất liệu:|Thương hiệu:|Mã sản phẩm:|Thể tích:|Chế tác:|Đóng gói:/.test(x.str));assert.equal(new Set(details.map(x=>x.transform[5])).size,6,'PDF retains separate description lines');
});
