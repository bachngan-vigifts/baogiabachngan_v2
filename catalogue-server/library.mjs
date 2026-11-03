const base='https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff';
/** Fixed upstream and bounded payload; credentials are forwarded only to CRM, never providers. */
export async function libraryProxy(request,fetcher=fetch){
 const auth=request.headers.get('authorization')||'';
 if(!/^Bearer [A-Za-z0-9_.~+\/-]{16,3000}={0,2}$/.test(auth))return Response.json({error:'Đăng nhập CRM để sử dụng thư viện chung.'},{status:401});
 const incoming=new URL(request.url),id=incoming.searchParams.get('id')||'',stock=incoming.pathname.endsWith('/library-stock'),image=incoming.pathname.endsWith('/library-image'),quotes=incoming.pathname.endsWith('/quotes'),archive=incoming.pathname.endsWith('/quote-archive');
 if(id&&!(quotes||archive?/^[A-Za-z0-9_-]{8,80}$/:/^[a-f0-9]{64}$/).test(id))return Response.json({error:'Mã sản phẩm chung chưa hợp lệ.'},{status:400});
 if(!['GET','POST','PUT'].includes(request.method)||request.method==='PUT'&&!id||stock&&request.method!=='GET'||image&&request.method!=='POST'||archive&&(!id||request.method!=='POST'))return Response.json({error:'Thao tác chưa hỗ trợ.'},{status:405});
 const path=archive?'/catalogue-quotes/'+id+'/archive':quotes?'/catalogue-quotes'+(id?'/'+id:''):image?'/product-images':stock?'/catalogue-library/stock':id?'/catalogue-library/'+id:'/catalogue-library',url=new URL(base+path);
 for(const key of ['q','brand','category','collection','pattern','color','offset','limit','skus'])if(incoming.searchParams.has(key))url.searchParams.set(key,incoming.searchParams.get(key));
 const body=request.method==='GET'?undefined:await request.text();if(body&&body.length>(quotes?2000000:image?350000:250000))return Response.json({error:'Lô dữ liệu quá lớn.'},{status:413});
 try{const r=await fetcher(url.href,{method:request.method,headers:{Authorization:auth,Origin:'https://crm.minhlongonline.com','Content-Type':'application/json'},body,redirect:'manual',signal:AbortSignal.timeout(45000)});if(r.status>=300&&r.status<400)throw Error('upstream redirect');return new Response(r.body,{status:r.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}catch{return Response.json({error:'Chưa rõ kết quả kết nối CRM. Thử lại cùng sản phẩm; hệ thống không tạo trùng.'},{status:503});}
}
