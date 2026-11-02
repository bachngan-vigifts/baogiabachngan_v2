export const assistantTypes=[
 {key:'bo-tra',label:'Bộ trà',terms:['bo tra','bo am chen','am chen'],categoryTerms:['bo tra ca phe'],name:/bo\s+(tra|am|tach)/},
 {key:'bo-ca-phe',label:'Bộ cà phê',terms:['bo ca phe','bo cafe'],categoryTerms:['bo tra ca phe'],name:/bo\s+(ca phe|cafe)/},
 {key:'bo-do-an',label:'Bộ đồ ăn',terms:['bo do an','bo ban an','bo an'],categoryTerms:['bo do an','bo ban an'],name:/bo\s+(do an|ban an|an)/},
 {key:'chen-com',label:'Chén cơm',terms:['chen com','bat com'],categoryTerms:['chen com'],name:/chen com|bat com/},
 {key:'binh-hoa',label:'Bình hoa',terms:['binh hoa','lo hoa'],categoryTerms:['binh hoa'],name:/binh hoa|lo hoa/},
 {key:'binh-giu-nhiet',label:'Bình giữ nhiệt',terms:['binh giu nhiet','ly giu nhiet','coc giu nhiet'],categoryTerms:['binh giu nhiet'],name:/giu nhiet/},
 {key:'binh-nuoc',label:'Bình nước',terms:['binh nuoc'],categoryTerms:['binh nuoc'],name:/binh nuoc/},
 {key:'ly-coc',label:'Ly, cốc',terms:['ly coc','coc su','ly su','ly thuy tinh'],categoryTerms:['ly coc','ly','coc'],name:/\bly\b|\bcoc\b/},
 {key:'may-say-toc',label:'Máy sấy tóc',terms:['may say toc','may tao kieu toc','may duoi toc'],categoryTerms:['may say toc','lam dep'],name:/may say toc|may tao kieu toc|may duoi toc/},
 {key:'ban-ui',label:'Bàn ủi',terms:['ban ui','ban la'],categoryTerms:['ban ui','thiet bi gia dung'],name:/ban ui|ban la/},
 {key:'may-hut-bui',label:'Máy hút bụi',terms:['may hut bui'],categoryTerms:['may hut bui','thiet bi gia dung'],name:/may hut bui/},
 {key:'noi',label:'Nồi',terms:['noi chien','bo noi','noi'],categoryTerms:['noi','noi chien'],name:/\bnoi\b/},
 {key:'chao',label:'Chảo',terms:['chao'],categoryTerms:['chao'],name:/\bchao\b/}
];
export const fold=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase().replace(/[^a-z0-9.,%\s]/g,' ').replace(/\s+/g,' ').trim();
const moneyNumber=s=>Number(String(s).replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.'));
export function parseIntent(prompt){
 const text=fold(prompt),type=assistantTypes.find(t=>t.terms.some(term=>text.includes(term)));
 const expanded=text.replace(/(\d+)\s*tr(\d{1,3})\b/g,(_,a,b)=>String(Number(a)+Number(b)/10**b.length)+' tr');
 const matches=[...expanded.matchAll(/(\d+(?:[.,]\d+)*)\s*(trieu|tr|nghin|ngan|k|dong|d)\b/g)].map(m=>({at:m.index,value:moneyNumber(m[1])*(m[2]==='trieu'||m[2]==='tr'?1e6:['nghin','ngan','k'].includes(m[2])?1000:1)}));
 if(!matches.length){for(const m of expanded.matchAll(/\b\d{1,3}(?:[.,]\d{3})+\b|\b\d{5,10}\b/g))matches.push({at:m.index,value:moneyNumber(m[0])});}
 let min=0,max=null;if(matches.length>=2){min=matches[0].value;max=matches[1].value;}else if(matches.length===1){const before=expanded.slice(Math.max(0,matches[0].at-16),matches[0].at),after=expanded.slice(matches[0].at);if(/tren\s*$|tu\s*$/.test(before)&&/tro len|len tren|toi thieu/.test(after))min=matches[0].value;else max=matches[0].value;}
 const hasLock=/lock\s*n\s*lock|locknlock|\block\b/.test(text),hasMinh=/minh\s*long/.test(text),both=/ca hai|ca 2|hai thuong hieu/.test(text)||hasLock&&hasMinh;
 const porcelain=['bo-tra','bo-ca-phe','bo-do-an','chen-com','binh-hoa'].includes(type?.key);
 const brand=both?'both':hasLock?'LocknLock':hasMinh?'Minh Long':porcelain?'Minh Long':'LocknLock';
 const quantity=text.match(/\b(\d{1,3})\s*(?:mau|san pham|sp)\b/),packSize=/bo\s*10\s*(?:sp|san pham)|don gia\s*x\s*10/.test(text)?10:1;
 return {brand,type:type?.key||'',min,max,limit:quantity?Math.min(200,Math.max(1,Number(quantity[1]))):200,packSize,keywords:[],inStock:true};
}
export function validateCriteria(value){
 if(!value||!['LocknLock','Minh Long','both'].includes(value.brand))throw Error('Vui lòng chọn thương hiệu.');
 const type=assistantTypes.find(t=>t.key===value.type);if(!type)throw Error('Vui lòng chọn danh mục sản phẩm cần tìm.');
 const min=Number(value.min||0),max=value.max===''||value.max==null?null:Number(value.max),limit=Number(value.limit||200),packSize=Number(value.packSize||1);
 if(!Number.isFinite(min)||min<0||min>1e10||max!==null&&(!Number.isFinite(max)||max<=0||max>1e10||max<min))throw Error('Khoảng ngân sách chưa hợp lệ.');
 if(!Number.isInteger(limit)||limit<1||limit>200)throw Error('Mỗi lần tìm từ 1 đến 200 sản phẩm.');
 if(![1,10].includes(packSize))throw Error('Chỉ hỗ trợ đơn giá hoặc bộ 10 SP.');
 const keywords=Array.isArray(value.keywords)?value.keywords.map(v=>String(v).trim().slice(0,50)).filter(Boolean).slice(0,5):[];
 return {brand:value.brand,type:type.key,min,max,limit,packSize,keywords,inStock:true};
}
const assistantReply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const authEndpoint='https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff/me';
const aiRate=new Map();
async function staffForAI(request){
 const authorization=request.headers.get('authorization')||'';if(!/^Bearer [A-Za-z0-9_.~+\/-]{16,3000}={0,2}$/.test(authorization))return null;
 const res=await fetch(authEndpoint,{headers:{Authorization:authorization,Origin:'https://crm.minhlongonline.com'},redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!res.ok)return null;const body=await res.json();const user=body.user||body.data?.user;if(!user?.id)return null;
 const key=String(user.id),now=Date.now(),entry=aiRate.get(key);if(entry&&now-entry.since<60000&&entry.count>=8)throw Error('Anh/chị đã gửi nhiều yêu cầu AI. Vui lòng chờ một phút.');
 aiRate.set(key,!entry||now-entry.since>=60000?{since:now,count:1}:{since:entry.since,count:entry.count+1});if(aiRate.size>1000)for(const [k,v]of aiRate)if(now-v.since>=60000)aiRate.delete(k);
 return user;
}
export async function interpretIntent(prompt,env={},request){
 if(typeof prompt!=='string'||prompt.trim().length<5||prompt.length>1000)throw Error('Nhập yêu cầu từ 5 đến 1.000 ký tự.');
 const baseline=parseIntent(prompt);let engine='criteria',warning='';
 if(env.AI&&request){
  let user;try{user=await staffForAI(request)}catch(e){warning=e.message;}
  if(user){try{
   const schema={type:'object',properties:{brand:{type:'string',enum:['LocknLock','Minh Long','both']},type:{type:'string',enum:assistantTypes.map(t=>t.key)},min:{type:'number'},max:{type:['number','null']},limit:{type:'integer'},packSize:{type:'integer',enum:[1,10]},keywords:{type:'array',items:{type:'string'}}},required:['brand','type','min','max','limit','packSize','keywords']};
   const result=await env.AI.run('@cf/meta/llama-3.1-8b-instruct',{messages:[{role:'system',content:'Bạn trích xuất tiêu chí mua quà từ tiếng Việt, chỉ trả JSON đúng schema. Không bịa sản phẩm hoặc link. brand LocknLock/Minh Long/both. Danh mục: '+assistantTypes.map(t=>t.key+'='+t.label).join('; ')+'. Giá là VND sau chiết khấu và phụ phí. 2tr=2000000, 350k=350000; "từ 2tr trở lại" nghĩa là min=0 max=2000000. Luôn chỉ còn hàng. Không nêu thương hiệu: bộ trà, cà phê, chén, bộ đồ ăn, bình hoa dùng Minh Long; bình giữ nhiệt/gia dụng dùng LocknLock. Mặc định limit=200, packSize=1; bộ trà là 1 sản phẩm, KHÔNG phải bộ 10. Chỉ packSize=10 nếu nói rõ 10 SP.'},{role:'user',content:prompt}],temperature:0,max_tokens:450,response_format:{type:'json_schema',json_schema:schema}});
   const raw=typeof result.response==='string'?JSON.parse(result.response):result.response;const criteria=validateCriteria(raw);return {criteria,engine:'cloudflare_ai',warning:''};
  }catch{warning='AI chưa phản hồi. Đang dùng bộ lọc câu lệnh; vui lòng kiểm tra lại tiêu chí.';}}
  else if(!warning)warning='Đăng nhập CRM để dùng diễn giải bằng AI. Hiện đang dùng bộ lọc câu lệnh.';
 }else warning='Kết nối AI chưa bật ở môi trường này. Bộ lọc câu lệnh vẫn hiểu danh mục và ngân sách thông dụng.';
 return {criteria:baseline,engine,warning};
}
const categoryCache=new Map();
export function matchingProduct(q,criteria,type,brand,pricing){
 if(!q.is_in_stock||!type.name.test(fold(q.name)))return false;
 const regular=Number(q.prices?.regular_price)/10**Number(q.prices?.currency_minor_unit||0);if(q.prices?.currency_code!=='VND'||!Number.isFinite(regular)||regular<=0)return false;
 const discount=brand==='LocknLock'?pricing.lockDiscount:pricing.minhDiscount;const offer=Math.round(regular*(1-discount/100)+pricing.fee)*criteria.packSize;
 return offer>=criteria.min&&(criteria.max===null||offer<=criteria.max)&&criteria.keywords.every(k=>fold(q.name).includes(fold(k)));
}
export async function discoverProducts(criteriaValue,pricingValue,adapter){
 const criteria=validateCriteria(criteriaValue),type=assistantTypes.find(t=>t.key===criteria.type);
 const pricing={lockDiscount:Number(pricingValue?.lockDiscount??40),minhDiscount:Number(pricingValue?.minhDiscount??10),fee:Number(pricingValue?.fee??15000)};
 if(!Number.isFinite(pricing.fee)||pricing.fee<0||pricing.fee>1e8||![pricing.lockDiscount,pricing.minhDiscount].every(n=>Number.isFinite(n)&&n>=0&&n<100))throw Error('Thiết lập chiết khấu hoặc phụ phí chưa hợp lệ.');
 const brands=criteria.brand==='both'?['LocknLock','Minh Long']:[criteria.brand],found=[],errors=[],sources=[];let scanned=0,moreAvailable=false;
 for(const brand of brands){
  const host=brand==='LocknLock'?'locknlockonline.com':'minhlongonline.com';
  try{
   let cats=categoryCache.get(host);if(!cats||Date.now()-cats.at>3600000){const rows=[];for(let page=1;page<=3;page++){const list=await adapter.json(`https://${host}/wp-json/wc/store/v1/products/categories?per_page=100&page=${page}`);if(!Array.isArray(list))throw Error('Website chưa trả danh mục.');rows.push(...list);if(list.length<100)break;}cats={at:Date.now(),rows};categoryCache.set(host,cats);}
   const matched=cats.rows.map(c=>({c,score:Math.max(...type.categoryTerms.map(term=>{const name=fold(c.name);return name===term?100:name.includes(term)?70:fold(c.slug).replaceAll('-',' ').includes(term)?50:0}))})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||Number(b.c.count)-Number(a.c.count));
   if(!matched.length){errors.push(`${brand}: chưa tìm thấy danh mục ${type.label}.`);continue;}
   const best=matched[0].c;sources.push({brand,host,category:String(best.name),categoryId:best.id});
   for(let page=1;page<=10;page++){
    const u=new URL(`https://${host}/wp-json/wc/store/v1/products`);u.searchParams.set('category',String(best.id));u.searchParams.set('stock_status','instock');u.searchParams.set('per_page','100');u.searchParams.set('page',String(page));u.searchParams.set('orderby','price');u.searchParams.set('order','asc');u.searchParams.set('_fields','id,name,sku,slug,permalink,type,prices,is_in_stock,images,categories');
    if(criteria.max!==null){const discount=brand==='LocknLock'?pricing.lockDiscount:pricing.minhDiscount;const ceiling=(criteria.max/criteria.packSize-pricing.fee)/(1-discount/100);if(ceiling<=0)break;u.searchParams.set('max_price',String(Math.ceil(ceiling)));}
    const rows=await adapter.json(u.href);if(!Array.isArray(rows))throw Error('Website chưa trả danh sách sản phẩm.');scanned+=rows.length;
    for(const q of rows){if(!matchingProduct(q,criteria,type,brand,pricing))continue;const canonical=adapter.sourceUrl(q.permalink||`https://${host}/san-pham/${q.slug}/`);if(canonical.hostname!==host)continue;
     const p=adapter.normalize(q,canonical);p.category=type.label;p.discount=brand==='LocknLock'?pricing.lockDiscount:pricing.minhDiscount;p.fee=pricing.fee;p.qty=1;p.override=null;p.inStock=true;
     if(found.some(x=>x.url===p.url))continue;if(found.length>=criteria.limit){moreAvailable=true;break;}found.push(p);
    }
    if(moreAvailable||rows.length<100)break;if(page===10)moreAvailable=true;
   }
  }catch(e){errors.push(`${brand}: ${e.message}`);}
 }
 const offer=p=>Math.round(p.regular*(1-p.discount/100)+p.fee)*criteria.packSize;found.sort((a,b)=>offer(a)-offer(b));
 if(!found.length&&errors.length)throw Error(errors.join(' '));
 return {products:found,criteria,scanned,moreAvailable,errors,sources,checkedAt:new Date().toISOString()};
}
export async function handleAssistant(request,env,adapter){
 if(request.method!=='POST')return assistantReply({error:'Chức năng này dùng POST.'},405);
 try{if(Number(request.headers.get('content-length'))>6000)throw Error('Yêu cầu quá dài.');const text=await request.text();if(text.length>6000)throw Error('Yêu cầu quá dài.');const body=JSON.parse(text);
  if(body.action==='interpret')return assistantReply(await interpretIntent(body.prompt,env,request));
  if(body.action==='search')return assistantReply(await discoverProducts(body.criteria,body.pricing,adapter));
  throw Error('Chức năng trợ lý chưa hợp lệ.');
 }catch(e){return assistantReply({error:e.message||'Chưa xử lý được yêu cầu.'},400)}
}
