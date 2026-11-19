/**
 * Tạo sẵn ảnh nhỏ cho ảnh sản phẩm trong bucket public `product-images`, để giao diện không phải dùng
 * dịch vụ thu nhỏ ảnh của Supabase (gói Pro chỉ cho 100 ảnh/tháng, vượt thì tính phí theo ảnh).
 *
 * - Ảnh gốc `a/b.png` → `thumbs/128/a/b.png.webp` và `thumbs/320/a/b.png.webp` (WebP, giữ tỉ lệ, không phóng to).
 * - Chỉ THÊM/CẬP NHẬT file trong `thumbs/`; không bao giờ sửa hay xoá ảnh gốc.
 * - Chỉ làm ảnh còn thiếu hoặc ảnh gốc đã đổi sau lần tạo trước (so updated_at), nên chạy lại nhiều lần vẫn an toàn.
 * - MODE=dry-run (mặc định) chỉ đếm, không ghi. MODE=apply mới ghi. LIMIT=N chỉ làm N ảnh gốc đầu tiên.
 *
 * Chạy bằng workflow "Tạo ảnh nhỏ sản phẩm" (cần `sharp`, cài tạm trong workflow). Không in khoá ra log.
 */
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export const BUCKET='product-images',SIZES=[128,320],PREFIX='thumbs/';
const SUPPORTED=/\.(png|jpe?g|webp)$/i;
/** Tên file ảnh nhỏ; phải khớp với productThumbnailUrl trong trial-ui/product-images.js. */
export const thumbName=(name,size)=>PREFIX+size+'/'+name+'.webp';
/** Tên ảnh gốc an toàn để xử lý: không nằm trong thumbs/, không có '..' hay ký tự điều khiển. */
export const eligible=name=>typeof name==='string'&&name.length>0&&name.length<=300&&!name.startsWith(PREFIX)&&SUPPORTED.test(name)
 &&!name.split('/').some(part=>part===''||part==='.'||part==='..')&&!/[\u0000-\u001f\u007f]/.test(name);
/**
 * Việc cần làm: mỗi ảnh gốc hợp lệ thiếu ít nhất một cỡ, hoặc có cỡ cũ hơn ảnh gốc.
 * rows: [{name, updated_at}] trong bucket (gồm cả thumbs/).
 */
export function plan(rows){
 const thumbs=new Map(rows.filter(r=>r.name.startsWith(PREFIX)).map(r=>[r.name,Date.parse(r.updated_at)||0]));
 const jobs=[];
 for(const r of rows){
  if(!eligible(r.name))continue;
  const changed=Date.parse(r.updated_at)||0,sizes=SIZES.filter(size=>{const t=thumbs.get(thumbName(r.name,size));return t===undefined||t<changed;});
  if(sizes.length)jobs.push({name:r.name,sizes});
 }
 return jobs;
}
/** Một cỡ ảnh nhỏ: giữ tỉ lệ trong khung size×size, không phóng to, nền trong suốt giữ nguyên. */
export async function render(sharp,bytes,size){
 const meta=await sharp(bytes).metadata();if((meta.pages||1)>1)return null;
 return sharp(bytes).rotate().resize({width:size,height:size,fit:'inside',withoutEnlargement:true}).webp({quality:75,effort:5}).toBuffer();
}

async function main(){
 const ref=process.env.PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN,apply=process.env.MODE==='apply',limit=Number(process.env.LIMIT||0);
 if(!ref||!token)throw new Error('Thiếu PROJECT_REF hoặc SUPABASE_ACCESS_TOKEN.');
 if(!Number.isInteger(limit)||limit<0)throw new Error('LIMIT không hợp lệ.');
 const sharp=createRequire(join(process.cwd(),'package.json'))('sharp');
 const management=async(path,init)=>{const r=await fetch('https://api.supabase.com/v1/projects/'+ref+path,{...init,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});if(!r.ok)throw new Error('Supabase management '+path.split('?')[0]+' lỗi '+r.status);return r.json();};
 // Câu lệnh cố định, không ghép đầu vào.
 const rows=await management('/database/query',{method:'POST',body:JSON.stringify({query:`select name, updated_at from storage.objects where bucket_id='${BUCKET}' order by created_at desc`,read_only:true})});
 let jobs=plan(rows);const pending=jobs.length;if(limit)jobs=jobs.slice(0,limit);
 const total={originals:rows.filter(r=>eligible(r.name)).length,pending,chosen:jobs.length,made:0,bytes:0,skipped:0,failed:0},failures=[];
 if(apply&&jobs.length){
  const keys=await management('/api-keys?reveal=true'),serviceKey=keys.find(k=>k.name==='service_role')?.api_key;
  if(!serviceKey)throw new Error('Không lấy được khoá service_role.');
  if(process.env.GITHUB_ACTIONS)console.log('::add-mask::'+serviceKey);
  const base='https://'+ref+'.supabase.co/storage/v1/object/'+BUCKET+'/',auth={authorization:'Bearer '+serviceKey,apikey:serviceKey};
  const url=name=>base+name.split('/').map(encodeURIComponent).join('/');
  let next=0;
  const one=async job=>{
   const got=await fetch(url(job.name),{headers:auth});if(!got.ok)throw new Error('tải '+got.status);
   const bytes=Buffer.from(await got.arrayBuffer());
   for(const size of job.sizes){
    const out=await render(sharp,bytes,size);if(!out){total.skipped++;continue;}
    const name=thumbName(job.name,size);if(!name.startsWith(PREFIX))throw new Error('tên ảnh nhỏ sai');
    // Giữ 7 ngày: ảnh gốc có thể được nén lại tại chỗ, khi đó ảnh nhỏ được tạo lại cùng tên.
    const put=await fetch(url(name),{method:'POST',headers:{...auth,'content-type':'image/webp','x-upsert':'true','cache-control':'max-age=604800'},body:out});
    if(!put.ok)throw new Error('ghi '+put.status);total.made++;total.bytes+=out.length;
   }
  };
  const worker=async()=>{for(;;){const i=next++;if(i>=jobs.length)return;try{await one(jobs[i]);}catch(e){total.failed++;if(failures.length<30)failures.push(jobs[i].name+': '+(e.message||e));}if((i+1)%250===0)console.log(`Đã xử lý ${i+1}/${jobs.length}…`);}};
  await Promise.all(Array.from({length:6},worker));
 }
 const lines=[`## Tạo ảnh nhỏ sản phẩm (${apply?'ĐÃ GHI':'chạy thử, không ghi'})`,'','| | |','|---|---|',
  `| Ảnh gốc hợp lệ | ${total.originals} |`,`| Ảnh gốc còn thiếu ảnh nhỏ | ${total.pending} |`,`| Ảnh gốc xử lý lượt này | ${total.chosen} |`,
  `| Ảnh nhỏ ${apply?'đã':'sẽ'} tạo | ${apply?total.made:jobs.reduce((n,j)=>n+j.sizes.length,0)} |`,`| Dung lượng ảnh nhỏ đã ghi | ${(total.bytes/1048576).toFixed(1)} MB |`,
  `| Bỏ qua (ảnh động) | ${total.skipped} |`,`| Lỗi | ${total.failed} |`];
 if(failures.length)lines.push('','Lỗi (tối đa 30):',...failures.map(f=>'- '+f));
 console.log(lines.join('\n'));if(process.env.GITHUB_STEP_SUMMARY)await writeFile(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n',{flag:'a'});
 if(total.failed>Math.max(3,total.chosen*0.05))process.exitCode=1;
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href)main().catch(e=>{console.error(e.message||e);process.exit(1);});
