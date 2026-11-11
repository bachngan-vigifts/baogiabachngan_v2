// @ts-nocheck
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {previewExternalBrand,discoverExternalProducts} from '../../catalogue-server/external-brand.mjs';
/** Website danh mục HTML thường (kiểu Sunhouse): thẻ sản phẩm trong HTML, "Xem thêm" gọi ajax/product.aspx, không công khai giá. */
const dns=Response.json({Answer:[{type:1,data:'104.21.1.2'}]});
const card=(n:number,extra='')=>`<div class='item'><div class='khungAnh'><a href='https://shop.example.vn/do-bep/binh/binh-${n}.html' title='BÌNH GIỮ NHIỆT ${n}00ML SHOP KS-${n}' class='khungAnhCrop0'><img src="data:image/gif;base64,AAA" data-src="https://shop.example.vn/pic/${n}.png"></a><a href='https://shop.example.vn/do-bep/binh/binh-${n}.html'>Chi tiết</a></div><div class='outer'><a href='https://shop.example.vn/do-bep/binh/binh-${n}.html' class='name'>BÌNH GIỮ NHIỆT ${n}00ML SHOP KS-${n}</a><div class='model'>Mã: KS-${n}</div>${extra}</div></div>`;
function site({total=45,per=20,prices=false}={}){const requests=[];return {requests,fetch:async(raw,opts={})=>{const u=new URL(raw);requests.push((opts.method||'GET')+' '+u.pathname+(opts.body?' '+opts.body:''));
 if(u.hostname==='cloudflare-dns.com')return dns.clone();
 if(u.pathname==='/themes/1000000/ajax/product.aspx'){const b=new URLSearchParams(opts.body),page=Number(b.get('nextPage'));assert.equal(b.get('action'),'GetProduct');assert.equal(b.get('categoryId'),'2429');const from=(page-1)*per,to=Math.min(total,page*per);return Response.json([Array.from({length:to-from},(_,i)=>card(from+i+1)).join(''),String(total-to)]);}
 if(u.pathname==='/do-bep/binh'){const first=Array.from({length:Math.min(per,total)},(_,i)=>card(i+1,prices&&i===0?"<span class='price'>1.250.000đ</span><del>1.500.000 ₫</del>":'')).join('');
  return new Response(`<html><head><meta property="og:site_name" content="https://shop.example.vn/"><title>Bình giữ nhiệt</title></head><body><nav><a href='/do-bep/binh'>Bình giữ nhiệt</a><a href='/do-bep/noi-chao'>Nồi chảo</a><a href='/do-bep/hop'>Hộp</a></nav><h1>Bình giữ nhiệt</h1>
   <div class='cateListProduct type1'><span class='title'>Sản phẩm mới</span><div class='itemProductCT'>${card(1)}${card(2)}</div></div>
   <div class='cateAllProduct'><div class='itemProductCT'>${first}</div>${total>per?`<a class='detail viewMoreProduct' href='#' data-itemperpage='${per}' data-categoryid='2429' data-nextpage='2' data-search-query-string=''>Xem thêm <span>${total-per}</span> sản phẩm khác</a>`:''}</div>
   <script>$.ajax({url: "/themes/1000000/ajax/product.aspx?module=Ajax", type: "POST"}); $this.replaceWith('<a class="detail viewMoreProduct" href="#">Xem thêm <span>' + parseInt(res[1]) + '</span> sản phẩm khác</a>');</script></body></html>`,{headers:{'content-type':'text/html'}});}
 return new Response('not found',{status:404});}};}
const url='https://shop.example.vn/do-bep/binh';

test('nhận diện trang danh mục HTML thường: tên thương hiệu từ tên miền, mẫu sản phẩm, danh mục cùng cấp, cảnh báo không công khai giá',async()=>{
 const p=await previewExternalBrand(url,'',site().fetch);
 assert.equal(p.platform,'listing');assert.equal(p.name,'Shop');assert.equal(p.categoryLabel,'Bình giữ nhiệt');assert.equal(p.currency,'VND');
 assert.equal(p.sampleCount,10);assert.equal(p.unpricedCount,10);assert.match(p.warning,/không công khai giá/);
 assert.deepEqual(p.samples[0],{name:'Bình giữ nhiệt 100ml Shop KS-1',sku:'KS-1',regular:0,priceOnRequest:true});
 assert.deepEqual(p.collections.map(c=>c.name).sort(),['Bình giữ nhiệt','Hộp','Nồi chảo']);
 assert.ok(!p.collections.some(c=>/parseInt|Xem thêm/.test(c.name)),'không lấy chuỗi trong mã JavaScript làm danh mục');
});

