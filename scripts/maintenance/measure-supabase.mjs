// Đọc cấu hình máy CSDL (chỉ đọc): cỡ máy, add-on, vài chỉ số CPU/IO. Không in khoá.
const REF='taceqfnsorewelsbdckg',T=process.env.SUPABASE_ACCESS_TOKEN;
const get=async p=>{const r=await fetch('https://api.supabase.com/v1'+p,{headers:{Authorization:'Bearer '+T}});const t=await r.text();try{return {status:r.status,body:JSON.parse(t)}}catch{return {status:r.status,body:t.slice(0,300)}}};
const pick=(o,ks)=>Object.fromEntries(ks.filter(k=>o&&k in o).map(k=>[k,o[k]]));
const p=await get('/projects/'+REF);
console.log('project',JSON.stringify(pick(p.body,['region','status','database','infra_compute_size','instance_size','created_at'])));
const a=await get('/projects/'+REF+'/billing/addons');
console.log('addons',a.status,JSON.stringify(a.body).slice(0,1500));
const q=async sql=>{const r=await fetch('https://api.supabase.com/v1/projects/'+REF+'/database/query',{method:'POST',headers:{Authorization:'Bearer '+T,'Content-Type':'application/json'},body:JSON.stringify({query:sql,read_only:true})});return r.text()};
console.log('settings',await q("select name, setting, unit from pg_settings where name in ('shared_buffers','work_mem','effective_cache_size','max_worker_processes','max_parallel_workers')"));
// Đo CPU thuần: phép tính không đọc bảng, 3 lần
for(let i=0;i<3;i++){const t0=Date.now();const r=await q("explain analyze select sum(g) from generate_series(1,2000000) g");console.log('cpu_probe',Date.now()-t0,'ms', (r.match(/Execution Time: [0-9.]+ ms/)||[''])[0]);}
for(let i=0;i<3;i++){const r=await q("explain analyze select count(*) from products");console.log('products_count', (r.match(/Execution Time: [0-9.]+ ms/)||[''])[0]);}
// File sản xuất đẩy Google Drive: chỉ đếm theo trạng thái/ngày, không in tên file hay khách.
const sec=await get('/projects/'+REF+'/secrets');
console.log('drive_secrets',sec.status,JSON.stringify(Array.isArray(sec.body)?sec.body.map(s=>s.name).filter(n=>/GOOGLE_DRIVE|PRODUCTION_FILES/.test(n)):sec.body));
console.log('drive_files_status',await q("select status, count(*) n, min(created_at) first_at, max(created_at) last_at from sales_production_files group by status"));
console.log('drive_files_by_day',await q("select left(created_at,10) d, status, count(*) n from sales_production_files where created_at >= to_char(now() - interval '14 days','YYYY-MM-DD') group by 1,2 order by 1 desc,2"));
console.log('drive_stuck_uploading',await q("select count(*) n from sales_production_files where status='uploading' and created_at < to_char(now() - interval '15 minutes','YYYY-MM-DD\"T\"HH24:MI:SS')"));
console.log('drive_links',await q("select count(*) links, count(distinct order_id) orders from sales_production_file_links"));
// Mức dùng + Advisors + truy vấn nặng (chỉ đọc, chỉ in số liệu/tên bảng, không in dữ liệu khách).
for(const p of ['/usage','/analytics/endpoints/usage.api-counts?interval=7day','/analytics/endpoints/usage.api-requests-count']){const r=await get('/projects/'+REF+p);console.log('usage',p,r.status,JSON.stringify(r.body).slice(0,1500));}
for(const k of ['performance','security']){const r=await get('/projects/'+REF+'/advisors/'+k);const l=r.body?.lints||[];console.log('advisor',k,r.status,l.length,JSON.stringify(l.map(x=>({n:x.name,lv:x.level,d:(x.detail||'').slice(0,160)})).slice(0,40)));}
console.log('db_size',await q("select pg_size_pretty(pg_database_size(current_database())) db, (select pg_size_pretty(coalesce(sum(size),0)) from (select (metadata->>'size')::bigint size from storage.objects) s) storage, (select count(*) from storage.objects) objects"));
console.log('cache_hit',await q("select round(100*sum(heap_blks_hit)/nullif(sum(heap_blks_hit+heap_blks_read),0),2) table_hit, round(100*(select sum(idx_blks_hit)/nullif(sum(idx_blks_hit+idx_blks_read),0) from pg_statio_user_indexes),2) idx_hit from pg_statio_user_tables"));
console.log('top_queries',await q("select calls, round(total_exec_time) total_ms, round(mean_exec_time::numeric,1) mean_ms, rows, left(regexp_replace(query,'\\s+',' ','g'),150) q from extensions.pg_stat_statements where query not ilike '%pg_stat%' order by total_exec_time desc limit 15"));
console.log('seq_scans',await q("select relname, seq_scan, seq_tup_read, idx_scan, n_live_tup from pg_stat_user_tables where seq_scan>50 and n_live_tup>500 order by seq_tup_read desc limit 15"));
console.log('stats_reset',await q("select stats_reset from pg_stat_database where datname=current_database()"));
console.log('thumb_samples',await q("select o.name orig, (o.metadata->>'size')::bigint orig_bytes, t.name thumb, (t.metadata->>'size')::bigint thumb_bytes, t.metadata->>'cacheControl' cache from storage.objects t join storage.objects o on o.bucket_id=t.bucket_id and t.name in ('thumbs/128/'||o.name||'.webp','thumbs/320/'||o.name||'.webp') where t.bucket_id='product-images' order by t.name limit 40"));
