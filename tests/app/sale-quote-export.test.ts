import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {runInNewContext} from 'node:vm';
import {after,totals,discounted} from '../../src/modules/quotes/domain/quote-math.ts';
// @ts-ignore browser exports
import {saleExportRows,buildSalePdf,buildSaleWorkbook,SALE_EXPORT_COLUMNS} from '../../trial-ui/sale-quote-export.js';
// @ts-ignore browser module
import {SALE_LAYOUT_COLUMNS,saleDesignProblem} from '../../trial-ui/sale-quote-layout.js';
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const images=Array.from({length:3},()=>({dataUrl:PNG,width:1,height:1}));
const root=new URL('../../trial-ui/',import.meta.url);
const c:any={Uint8Array,ArrayBuffer,TextEncoder,TextDecoder,setTimeout,clearTimeout,Buffer};
for(const file of ['pdf-lib.min.js','fontkit.umd.min.js','exceljs.min.js'])runInNewContext(readFileSync(new URL(file,root),'utf8'),c);
Object.assign(c,{after,discounted,SALE_LAYOUT_COLUMNS,saleDesignProblem});runInNewContext(readFileSync(new URL('sale-quote-export.js',root),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','')+';globalThis.buildPdf=buildSalePdf;globalThis.buildWorkbook=buildSaleWorkbook;',c);
const assets={PDFLib:c.PDFLib,fontkit:c.fontkit,fonts:['TimesNewRoman.ttf','TimesNewRomanBold.ttf'].map(f=>new Uint8Array(readFileSync(new URL('fonts/'+f,root))))};
const rows=[{name:'Bình gốm tiếng Việt',qty:100,price:280556,discount:45,discountType:'percent',printFee:8000,suggestedAverage:150000,image:'https://example.invalid/image.png',sku:'SECRET_SKU',unit:'SECRET_UNIT',costPrice:321,commission:{value:123}},
 {name:'Túi giấy',qty:2.5,price:20000,discount:1000,discountType:'amount',printFee:500,taxRate:10,manualDescription:'SECRET_DESCRIPTION'},
 {name:'=SUM(A1:A9)',qty:1,price:1,discount:0,printFee:0}];
const state=(type='B2B')=>({type,rows,vat:8,customer:'SECRET_CUSTOMER',internalNote:'SECRET_INTERNAL',notes:'SECRET_NOTES',shipping:{rate:999,payer:'sender'}});
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
test('actual Vietnamese PDF paginates long names with embedded designs, without exporting notes or private fields',async()=>{
 const doc=state(),large={...doc,rows:Array.from({length:90},(_,i)=>({...rows[i%3],name:'Bộ quà tặng – thiết kế riêng có tên rất dài '.repeat(i===0?180:2)+i}))};
 const bytes=await c.buildPdf(large,assets,{images:Array.from({length:90},()=>images[0])}),pdf=await c.PDFLib.PDFDocument.load(bytes);assert.ok(pdf.getPageCount()>2);
 const dir=mkdtempSync(join(tmpdir(),'sale-export-'));
 try{const file=join(dir,'sale.pdf');writeFileSync(file,bytes);// Decode the actual saved PDF with Mozilla's independent reader. No system package or renderer-specific parser.
  const loadingTask=getDocument({data:Uint8Array.from(readFileSync(file)),useSystemFonts:false,useWasm:false});
  const decoded=await loadingTask.promise;
  let text='';try{assert.equal(decoded.numPages,pdf.getPageCount());for(let page=1;page<=decoded.numPages;page++){const content=await(await decoded.getPage(page)).getTextContent();text+=content.items.map(item=>'str' in item?item.str+(item.hasEOL?'\n':' '):'').join('')+'\n';}}finally{await loadingTask.destroy();}
  for(const title of ['STT','Hình ảnh','Tên sản phẩm','Giá bán','Phí in','Thành tiền'])assert.ok(text.includes(title),title);assert.ok(text.includes('trung bình'));
  assert.ok(text.includes('Bộ quà tặng'));assert.ok(text.includes('89'));
  assert.doesNotMatch(text,/SECRET_|VAT|Chiết khấu|ĐVT|Mã hàng/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
