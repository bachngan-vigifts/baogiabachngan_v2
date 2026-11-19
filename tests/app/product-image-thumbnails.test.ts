import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
const {productThumbnailUrl,setProductThumbnail,suspendProductThumbnail,noteThumbnailFailure}=await import(new URL('../../trial-ui/product-images.js',import.meta.url).href);
const {thumbName}=await import(new URL('../../scripts/maintenance/product-thumbnails.mjs',import.meta.url).href);
const origin='https://taceqfnsorewelsbdckg.supabase.co';
const source=origin+'/storage/v1/object/public/product-images/folder/m%C3%A0u%20xanh.png?v=2';

test('thumbnail giữ nguyên origin/bucket/path và version, chỉ dùng hai biến thể ổn định',()=>{
 for(const [variant,size] of [['list',128],['grid',320]]){
  const result=productThumbnailUrl(source,variant),u=new URL(result);
  assert.equal(u.origin,origin);assert.equal(u.pathname,`/storage/v1/object/public/product-images/thumbs/${size}/folder/m%C3%A0u%20xanh.png.webp`,'ảnh nhỏ làm sẵn, không gọi dịch vụ thu nhỏ tính phí');
  assert.equal(u.searchParams.get('v'),'2');assert.equal(u.search,'?v=2');
  // Khớp tên file script tạo ảnh nhỏ ghi vào bucket.
  assert.equal(decodeURIComponent(u.pathname.slice('/storage/v1/object/public/product-images/'.length)),thumbName('folder/màu xanh.png',size));
  assert.equal(productThumbnailUrl(source,variant),result);assert.equal(productThumbnailUrl(result,variant),result,'không lồng transform / tạo URL mới');
 }
 assert.equal(productThumbnailUrl(source,'unknown'),source);
});

test('không đổi signed/private/token/download URL, host ngoài hoặc ảnh không hỗ trợ',()=>{
 const values=[origin+'/storage/v1/object/sign/product-images/a.png?token=secret%2Btoken',
  origin+'/storage/v1/render/image/sign/product-images/a.png?token=token',
  origin+'/storage/v1/object/public/product-images/thumbs/128/a.png.webp',
  origin+'/storage/v1/object/authenticated/product-images/a.png',source+'&token=token',source+'&download=1',
  'https://example.test/storage/v1/object/public/product-images/a.png',origin+'/storage/v1/object/public/private-files/a.png',
  origin+'/storage/v1/object/public/product-images/a.gif',origin+'/storage/v1/object/public/product-images/a.svg',
  'https://sapo.dktcdn.net/a.png','data:image/png;base64,AAAA','not a url',''];
 for(const value of values)assert.equal(productThumbnailUrl(value),value);
});

test('ảnh lazy/async có tỉ lệ cố định; transform lỗi chỉ thử ảnh gốc một lần, không lặp',()=>{
 const listeners=new Set<()=>void>(),image:any={dataset:{},addEventListener:(_type:string,fn:()=>void)=>listeners.add(fn),removeEventListener:(_type:string,fn:()=>void)=>listeners.delete(fn)};
 let failed=0;setProductThumbnail(image,source,'grid',()=>failed++);
 assert.equal(image.src,productThumbnailUrl(source,'grid'));assert.equal(image.loading,'lazy');assert.equal(image.decoding,'async');assert.deepEqual([image.width,image.height],[160,160]);
 assert.equal(image.dataset.productImageSource,source);
 for(const fn of [...listeners])fn();assert.equal(image.src,source);assert.equal(failed,0);
 for(const fn of [...listeners])fn();assert.equal(failed,1);assert.equal(listeners.size,0);
});

