import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser module with a DOM-only renderer
import {buildPaymentQrPrint,printPaymentQr} from '../../trial-ui/pos-payment-qr-print.js';
class Node {
 children:Node[]=[];textContent='';className='';src='';alt='';width=0;height=0;removed=false;
 naturalWidth=260;decode=async()=>{};
 constructor(public tag:string){}
 append(...nodes:Node[]){this.children.push(...nodes);}
 querySelector(tag:string):Node|undefined{return this.children.find(n=>n.tag===tag)||this.children.map(n=>n.querySelector(tag)).find(Boolean);}
 remove(){this.removed=true;}
}
const data={url:'https://qr.example.test/payment.png?amount=773280',amount:773280,content:'Thanh toán đơn POS_016_11112026',register:{name:'Quầy thử <script>alert(1)</script>'}};
const doc=()=>({createElement:(t:string)=>new Node(t),head:new Node('head'),body:new Node('body')});
const text=(n:Node):string=>n.textContent+n.children.map(text).join('');
test('QR print preserves exact server QR URL, amount/content and uses text nodes without a paid receipt',()=>{
 const sheet=buildPaymentQrPrint(doc(),data),image=sheet.querySelector('img')!;
 assert.equal(image.src,data.url);assert.equal(image.width,260);assert.equal(image.height,260);
 assert.match(text(sheet),/773\.280 đ/);assert.ok(text(sheet).includes(data.content));assert.ok(text(sheet).includes(data.register.name));assert.equal(sheet.querySelector('script'),undefined);
 assert.match(text(sheet),/chưa xác nhận thu tiền/);assert.doesNotMatch(text(sheet),/ĐÃ THU TIỀN|BILL BÁN HÀNG/);
 for(const value of [{...data,url:'javascript:alert(1)'},{...data,amount:0},{...data,amount:NaN}])assert.throws(()=>buildPaymentQrPrint(doc(),value));
});
test('printing waits for QR decode and cleans its frame; failed or stale QR cannot print',async()=>{
 const prior=globalThis.document;
 try {for(const mode of ['valid','broken','stale','blocked'] as const){
  const d=doc(),frame:any=new Node('iframe');let printed=0,focused=0,afterprint=()=>{},checks=0,release!:()=>void;
  const gate=new Promise<void>(r=>release=r),create=d.createElement;
  d.createElement=(tag:string)=>{const n=create(tag);if(tag==='img')n.decode=async()=>{await gate;if(mode==='broken')throw Error('decode error');};return n;};
  frame.contentDocument=d;frame.contentWindow={addEventListener:(_n:string,fn:()=>void)=>{afterprint=fn;},focus:()=>focused++,print:()=>{printed++;if(mode==='blocked')throw Error('print blocked');afterprint();}};
  Object.assign(globalThis,{document:{createElement:()=>frame,body:new Node('body')}});
  const printing=printPaymentQr(data,()=>mode!=='stale'||++checks===1);
  assert.equal(printed,0,'never print before the image has decoded');release();
  if(mode==='valid'){await printing;assert.equal(printed,1);assert.equal(focused,1);}else{await assert.rejects(printing);assert.equal(printed,mode==='blocked'?1:0);}
  assert.equal(frame.removed,true,'frame always cleaned on completion or error');
 }
 await assert.rejects(printPaymentQr(data,()=>false),/hết hạn/);
 }finally{Object.assign(globalThis,{document:prior});}
});
