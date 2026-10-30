import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {netPrice,customerDiscount,brandDiscountKey} from '../../src/modules/quotes/domain/quote-math.ts';
const {parseSkuQuantities,pasteRows}:any=await import(new URL('../../trial-ui/quote-paste.js',import.meta.url).href);
const source=readFileSync(new URL('../../trial-ui/app.js',import.meta.url),'utf8');
const parseSource=source.slice(source.indexOf('function parseNum('),source.indexOf('const todayIso'));
const rowSource=source.slice(source.indexOf('function rowFromProduct('),source.indexOf('const rowsFromProducts'));
const blankSource=source.slice(source.indexOf('const defaultLineDiscount ='),source.indexOf('function newQuoteData('));
function fixture(){
 let id=0;
 const ctx:any={editor:{defaultDiscount:15,discountMode:'percent',brandDiscounts:null},state:{policies:[{id:'retail',name:'Giá lẻ +VAT'}]},uid:()=>String(++id),PACKAGING_DEFAULT:'Thùng carton',
  currentPolicy:()=> 'retail',priceOf:(p:any,id:string)=>p.prices?.[id]??null,netPrice,customerDiscount,brandDiscountKey,isManager:()=>false,
  defaultCostDiscount:()=>50,purchasePrice:(price:number,d:number)=>price*(1-d/100),savableImage:()=>true,toast:()=>{}};
 runInNewContext(parseSource+blankSource+rowSource+'\nthis.parseNum=parseNum;this.blankRow=blankRow;this.rowFromProduct=rowFromProduct;',ctx);
 const product={sku:'00123',name:'Bộ trà',unit:'Bộ',brand:'MINHLONG',pattern:'Sen',taxable:true,taxOut:8,prices:{retail:108000},imageUrl:'https://example.com/tea.jpg',perCarton:12,cartonWeight:8,cartonLength:40,cartonWidth:30,cartonHeight:20};
 return {ctx,product,parse:(s:string)=>parseSkuQuantities(s,ctx.parseNum),make:(items:any[],products:any[])=>pasteRows(items,products,ctx)};
}
test('two columns preserve leading zeros, skip Excel heading, parse Vietnam quantities and leave blanks editable',()=>{
 const f=fixture(),rows=f.parse('Mã hàng\tSố lượng\r\n00123\t1.000\nLHC3249BEG\t2,5\n\t3\nABC\t\n\n');
 assert.deepEqual(rows,[{sku:'00123',qty:1000},{sku:'LHC3249BEG',qty:2.5},{sku:'',qty:3},{sku:'ABC',qty:''}]);
 assert.throws(()=>f.parse('00123\t-1'),/Dòng 1/);assert.throws(()=>f.parse('00123\tabc'),/số lượng/);assert.throws(()=>f.parse('Tên\t00123\tBộ\t10\t999'),/2 cột/);
});
test('catalog metadata, selected-policy VAT conversion and creation discount are filled without accepting pasted prices',()=>{
 const f=fixture(),r=f.make(f.parse('00123\t10'),[f.product]).rows[0];
 assert.equal(r.price,100000);assert.equal(r.qty,10);assert.equal(r.name,'Bộ trà');assert.equal(r.unit,'Bộ');assert.equal(r.taxRate,8);assert.equal(r.discount,15);assert.equal(r.image,f.product.imageUrl);assert.equal(r.perCarton,12);assert.equal(r.cartonWeight,8);assert.equal(r.cartonHeight,20);assert.equal(r.pricePolicy,'Giá lẻ +VAT');
});
test('customer brand discount overrides the default, including explicitly configured zero',()=>{
 const f=fixture();f.ctx.editor.brandDiscounts={minhLong:0};assert.equal(f.make(f.parse('00123\t1'),[f.product]).rows[0].discount,0);
 f.ctx.editor.brandDiscounts={minhLong:20};assert.equal(f.make(f.parse('00123\t1'),[f.product]).rows[0].discount,20);
 f.ctx.editor.discountMode='amount';f.ctx.editor.defaultDiscount=0;assert.equal(f.make(f.parse('00123\t1'),[f.product]).rows[0].discount,20000);
});
test('missing selected price stays blank; zero price remains zero; other price policies are not substituted',()=>{
 const f=fixture(),p={...f.product,prices:{other:90000}};
 let r=f.make(f.parse('00123\t1'),[p]);assert.equal(r.rows[0].price,'');assert.equal(r.rows[0].name,'Bộ trà');assert.equal(r.warnings.length,1);
 f.ctx.editor.discountMode='amount';f.ctx.editor.defaultDiscount=0;f.ctx.editor.brandDiscounts={minhLong:20};r=f.make(f.parse('00123\t1'),[p]);assert.equal(r.rows[0].discount,'');
 const free={...f.product,prices:{retail:0}};assert.equal(f.make(f.parse('00123\t1'),[free]).rows[0].price,0);
 assert.equal(f.ctx.rowFromProduct(p),null,'normal picker retains its missing-price validation');
});
test('unknown or empty SKU creates editable rows; missing tax does not silently produce a wrong price',()=>{
 const f=fixture(),r=f.make(f.parse('UNKNOWN\t5\n\t2'),[]);assert.equal(r.rows.length,2);assert.equal(r.rows[0].sku,'UNKNOWN');assert.equal(r.rows[0].name,'');assert.equal(r.rows[0].price,'');assert.equal(r.rows[1].sku,'');assert.equal(r.rows[1].qty,2);
 assert.throws(()=>f.make(f.parse('00123\t1'),[{...f.product,taxOut:null}]),/thuế/);
});

test('unfilled manual quantity/price/discount must be entered before saving; explicit numeric zero is accepted',()=>{
 const ctx:any={field:()=>({classList:{toggle(){}}}),$$:()=>[],editor:{rows:[]}};
 const validate=source.slice(source.indexOf('function validateQuote('),source.indexOf('let saving ='));
 runInNewContext(validate+'\nthis.validate=validateQuote;',ctx);
 const base={quoteNo:'BG',customer:'Khách',date:'2026-10-30',vat:8};
 for(const key of ['price','qty','discount'])assert.match(ctx.validate({...base,rows:[{name:'Bộ trà',price:0,qty:1,discount:0,[key]:''}]}),/nhập tay/);
 assert.equal(ctx.validate({...base,rows:[{name:'Bộ trà',price:0,qty:1,discount:0}]}),'');
});
