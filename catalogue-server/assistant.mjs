export const assistantTypes=[
 {key:'bo-tra',label:'Bộ trà',terms:['bo tra','bo am chen','am chen'],categoryTerms:['bo tra ca phe'],name:/bo\s+(tra|am|tach)/},
 {key:'bo-ca-phe',label:'Bộ cà phê',terms:['bo ca phe','bo cafe'],categoryTerms:['bo tra ca phe'],name:/bo\s+(ca phe|cafe)/},
 {key:'bo-do-an',label:'Bộ đồ ăn',terms:['bo do an','bo ban an','bo an'],categoryTerms:['bo do an','bo ban an'],name:/bo\s+(do an|ban an|an)/},
 {key:'chen-com',label:'Chén cơm',terms:['chen com','bat com'],categoryTerms:['chen com'],name:/chen com|bat com/},
 {key:'binh-hoa',label:'Bình hoa',terms:['binh hoa','lo hoa'],categoryTerms:['binh hoa'],name:/binh hoa|lo hoa/},
 {key:'binh-giu-nhiet',label:'Bình giữ nhiệt',terms:['binh giu nhiet','ly giu nhiet','coc giu nhiet'],categoryTerms:['binh giu nhiet'],name:/giu nhiet/},
 {key:'binh-nuoc',label:'Bình nước',terms:['binh nuoc'],categoryTerms:['binh nuoc'],name:/binh nuoc/},
 {key:'ly-duong-sinh',label:'Ly dưỡng sinh',terms:['ly duong sinh','ly su duong sinh','coc duong sinh'],categoryTerms:['ly su duong sinh'],name:/ly.*duong sinh|duong sinh.*ly/},
 {key:'ly-su',label:'Ly sứ',terms:['ly su','coc su'],categoryTerms:['ly su duong sinh','tach ly coc'],name:/\bly\b|\bcoc\b|\bca\b/,exclude:/duong sinh/},
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
 const expanded=text.replace(/(\d+(?:[.,]\d+)?)\s+(?:den\s+|toi\s+)?(\d+(?:[.,]\d+)?)\s*(k|trieu|tr|nghin|ngan)\b/g,'$1 $3 den $2 $3').replace(/(\d+)\s*tr(\d{1,3})\b/g,(_,a,b)=>String(Number(a)+Number(b)/10**b.length)+' tr');
 const matches=[...expanded.matchAll(/(\d+(?:[.,]\d+)*)\s*(trieu|tr|nghin|ngan|k|dong|d)\b/g)].map(m=>({at:m.index,value:moneyNumber(m[1])*(m[2]==='trieu'||m[2]==='tr'?1e6:['nghin','ngan','k'].includes(m[2])?1000:1)}));
 if(!matches.length){for(const m of expanded.matchAll(/\b\d{1,3}(?:[.,]\d{3})+\b|\b\d{5,10}\b/g))matches.push({at:m.index,value:moneyNumber(m[0])});}
 let min=0,max=null;if(matches.length>=2){min=matches[0].value;max=matches[1].value;}else if(matches.length===1){const before=expanded.slice(Math.max(0,matches[0].at-16),matches[0].at),after=expanded.slice(matches[0].at);if(/tren\s*$|tu\s*$/.test(before)&&/tro len|len tren|toi thieu/.test(after))min=matches[0].value;else max=matches[0].value;}
 const hasLock=/lock\s*n\s*lock|locknlock|\block\b/.test(text),hasMinh=/minh\s*long/.test(text),both=/ca hai|ca 2|hai thuong hieu/.test(text)||hasLock&&hasMinh;
 const porcelain=['bo-tra','bo-ca-phe','bo-do-an','chen-com','binh-hoa','ly-su','ly-duong-sinh'].includes(type?.key);
 const brand=both?'both':hasLock?'LocknLock':hasMinh?'Minh Long':porcelain?'Minh Long':'LocknLock';
 const quantity=text.match(/\b(\d{1,3})\s*(?:mau|san pham|sp)\b/),packSize=/bo\s*10\s*(?:sp|san pham)|don gia\s*x\s*10/.test(text)?10:1;
 return {brand,type:type?.key||'',min,max,limit:quantity?Math.min(200,Math.max(1,Number(quantity[1]))):200,packSize,keywords:[],stockSource:/\bcrm\b/.test(text)?'crm':'website',inStock:true};
}
export function validateCriteria(value){
 if(!value||(!value.provider&&!['LocknLock','Minh Long','both'].includes(value.brand)))throw Error('Vui lòng chọn thương hiệu.');
 const categoryId=Number(value.categoryId||0);if(!Number.isInteger(categoryId)||categoryId<0||categoryId>1e9)throw Error('Danh mục website chưa hợp lệ.');if(categoryId&&value.brand==='both')throw Error('Danh mục website cần chọn đúng một thương hiệu.');const type=assistantTypes.find(t=>t.key===value.type)||(categoryId||value.provider?{key:'website'}:null);if(!type)throw Error('Vui lòng chọn danh mục sản phẩm cần tìm.');
 const min=Number(value.min||0),max=value.max===''||value.max==null?null:Number(value.max),limit=Number(value.limit||200),packSize=Number(value.packSize||1);
 if(!Number.isFinite(min)||min<0||min>1e10||max!==null&&(!Number.isFinite(max)||max<=0||max>1e10||max<min))throw Error('Khoảng ngân sách chưa hợp lệ.');
 if(!Number.isInteger(limit)||limit<1||limit>200)throw Error('Mỗi lần tìm từ 1 đến 200 sản phẩm.');
 if(![1,10].includes(packSize))throw Error('Chỉ hỗ trợ đơn giá hoặc bộ 10 SP.');
 const stockSource=value.stockSource||'website';if(!['website','crm'].includes(stockSource))throw Error('Nguồn tồn kho chưa hợp lệ.');
 const keywords=Array.isArray(value.keywords)?value.keywords.map(v=>String(v).trim().slice(0,50)).filter(Boolean).slice(0,5):[];
 return {provider:value.provider||null,brand:String(value.brand).slice(0,50),type:type.key,categoryId,categoryLabel:String(value.categoryLabel||'').slice(0,100),min,max,limit,packSize,keywords,stockSource,inStock:true};
}
const assistantReply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const authEndpoint='https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff/me';
const aiRate=new Map();
async function staffForAI(request){
 const authorization=request.headers.get('authorization')||'';if(!/^Bearer [A-Za-z0-9_.~+\/-]{16,3000}={0,2}$/.test(authorization))return null;
 const res=await fetch(authEndpoint,{headers:{Authorization:authorization,Origin:'https://crm.minhlongonline.com'},redirect:'manual',signal:AbortSignal.timeout(8000)});
 if(!res.ok)return null;const body=await res.json();const user=body.user||body.data?.user;if(!user?.id)return null;
 const key=String(user.id),now=Date.now(),entry=aiRate.get(key);if(entry&&now-entry.since<60000&&entry.count>=8)throw Error('Anh/chị đã gửi nhiều yêu cầu AI. Vui lòng chờ một phút.');
 aiRate.set(key,!entry||now-entry.since>=60000?{since:now,count:1}:{since:entry.since,count:entry.count+1});if(aiRate.size>1000)for(const [k,v]of aiRate)if(now-v.since>=60000)aiRate.delete(k);
 return user;
}
export function parsePlan(prompt,catalog=[]){
 const raw=String(prompt).split(/\s*(?:\+|;|\n)\s*|\s+và\s+|,\s*(?=[a-zà-ỹđ])/iu).filter(Boolean),clauses=[];
 for(const part of raw){const intent=parseIntent(part);const web=catalog.find(c=>fold(part).includes(fold(c.label)));if(!intent.type&&!web&&clauses.length)clauses[clauses.length-1]+=' '+part;else clauses.push(part)}
 const groups=clauses.slice(0,12).map(part=>{const c=parseIntent(part);if(!c.type){const web=catalog.filter(x=>fold(part).includes(fold(x.label))).sort((a,b)=>b.label.length-a.label.length)[0];if(web)Object.assign(c,{brand:web.brand,type:'website',categoryId:web.id,categoryLabel:web.label})}if(!/lock|minh long/.test(fold(part))&&/lock|minh long/.test(fold(prompt)))c.brand=parseIntent(prompt).brand;return c});
 const priced=groups.filter(g=>g.min>0||g.max!==null);if(priced.length===1)for(const g of groups)if(g.min===0&&g.max===null){g.min=priced[0].min;g.max=priced[0].max}
 const stockSource=/\bcrm\b/.test(fold(prompt))?'crm':'website';for(const c of groups)c.stockSource=stockSource;return groups.length?groups:[parseIntent(prompt)];
}
export async function interpretIntent(prompt,env={},request,catalog=[],preferredStockSource=''){
 if(typeof prompt!=='string'||prompt.trim().length<5||prompt.length>1000)throw Error('Nhập yêu cầu từ 5 đến 1.000 ký tự.');
 const baseline=parsePlan(prompt,catalog),stockSource=/\bcrm\b/.test(fold(prompt))?'crm':preferredStockSource||'website';if(!['crm','website'].includes(stockSource))throw Error('Nguồn tồn kho chưa hợp lệ.');for(const c of baseline)c.stockSource=stockSource;let warning='',diagnostic='';
 if(env.AI&&request){
  let user;try{user=await staffForAI(request)}catch(e){warning=String(e.message).startsWith('Anh/chị đã gửi')?e.message:'Chưa xác thực được phiên CRM. Vui lòng đăng nhập lại CRM rồi thử lại.';}
  if(user){let stage='model';try{
   const item={type:'object',properties:{brand:{type:'string',enum:['LocknLock','Minh Long','both']},type:{type:'string',enum:[...assistantTypes.map(t=>t.key),'website']},categoryId:{type:'integer'},min:{type:'number'},max:{type:['number','null']},limit:{type:'integer'},packSize:{type:'integer',enum:[1,10]},keywords:{type:'array',items:{type:'string'}}},required:['brand','type','min','max','limit','packSize','keywords']};
   const schema={type:'object',properties:{groups:{type:'array',minItems:1,maxItems:12,items:item}},required:['groups']};
   const result=await env.AI.run(env.CATALOGUE_AI_MODEL||'@cf/meta/llama-3.3-70b-instruct-fp8-fast',{messages:[{role:'system',content:'Trích xuất yêu cầu quà tặng tiếng Việt thành NHIỀU nhóm danh mục-ngân sách, chỉ trả JSON đúng schema. Không bỏ sót danh mục nối bằng + hoặc và. Mỗi danh mục, mỗi khoảng giá riêng là một group. Ví dụ ly sứ + ly dưỡng sinh phải có 2 group ly-su và ly-duong-sinh. Danh mục thông dụng: '+assistantTypes.map(t=>t.key+'='+t.label).join('; ')+'. Luôn ưu tiên type thông dụng; categoryId=0. Danh mục khác: dùng type=website và categoryId đúng trong danh sách sau, chỉ một brand: '+JSON.stringify(catalog.map(c=>({id:c.id,brand:c.brand,name:c.label})))+'. Không bịa danh mục. 2tr=2000000,350k=350000; từ 2tr trở lại=min0,max2000000. Giá là giá chào sau chiết khấu + phụ phí. Ngân sách chung áp dụng cho mọi nhóm, ngân sách riêng gắn đúng danh mục. Bộ trà/đồ sứ mặc định Minh Long. Mặc định limit=200,packSize=1,keywords=[]; chỉ packSize=10 khi nói rõ bộ 10 SP. Chỉ còn hàng.'},{role:'user',content:prompt}],temperature:0,max_tokens:1600,response_format:{type:'json_schema',json_schema:schema}});
   stage='json';const output=result?.response??(result?.groups?result:result?.result?.response);const raw=typeof output==='string'?JSON.parse(output.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')):output;stage='criteria';const rows=raw.groups||[raw];if(!Array.isArray(rows)||!rows.length||rows.length>12)throw Error('Invalid groups');let groups=rows.map(validateCriteria);
   // A small model must not collapse explicit category/budget combinations.
   if(baseline.length>1&&baseline.every(g=>g.type)&&baseline.some(c=>!groups.some(g=>g.type===c.type&&g.brand===c.brand&&g.min===c.min&&g.max===c.max)))groups=baseline.map(c=>validateCriteria({...c,keywords:groups.find(g=>g.type===c.type)?.keywords||c.keywords}));
   for(const c of groups)c.stockSource=stockSource;if(groups.length>12)throw Error('Too many groups');return {criteria:groups[0],groups,engine:'cloudflare_ai',warning:'',catalog,stockSource};
  }catch(e){diagnostic=[stage,String(e.name||'Error'),String(e.code||String(e.message).match(/\b\d{4,5}\b/)?.[0]||'unknown'),/quota|free.*limit|usage.*limit/i.test(String(e.message))?'quota':/context|token.*limit|too.*long/i.test(String(e.message))?'context':'other'].join(':');warning='AI chưa phản hồi hợp lệ. Đang dùng bộ lọc câu lệnh; vui lòng kiểm tra các nhóm tiêu chí.';}}
  else if(!warning)warning='Đăng nhập CRM để dùng diễn giải bằng AI. Hiện đang dùng bộ lọc câu lệnh.';
 }else warning='Kết nối AI chưa bật ở môi trường này. Đang dùng bộ lọc câu lệnh nhiều danh mục.';
 return {criteria:baseline[0],groups:baseline,engine:'criteria',warning,catalog,stockSource,diagnostic};
}
const categoryCache=new Map();
export function matchingProduct(q,criteria,type,brand,pricing){
 if(criteria.stockSource!=='crm'&&!q.is_in_stock||!type.name.test(fold(q.name))||type.exclude?.test(fold(q.name)))return false;
 const regular=Number(q.prices?.regular_price)/10**Number(q.prices?.currency_minor_unit||0);if(q.prices?.currency_code!=='VND'||!Number.isFinite(regular)||regular<=0)return false;
 const discount=brand==='LocknLock'?pricing.lockDiscount:pricing.minhDiscount;const offer=Math.round(regular*(1-discount/100)+pricing.fee)*criteria.packSize;
 return offer>=criteria.min&&(criteria.max===null||offer<=criteria.max)&&criteria.keywords.every(k=>fold(q.name).includes(fold(k)));
}
export async function discoverProducts(criteriaValue,pricingValue,adapter){
 const criteria=validateCriteria(criteriaValue);if(criteria.provider){if(!adapter.externalProducts)throw Error('Chưa hỗ trợ thương hiệu này.');return adapter.externalProducts(criteria)}const type=assistantTypes.find(t=>t.key===criteria.type)||{key:'website',label:criteria.categoryLabel,name:/.*/,categoryTerms:[]};
 const pricing={lockDiscount:Number(pricingValue?.lockDiscount??40),minhDiscount:Number(pricingValue?.minhDiscount??10),fee:Number(pricingValue?.fee??15000)};
 if(!Number.isFinite(pricing.fee)||pricing.fee<0||pricing.fee>1e8||![pricing.lockDiscount,pricing.minhDiscount].every(n=>Number.isFinite(n)&&n>=0&&n<100))throw Error('Thiết lập chiết khấu hoặc phụ phí chưa hợp lệ.');
 const brands=criteria.brand==='both'?['LocknLock','Minh Long']:[criteria.brand],found=[],errors=[],sources=[];let scanned=0,moreAvailable=false;
 for(const brand of brands){
  const host=brand==='LocknLock'?'locknlockonline.com':'minhlongonline.com';
  try{
   const cats={rows:await websiteCategories(host,adapter)};
   const matched=criteria.categoryId?cats.rows.filter(c=>Number(c.id)===criteria.categoryId).map(c=>({c,score:100})):cats.rows.map(c=>({c,score:Math.max(...type.categoryTerms.map(term=>{const name=fold(c.name);return name===term?100:name.includes(term)?70:fold(c.slug).replaceAll('-',' ').includes(term)?50:0}))})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||Number(b.c.count)-Number(a.c.count));
   if(!matched.length){errors.push(`${brand}: chưa tìm thấy danh mục ${type.label}.`);continue;}
   const best=matched[0].c;sources.push({brand,host,category:String(best.name),categoryId:best.id});
   for(let page=1;page<=10;page++){
    const u=new URL(`https://${host}/wp-json/wc/store/v1/products`);u.searchParams.set('category',String(best.id));if(criteria.stockSource!=='crm')u.searchParams.set('stock_status','instock');u.searchParams.set('per_page','100');u.searchParams.set('page',String(page));u.searchParams.set('orderby','price');u.searchParams.set('order','asc');u.searchParams.set('_fields','id,name,sku,slug,permalink,type,prices,is_in_stock,images,categories');
    if(criteria.max!==null){const discount=brand==='LocknLock'?pricing.lockDiscount:pricing.minhDiscount;const ceiling=(criteria.max/criteria.packSize-pricing.fee)/(1-discount/100);if(ceiling<=0)break;u.searchParams.set('max_price',String(Math.ceil(ceiling)));}
    const rows=await adapter.json(u.href);if(!Array.isArray(rows))throw Error('Website chưa trả danh sách sản phẩm.');scanned+=rows.length;
    const candidates=rows.filter(q=>matchingProduct(q,criteria,type,brand,pricing));if(criteria.stockSource==='crm'&&!adapter.crmStock)throw Error('Chưa kết nối nguồn tồn CRM.');const crm=criteria.stockSource==='crm'?await adapter.crmStock(candidates.map(q=>q.sku)):null;
    for(const q of candidates){const crmEvidence=crm?.get(String(q.sku||'').trim().toUpperCase());if(criteria.stockSource==='crm'&&(!crmEvidence||crmEvidence.available<=0))continue;const canonical=adapter.sourceUrl(q.permalink||`https://${host}/san-pham/${q.slug}/`);if(canonical.hostname!==host)continue;
     const p=adapter.normalize(q,canonical);p.category=criteria.categoryId?categoryLabel(best.name):type.label;p.discount=brand==='LocknLock'?pricing.lockDiscount:pricing.minhDiscount;p.fee=pricing.fee;p.qty=1;p.override=null;p.inStock=true;if(crmEvidence)p.crmStock=crmEvidence;
     if(found.some(x=>x.url===p.url))continue;if(found.length>=criteria.limit){moreAvailable=true;break;}found.push(p);
    }
    if(moreAvailable||rows.length<100)break;if(page===10)moreAvailable=true;
   }
  }catch(e){errors.push(`${brand}: ${e.message}`);}
 }
 const offer=p=>Math.round(p.regular*(1-p.discount/100)+p.fee)*criteria.packSize;found.sort((a,b)=>offer(a)-offer(b));
 if(!found.length&&errors.length)throw Error(errors.join(' '));
 return {products:found,criteria,scanned,moreAvailable,errors,sources,stockSource:criteria.stockSource,checkedAt:new Date().toISOString()};
}
const categoryLabel=value=>String(value||'').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replaceAll('&amp;','&').replace(/<[^>]*>/g,'').trim();
async function websiteCategories(host,adapter){let cached=categoryCache.get(host);if(cached&&Date.now()-cached.at<3600000)return cached.rows;const rows=[];for(let page=1;page<=3;page++){const list=await adapter.json(`https://${host}/wp-json/wc/store/v1/products/categories?per_page=100&page=${page}`);if(!Array.isArray(list))throw Error('Website chưa trả danh mục.');rows.push(...list);if(list.length<100)break}categoryCache.set(host,{at:Date.now(),rows});return rows;}
export async function categoryOptions(adapter){const list=await Promise.allSettled(['LocknLock','Minh Long'].map(async brand=>{const host=brand==='LocknLock'?'locknlockonline.com':'minhlongonline.com';return (await websiteCategories(host,adapter)).filter(c=>Number(c.count)>0).map(c=>({id:Number(c.id),brand,label:categoryLabel(c.name),count:Number(c.count)}))}));return list.flatMap(r=>r.status==='fulfilled'?r.value:[]).sort((a,b)=>a.brand.localeCompare(b.brand)||a.label.localeCompare(b.label,'vi'));}
export async function discoverPlan(groupValues,pricing,adapter){if(!Array.isArray(groupValues)||!groupValues.length||groupValues.length>12)throw Error('Chọn từ 1 đến 12 nhóm danh mục – ngân sách.');const groups=groupValues.map(validateCriteria),reports=new Array(groups.length);let cursor=0;await Promise.all(Array.from({length:Math.min(2,groups.length)},async()=>{while(cursor<groups.length){const i=cursor++;try{reports[i]=await discoverProducts(groups[i],pricing,adapter)}catch(e){reports[i]={products:[],errors:[`Nhóm ${i+1}: ${e.message}`],sources:[],scanned:0}}}}));const products=[],seen=new Set(),errors=[],sources=[],groupReports=[];let scanned=0,moreAvailable=false;for(const [i,r]of reports.entries()){let count=0;for(const p of r.products){if(seen.has(p.url))continue;if(products.length>=500){moreAvailable=true;break}seen.add(p.url);products.push({...p,packSize:groups[i].packSize});count++}errors.push(...r.errors);sources.push(...r.sources);scanned+=r.scanned;moreAvailable||=!!r.moreAvailable;groupReports.push({index:i+1,count,type:groups[i].type,min:groups[i].min,max:groups[i].max});if(!count&&!r.errors.length)errors.push(`Nhóm ${i+1}: không có sản phẩm mới phù hợp hoặc đã nằm trong nhóm trước.`)}return {products,groups,groupReports,errors,sources,scanned,moreAvailable,checkedAt:new Date().toISOString()};}
export async function handleAssistant(request,env,adapter){
 if(request.method!=='POST')return assistantReply({error:'Chức năng này dùng POST.'},405);
 try{if(Number(request.headers.get('content-length'))>20000)throw Error('Yêu cầu quá dài.');const text=await request.text();if(text.length>20000)throw Error('Yêu cầu quá dài.');const body=JSON.parse(text);
  if(body.action==='brand-preview')return assistantReply(await adapter.brandPreview(body.url,body.prompt));
  if(body.action==='categories')return assistantReply({catalog:await categoryOptions(adapter)});
  if(body.action==='interpret')return assistantReply(await interpretIntent(body.prompt,env,request,await categoryOptions(adapter),body.stockSource||''));
  if(body.action==='search')return assistantReply(body.groups?await discoverPlan(body.groups,body.pricing,adapter):await discoverProducts(body.criteria,body.pricing,adapter));
  throw Error('Chức năng trợ lý chưa hợp lệ.');
 }catch(e){return assistantReply({error:e.message||'Chưa xử lý được yêu cầu.'},400)}
}
