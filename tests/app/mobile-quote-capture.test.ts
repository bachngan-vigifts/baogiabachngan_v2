import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {totals} from '../../src/modules/quotes/domain/quote-math.ts';
const load=()=>import(pathToFileURL(resolve('trial-ui/mobile-quote-capture.js')).href);
test('ảnh báo giá: tính tiền theo quote-math, không đưa dữ liệu nội bộ vào model',async()=>{
 const {quoteCaptureModel}=await load();
 const doc={type:'B2B' as const,date:'2026-10-23',quoteNo:'BG-1',customer:'Khách A',phone:'0912345678',vat:8,notes:'Báo giá có hiệu lực trong 7 ngày.',internalNote:'SECRET_INTERNAL',rows:[{name:'Ly',sku:'LY',qty:2,price:185000,discountType:'percent' as const,discount:10,printFee:2000,costPrice:50000,printing:{unitPrice:9999,workshop:'SECRET_WORKSHOP'},commission:{value:99},secret:'SECRET_ROW'},{name:'Bộ quà',qty:3,price:95000,discountType:'amount' as const,discount:10000}]};
 const model=quoteCaptureModel(doc),t=totals(doc);assert.equal(model.total,t.total);assert.equal(model.tax,t.tax);assert.equal(model.gross-model.discount,t.subtotal);assert.equal(model.validUntil,'30/10/2026');assert.equal(model.rows[0].amount,337000);assert.equal(model.rows[1].discountLabel,'−30.000 đ');
 const text=JSON.stringify(model);for(const value of ['SECRET','costPrice','commission','printing','internalNote'])assert.equal(text.includes(value),false,value);
 assert.equal(quoteCaptureModel({...doc,type:'HRC'}).rows[0].printFee,0);
});
test('ảnh dài: chia trang không mất sản phẩm, tổng tiền chỉ ở trang cuối, bỏ chiết khấu 0',async()=>{
 const {quoteCaptureModel,quoteCapturePages}=await load();
 const model=quoteCaptureModel({type:'HRC',quoteNo:'LONG',customer:'Khách',vat:0,rows:Array.from({length:80},(_,i)=>({name:'MÃ_HÀNG_'+i,sku:'SKU_'+i,qty:1,price:100000,discount:0}))});
 const pages=quoteCapturePages(model,366,(s:string,size:number)=>s.length*size*.55);assert.ok(pages.length>1);
 const texts=pages.flatMap((p:any)=>p.ops.filter((o:any)=>o.kind==='text').map((o:any)=>o.text));
 for(let i=0;i<80;i++)assert.equal(texts.filter((s:string)=>s==='MÃ_HÀNG_'+i).length,1,'đủ đúng một lần mã '+i);
 assert.equal(texts.filter((s:string)=>s==='Thành tiền').length,1);assert.equal(texts.includes('Chiết khấu'),false);assert.ok(pages.at(-1).ops.some((o:any)=>o.text==='8.000.000 đ'));
 assert.ok(pages.every((p:any)=>p.height>0&&p.height<1700));
});
test('ảnh báo giá: VAT hỗn hợp và HRC/B2B/Vigifts luôn giữ tổng chuẩn, không tự đặt ngày hiệu lực',async()=>{
 const {quoteCaptureModel}=await load();
 for(const type of ['HRC','B2B','VIGIFTS'] as const){const doc={type,vat:8,rows:[{name:'A',qty:7,price:123456.78,discount:7.5,printFee:1500,taxRate:10},{name:'B',qty:3,price:98765.4,discountType:'amount' as const,discount:123.45,taxRate:8}]};assert.equal(quoteCaptureModel(doc).total,totals(doc).total);assert.equal(quoteCaptureModel(doc).validUntil,'');}
 assert.throws(()=>quoteCaptureModel({rows:[]}),/Thêm ít nhất/);
});
