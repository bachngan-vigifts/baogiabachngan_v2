// @ts-nocheck
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discoverExternalProducts} from '../../catalogue-server/external-brand.mjs';
/** Website thương hiệu ngoài lỗi giữa chừng (trang sau 502, hết lượt gọi): giữ sản phẩm đã đọc, báo dừng ở trang nào. */
const provider={name:'Sunhouse',origin:'https://partial.example.com',collectionUrl:'https://partial.example.com/noi-chao',platform:'sapo',discount:0,fee:15000,currency:'VND',includeContact:true,categoryLabel:'Nồi chảo'};
const criteria={provider,brand:provider.name,min:0,max:null,limit:200,packSize:1,keywords:[],stockSource:'website'};
function site({perPage=6,pages=3,failPage=0,failProduct=''}={}){return async raw=>{const u=new URL(raw);
 if(u.hostname==='cloudflare-dns.com')return Response.json({Answer:[{type:1,data:'104.21.1.2'}]});
 if(u.pathname.startsWith('/products/')){const alias=u.pathname.split('/').at(-1).replace('.js','');if(alias===failProduct)return new Response('<html>Too many subrequests</html>',{status:503});return Response.json({name:alias,alias,url:'/'+alias,variants:[{sku:alias,price:100000,available:true}]});}
 const page=Number(u.searchParams.get('page')||1);if(page===failPage)return new Response('<html>Bad gateway</html>',{status:502});
 const cards=Array.from({length:perPage},(_,i)=>`<div class="product-grid-item"><div data-url="/p${page}-${i}"></div></div>`).join('');
 return new Response(`<script>Bizweb.template='collection';</script>${cards}<ul class="pagination">${page<pages?`<li><a href="/noi-chao?page=${page+1}">Sau</a></li>`:''}</ul>`);};}

test('trang 2 lỗi: giữ sản phẩm trang 1, báo dừng ở trang 2',async()=>{
 const r=await discoverExternalProducts(criteria,{},site({failPage:2}));
 assert.equal(r.products.length,6);assert.equal(r.moreAvailable,true);
 assert.match(r.errors.join(' '),/Dừng ở trang 2: .*Đã giữ 6 sản phẩm/);
});

test('lỗi giữa trang (hết lượt gọi website): giữ các sản phẩm đã đọc trước đó',async()=>{
 const r=await discoverExternalProducts(criteria,{},site({failProduct:'p2-5'}));
 assert.deepEqual(r.products.map(p=>p.sku),['p1-0','p1-1','p1-2','p1-3','p1-4','p1-5','p2-0','p2-1','p2-2','p2-3']);
 assert.match(r.errors.join(' '),/Dừng ở trang 2/);assert.equal(r.moreAvailable,true);
});

test('chưa đọc được sản phẩm nào: vẫn báo lỗi như cũ; không lỗi thì đọc hết các trang',async()=>{
 await assert.rejects(discoverExternalProducts(criteria,{},site({failPage:1})));
 await assert.rejects(discoverExternalProducts(criteria,{},site({failProduct:'p1-0'})));
 const ok=await discoverExternalProducts(criteria,{},site());assert.equal(ok.products.length,18);assert.equal(ok.moreAvailable,false);assert.deepEqual(ok.errors,[]);
});
