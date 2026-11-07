import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
import {createClient} from '@supabase/supabase-js';

// render.js preloads its static export background, unrelated to thumbnails.
(globalThis as any).Image=class {set src(_value:string) {}};
const {catalogueThumbnailTag,hydrateCatalogueThumbnails,releaseCatalogueThumbnails}=await import(new URL('../../trial-ui/catalogue/product-images.js',import.meta.url).href);
const {imageSource}=await import(new URL('../../trial-ui/catalogue/render.js',import.meta.url).href);
const origin='https://taceqfnsorewelsbdckg.supabase.co';
const source=origin+'/storage/v1/object/public/product-images/folder/test.png';
const esc=(v:string)=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function fixture(source:string,variant='grid') {
 const listeners=new Set<()=>void>(),image:any={dataset:{catalogueImage:source,catalogueVariant:variant},addEventListener:(_t:string,fn:()=>void)=>listeners.add(fn),removeEventListener:(_t:string,fn:()=>void)=>listeners.delete(fn)};
 const root={querySelectorAll:()=>[image]};return {image,root,listeners};
}

test('catalogue markup reserves space, escapes user content and does not start an original-image request',()=>{
 const markup=catalogueThumbnailTag({name:'A " <B>',image:source+'?v=" onerror="bad'},'card-image',esc);
 assert.match(markup,/width="160" height="160"/);assert.match(markup,/loading="lazy" decoding="async"/);
 assert.match(markup,/alt="A &quot; &lt;B&gt;"/);assert.doesNotMatch(markup,/\ssrc=|\sonerror="/);
 assert.match(catalogueThumbnailTag({name:'Mini',image:source},'mini-photo',esc,'list'),/width="64" height="64"/);
});

test('catalogue grid/list use the same transform API as installed Supabase SDK; original export stays unchanged',()=>{
 const sdk=createClient(origin,'test-placeholder',{auth:{persistSession:false,autoRefreshToken:false}});
 for(const [variant,size]of [['grid',320],['list',128]] as const){
  const {image,root}=fixture(source,variant);hydrateCatalogueThumbnails(root);
  const expected=sdk.storage.from('product-images').getPublicUrl('folder/test.png',{transform:{width:size,height:size,resize:'contain',quality:75}}).data.publicUrl;
  assert.equal(image.src,expected);assert.equal(image.decoding,'async');assert.equal(image.loading,'lazy');
 }
 const exportSource=imageSource(source);assert.match(exportSource,/api\/external-image\?url=/);
 assert.equal(new URL(exportSource).searchParams.get('url'),source,'export still requests original full-resolution file');
});

test('catalogue preserves signed/private/external/data source and expiry behavior through existing proxy',()=>{
 for(const value of [origin+'/storage/v1/object/sign/private/a.png?token=test-token&expires=123',origin+'/storage/v1/object/authenticated/private/a.png','https://example.test/a.png','data:image/png;base64,AAAA']){
  const {image,root}=fixture(value);hydrateCatalogueThumbnails(root);assert.equal(image.src,imageSource(value));
  if(value.includes('token='))assert.equal(new URL(image.src).searchParams.get('url'),value);
 }
});

test('catalogue transform failure falls back once and detached grids release lazy observers',()=>{
 const original=(globalThis as any).IntersectionObserver,observed=new Set();let callback:any;
 (globalThis as any).IntersectionObserver=class{constructor(fn:any){callback=fn;}observe(im:any){observed.add(im);}unobserve(im:any){observed.delete(im);}};
 try{
  const {image,root,listeners}=fixture(source.replace('test.png','failure.png'));hydrateCatalogueThumbnails(root);
  assert.equal(image.src,undefined);assert.equal(observed.has(image),true);
  releaseCatalogueThumbnails(root);assert.equal(observed.size,0);hydrateCatalogueThumbnails(root);assert.equal(observed.size,1);
  callback([{target:image,isIntersecting:true}]);assert.match(image.src,/render\/image\/public/);
  for(const fn of [...listeners])fn();assert.equal(image.src,image.dataset.catalogueImage);
  for(const fn of [...listeners])fn();assert.equal(listeners.size,0);
 }finally{if(original)(globalThis as any).IntersectionObserver=original;else delete (globalThis as any).IntersectionObserver;}
});
