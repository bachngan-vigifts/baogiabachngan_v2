import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
class Node {children:Node[]=[];text='';tag:string;className:string;href='';target='';rel='';constructor(tag:string,cls='',text=''){this.tag=tag;this.className=cls;this.text=text;}append(...nodes:Node[]){this.children.push(...nodes);}get textContent():string{return this.text+this.children.map(n=>n.textContent).join('');}}
const all=(n:Node):Node[]=>[n,...n.children.flatMap(all)];
function render(extra:Record<string,unknown>={}){
 const source=readFileSync(new URL('../../trial-ui/purchases.js',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('  function receiptCard('),source.indexOf('  /** Ô nhập một dòng ngay trong thẻ'));
 const ctx:any={URL,el:(t:string,c:string,s:string)=>new Node(t,c,s),dmy:(s:string)=>s,num:String,SAPO_LABEL:{done:['Đã nhập Sapo','ok'],pending:['Chờ Sapo','warn']},opts:{canReceive:false}};
 runInNewContext(fn+';globalThis.render=receiptCard;',ctx);
 return ctx.render({id:'r',shipmentId:'o',receiptNo:'PNH',receivedDate:'2026-10-22',sapoStatus:'done',sapoReceiptCode:'PCN10826',sapoPurchaseOrderId:'59291546',sapoReceiptId:'58865407',sapoReceiptUrl:'https://bachngankiengiang.mysapogo.com/admin/purchase_orders/59291546',sapoVerifiedAt:'2026-10-23T00:00:00Z',lines:[],...extra}) as Node;
}
test('Phiếu nhận: chỉ hiện Đã nhập Sapo và link khi có callback đã xác minh; phiếu thủ công cần đối soát',()=>{
 const good=render(),link=all(good).find(n=>n.tag==='a')!;assert.match(good.textContent,/Đã nhập Sapo/);assert.equal(link.href,'https://bachngankiengiang.mysapogo.com/admin/purchase_orders/59291546');assert.equal(link.target,'_blank');assert.match(link.rel,/noopener/);
 const old=render({sapoVerifiedAt:null,sapoReceiptId:'',sapoReceiptUrl:'',sapoReceiptCode:'PNH_20261022_004'});assert.match(old.textContent,/cần đối soát/);assert.doesNotMatch(old.textContent,/Đã nhập Sapo/);assert.equal(all(old).some(n=>n.tag==='a'),false);
 for(const url of ['javascript:alert(1)','https://evil.test/admin/purchase_orders/59291546','https://bachngankiengiang.mysapogo.com/admin/purchase_orders/59291546?token=bad','https://bachngankiengiang.mysapogo.com/admin/purchase_orders/OTHER'])assert.equal(all(render({sapoReceiptUrl:url})).some(n=>n.tag==='a'),false);
 assert.match(render({sapoStatus:'pending',sapoVerifiedAt:null,job:{status:'callback_pending'}}).textContent,/chờ kết quả Sapo/);
});
