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