test('đọc hết danh mục qua nút "Xem thêm" (ajax GetProduct), không trùng mục "Sản phẩm mới", sản phẩm "Liên hệ" chỉ khi không giới hạn ngân sách',async()=>{
 const s=site(),p=await previewExternalBrand(url,'',s.fetch),provider={...p,currency:'VND',includeContact:true};
 const criteria={provider,brand:p.name,min:0,max:null,limit:200,packSize:1,keywords:[],stockSource:'website'};
 const r=await discoverExternalProducts(criteria,{},s.fetch);
 assert.equal(r.products.length,45);assert.equal(r.moreAvailable,false);assert.deepEqual(r.errors.filter(e=>!/công khai giá/.test(e)),[]);
 assert.equal(new Set(r.products.map(x=>x.url)).size,45);
 assert.deepEqual(s.requests.filter(x=>x.startsWith('POST')).map(x=>new URLSearchParams(x.split(' ')[2]).get('nextPage')),['2','3']);
 const first=r.products[0];assert.equal(first.sku,'KS-1');assert.equal(first.image,'https://shop.example.vn/pic/1.png');assert.equal(first.priceOnRequest,true);assert.equal(first.webAvailable,true);assert.equal(first.category,'Bình giữ nhiệt');
 const budget=await discoverExternalProducts({...criteria,min:100000,max:500000},{},site().fetch);
 assert.equal(budget.products.length,0,'không đưa sản phẩm chưa có giá vào ngân sách bằng 0đ');assert.match(budget.errors.join(' '),/chưa công khai giá/);
});

test('thẻ có giá: lấy giá niêm yết (giá cao hơn khi có giá gạch), lọc theo ngân sách; giới hạn số sản phẩm thì báo còn nữa',async()=>{
 const s=site({total:20,prices:true}),p=await previewExternalBrand(url,'',s.fetch),provider={...p,currency:'VND',includeContact:false};
 const r=await discoverExternalProducts({provider,brand:p.name,min:1000000,max:2000000,limit:200,packSize:1,keywords:[],stockSource:'website'},{},s.fetch);
 assert.deepEqual(r.products.map(x=>[x.sku,x.regular]),[['KS-1',1500000]]);
 const capped=await discoverExternalProducts({provider:{...provider,includeContact:true},brand:p.name,min:0,max:null,limit:5,packSize:1,keywords:[],stockSource:'website'},{},site({total:45}).fetch);
 assert.equal(capped.products.length,5);assert.equal(capped.moreAvailable,true);
});

test('trang một sản phẩm có JSON-LD Product nhưng không có giá / tồn: là "Liên hệ", không bị coi là hết hàng; danh mục lấy từ breadcrumb',async()=>{
 const ld={'@context':'https://schema.org','@graph':[{'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'Trang chủ'},{'@type':'ListItem',position:2,name:'Đồ bếp'},{'@type':'ListItem',position:3,name:'Cốc & Bình giữ nhiệt'},{'@type':'ListItem',position:4,name:'BÌNH KS-1'}]},{'@type':'Product',name:'Bình giữ nhiệt KS-1',image:'https://one.example.vn/pic/1.png',sku:'KS-1'}]};
 const fetch=async(raw:string)=>{const u=new URL(raw);if(u.hostname==='cloudflare-dns.com')return dns.clone();return new Response(`<html><head><meta property="og:title" content="Bình giữ nhiệt KS-1"><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><h1>BÌNH KS-1</h1><p>Sản phẩm khác: hết hàng</p></body></html>`);};
 const p=await previewExternalBrand('https://one.example.vn/do-bep/binh/ks-1.html','',fetch);
 assert.equal(p.platform,'product');assert.equal(p.categoryLabel,'Cốc & Bình giữ nhiệt');
 const r=await discoverExternalProducts({provider:{...p,currency:'VND',includeContact:true},brand:p.name,min:0,max:null,limit:10,packSize:1,keywords:[],stockSource:'website'},{},fetch);
 assert.deepEqual(r.products.map((x:any)=>[x.sku,x.priceOnRequest,x.webAvailable]),[['KS-1',true,true]]);
});
