/**
 * Nén lại ảnh sản phẩm trong bucket public `product-images` ngay tại chỗ (giữ nguyên đường dẫn và loại file),
 * để mọi link ảnh đang dùng trong danh mục, báo giá, đơn hàng, PDF vẫn chạy.
 *
 * - JPEG: thu về tối đa 1200 px cạnh dài, chất lượng 80.
 * - PNG: thu về tối đa 1200 px, bảng màu 256 (giữ nền trong suốt).
 * - Chỉ ghi đè khi file mới nhỏ hơn ít nhất 15%; ảnh dưới 30 KB, GIF, WebP và ảnh lỗi được giữ nguyên.
 * - MODE=dry-run (mặc định) chỉ đo, không ghi. MODE=apply mới ghi đè; BACKUP_DIR lưu bản gốc trước khi ghi.
 *
 * Chạy bằng workflow "Nén lại ảnh sản phẩm" (cần `sharp`, cài tạm trong workflow). Không in khoá ra log.
 */
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';

export const MAX_EDGE=1200,MIN_BYTES=30_000,MIN_SAVING=0.15,BUCKET='product-images';
/** Chỉ thay khi tiết kiệm đủ lớn; tránh ghi đè vô ích và tránh nén lặp làm giảm chất lượng. */
export const shouldReplace=(before,after)=>before>=MIN_BYTES&&after>0&&after<=before*(1-MIN_SAVING);
const resize={width:MAX_EDGE,height:MAX_EDGE,fit:'inside',withoutEnlargement:true};
/** Trả về bản nén cùng loại file, hoặc null khi không hỗ trợ / không nên nén. */
export async function compress(sharp,bytes,mime){
 if(bytes.length<MIN_BYTES||!['image/jpeg','image/png'].includes(mime))return null;
 const meta=await sharp(bytes).metadata();if((meta.pages||1)>1)return null;
 if(mime==='image/jpeg'&&meta.format==='jpeg')return sharp(bytes).rotate().resize(resize).jpeg({quality:80,mozjpeg:true}).toBuffer();
  // PNG đã ở dạng bảng màu là ảnh đã nén (hoặc vốn nhỏ): không lượng tử hoá lần nữa để chạy lại không làm xấu ảnh.
 if(mime==='image/png'&&meta.format==='png'&&meta.paletteBitDepth)return null;
 if(mime==='image/png'&&meta.format==='png')return sharp(bytes).resize(resize).png({palette:true,quality:85,effort:8,compressionLevel:9}).toBuffer();
 return null;
}
const mb=n=>(n/1048576).toFixed(1);

async function main(){
 const ref=process.env.PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN,apply=process.env.MODE==='apply',limit=Number(process.env.LIMIT||0),backup=process.env.BACKUP_DIR||'',prefix=process.env.PREFIX||'';
 if(!ref||!token)throw new Error('Thiếu PROJECT_REF hoặc SUPABASE_ACCESS_TOKEN.');
 if(prefix&&!/^[\w./-]{1,200}$/.test(prefix))throw new Error('PREFIX không hợp lệ.');
 const sharp=createRequire(join(process.cwd(),'package.json'))('sharp');
 const management=async(path,init)=>{const r=await fetch('https://api.supabase.com/v1/projects/'+ref+path,{...init,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});if(!r.ok)throw new Error('Supabase management '+path.split('?')[0]+' lỗi '+r.status);return r.json();};
 const keys=await management('/api-keys?reveal=true'),serviceKey=keys.find(k=>k.name==='service_role')?.api_key;
 if(!serviceKey)throw new Error('Không lấy được khoá service_role.');
 if(process.env.GITHUB_ACTIONS)console.log('::add-mask::'+serviceKey);
 // PREFIX chỉ gồm chữ, số, . _ / - (đã kiểm ở trên) nên không cần ghép chuỗi từ đầu vào tự do.
 const rows=await management('/database/query',{method:'POST',body:JSON.stringify({query:`select name,(metadata->>'size')::bigint size,metadata->>'mimetype' mime from storage.objects where bucket_id='${BUCKET}'${prefix?` and name like '${prefix}%'`:''} order by (metadata->>'size')::bigint desc nulls last${limit>0?' limit '+Math.floor(limit):''}`})});
 const base='https://'+ref+'.supabase.co/storage/v1/object/'+BUCKET+'/',auth={authorization:'Bearer '+serviceKey,apikey:serviceKey};
 const url=name=>base+name.split('/').map(encodeURIComponent).join('/');
 const total={files:rows.length,before:0,after:0,replaced:0,skipped:0,failed:0},failures=[];let next=0;
 async function one(row){
  const name=row.name;if(!/^[\w./-]{1,300}$/.test(name)||name.split('/').includes('..')){total.skipped++;return;}
  const got=await fetch(url(name),{headers:auth});if(!got.ok)throw new Error('tải '+got.status);
  const bytes=Buffer.from(await got.arrayBuffer());total.before+=bytes.length;
  const out=await compress(sharp,bytes,row.mime);
  if(!out||!shouldReplace(bytes.length,out.length)){total.after+=bytes.length;total.skipped++;return;}
  if(apply){
   if(backup){const file=join(backup,name);await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes);}
   const put=await fetch(url(name),{method:'POST',headers:{...auth,'content-type':row.mime,'x-upsert':'true','cache-control':'max-age=604800'},body:out});if(!put.ok)throw new Error('ghi '+put.status);
   const check=await fetch(url(name),{headers:auth});const saved=check.ok?Buffer.from(await check.arrayBuffer()):null;
   if(!saved||saved.length!==out.length){ // Ghi chưa chắc chắn: trả lại bản gốc.
    await fetch(url(name),{method:'POST',headers:{...auth,'content-type':row.mime,'x-upsert':'true'},body:bytes});throw new Error('kiểm lại sau khi ghi không khớp, đã trả bản gốc');
   }
  }
  total.after+=out.length;total.replaced++;
 }
 const worker=async()=>{for(;;){const i=next++;if(i>=rows.length)return;try{await one(rows[i]);}catch(e){total.failed++;total.after+=Number(rows[i].size)||0;if(failures.length<30)failures.push(rows[i].name+': '+(e.message||e));}if((i+1)%250===0)console.log(`Đã xử lý ${i+1}/${rows.length}…`);}};
 await Promise.all(Array.from({length:6},worker));
 const lines=[`## Nén lại ảnh sản phẩm (${apply?'ĐÃ GHI ĐÈ':'chạy thử, không ghi'})`,'',`| | |`,`|---|---|`,`| Ảnh đã xét | ${total.files} |`,`| Ảnh ${apply?'đã':'sẽ'} nén lại | ${total.replaced} |`,`| Ảnh giữ nguyên | ${total.skipped} |`,`| Ảnh lỗi (giữ nguyên) | ${total.failed} |`,`| Dung lượng trước | ${mb(total.before)} MB |`,`| Dung lượng sau | ${mb(total.after)} MB |`,`| Tiết kiệm | ${mb(total.before-total.after)} MB (${total.before?Math.round(100-total.after*100/total.before):0}%) |`,...(failures.length?['','Lỗi (tối đa 30 dòng):',...failures.map(f=>'- '+f)]:[])];
 console.log(lines.join('\n'));if(process.env.GITHUB_STEP_SUMMARY)await writeFile(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n',{flag:'a'});
 if(total.failed>total.files*0.05)process.exitCode=1;
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href)main().catch(e=>{console.error(e.message||e);process.exit(1);});