test('ảnh grid chỉ bắt đầu tải gần viewport; giữ ảnh khi dựng lại, bỏ quan sát tile bị thay',()=>{
 const source=origin+'/storage/v1/object/public/product-images/grid.png';
 const prior=(globalThis as any).IntersectionObserver,observed=new Set(),listeners=new Set();let callback:any;
 (globalThis as any).IntersectionObserver=class {constructor(fn:any,options:any){callback=fn;assert.equal(options.rootMargin,'200px');}observe(image:any){observed.add(image);}unobserve(image:any){observed.delete(image);}};
 try{
  const image:any={dataset:{},addEventListener:(_t:any,fn:any)=>listeners.add(fn),removeEventListener:(_t:any,fn:any)=>listeners.delete(fn)};
  setProductThumbnail(image,source,'grid');assert.equal(image.src,undefined);assert.equal(observed.has(image),true);
  callback([{target:image,isIntersecting:false}]);assert.equal(image.src,undefined);
  suspendProductThumbnail(image);assert.equal(observed.has(image),false);
  assert.equal(setProductThumbnail(image,source,'grid'),image);assert.equal(observed.has(image),true);assert.equal(listeners.size,1);
  image.isConnected=false;callback([{target:image,isIntersecting:true}]);assert.equal(image.src,undefined,'queued callback must not load a removed tile');image.isConnected=true;
  callback([{target:image,isIntersecting:true}]);assert.equal(image.src,productThumbnailUrl(source,'grid'));assert.equal(observed.size,0);
  const loaded=image.src;setProductThumbnail(image,source,'grid');assert.equal(image.src,loaded);assert.equal(listeners.size,1);
  setProductThumbnail(image,source,'list');assert.equal(image.src,productThumbnailUrl(source));assert.equal(listeners.size,1);
 }finally{if(prior)(globalThis as any).IntersectionObserver=prior;else delete (globalThis as any).IntersectionObserver;}
});


test('thumbnail lỗi không bị tải lại mỗi lần redraw; hết khoảng chờ cho phép thử lại, không ghi nhớ signed URL',()=>{
 const source=origin+'/storage/v1/object/public/product-images/cooldown.png',thumbnail=productThumbnailUrl(source),now=Date.now;
 try{let time=100000;Date.now=()=>time;noteThumbnailFailure(thumbnail);assert.equal(productThumbnailUrl(source),source);time+=600001;assert.equal(productThumbnailUrl(source),thumbnail);
 const signed=origin+'/storage/v1/object/sign/product-images/cooldown.png?token=a%2Bb';noteThumbnailFailure(signed);assert.equal(productThumbnailUrl(signed),signed);
 }finally{Date.now=now;}
});

test('script ảnh nhỏ: chỉ ảnh gốc hợp lệ còn thiếu hoặc đã đổi; không đụng thư mục thumbs',async()=>{
 const {plan,eligible}=await import(new URL('../../scripts/maintenance/product-thumbnails.mjs',import.meta.url).href);
 const rows=[{name:'uploads/a.png',updated_at:'2026-11-01T00:00:00Z'},{name:'thumbs/128/uploads/a.png.webp',updated_at:'2026-11-02T00:00:00Z'},{name:'thumbs/320/uploads/a.png.webp',updated_at:'2026-11-02T00:00:00Z'},
  {name:'uploads/b.jpg',updated_at:'2026-11-05T00:00:00Z'},{name:'thumbs/128/uploads/b.jpg.webp',updated_at:'2026-11-02T00:00:00Z'},
  {name:'uploads/c.webp',updated_at:'2026-11-01T00:00:00Z'},{name:'uploads/d.gif',updated_at:'2026-11-01T00:00:00Z'},{name:'thumbs/128/x.png',updated_at:'2026-11-01T00:00:00Z'}];
 assert.deepEqual(plan(rows),[{name:'uploads/b.jpg',sizes:[128,320]},{name:'uploads/c.webp',sizes:[128,320]}]);
 for(const bad of ['thumbs/128/a.png','../a.png','a//b.png','a/./b.png','a.svg','a\u0000.png',''])assert.equal(eligible(bad),false,bad);
});
