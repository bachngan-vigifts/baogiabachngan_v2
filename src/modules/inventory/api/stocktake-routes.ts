import {and,asc,desc,eq,inArray,isNull,sql} from 'drizzle-orm';
import {AppError} from '../../../core/errors.ts';
import {json,readJson,type Router,type RouteContext} from '../../../core/http/router.ts';
import {nextDocumentNumber,documentNumberPatterns} from '../../../core/document-number.ts';
import type {StaffEnv,SessionState} from '../../staff/api/auth-routes.ts';
import {can} from '../../staff/domain/permissions.ts';
import {sha256Hex} from '../../staff/domain/session.ts';
import {employees} from '../../staff/schema.ts';
import {catalogueLibrary} from '../../catalog/catalogue-library-schema.ts';
import {products,warehouses} from '../../catalog/schema.ts';
import {inventoryAdjustments as docs,stockBalances,stockMoves} from '../schema.ts';
import {stocktakeCommands as commands,stocktakeStates as states} from '../stocktake-schema.ts';
import {draftLines,mergeCountedLines,stocktakeTotals,type DraftLine} from '../domain/stocktake-workspace.ts';
import {assertWarehousesOpened,postMoves} from './ledger.ts';
import {audit,catalogLines,countSnapshot,latestCosts,productNames} from './adjustment-routes.ts';
type Ctx=RouteContext<StaffEnv>;type Db=StaffEnv['db'];type Tx=Parameters<Parameters<Db['transaction']>[0]>[0];type Doc=typeof docs.$inferSelect;
const me=(c:Ctx)=>(c.state.session as SessionState).member;
function fail(status:number,message:string,code?:string):never{throw new AppError(status,message,code);}
const isCount=sql`(${docs.lines}::jsonb @> '[{"source":"stocktake"}]'::jsonb OR EXISTS (SELECT 1 FROM inventory_stocktake_states ss WHERE ss.adjustment_id=${docs.id}))`;
const phase=(r:Doc)=>r.status==='approved'?'balanced':r.status==='rejected'?'cancelled':'draft';
const parse=(r:Doc)=>JSON.parse(r.lines) as DraftLine[];
const revision=(b:Record<string,unknown>)=>{if(!Number.isSafeInteger(b.revision)||Number(b.revision)<0)fail(400,'Thiếu phiên bản phiếu. Tải lại phiếu.');return Number(b.revision);};
export function registerStocktakeRoutes(router:Router<StaffEnv>,allowed:(c:Ctx)=>Promise<{id:string;name:string}[]>){
 async function access(c:Ctx,write=false){if(!can(me(c),'inventory.view')||(write&&!can(me(c),'inventory.manage')))fail(403,'Bạn chưa được cấp quyền thao tác kiểm kê.');return (await allowed(c)).map(w=>w.id);}
 async function get(db:Db|Tx,c:Ctx,id:string,ids:string[],lock=false){
  const query=db.select().from(docs).where(and(eq(docs.id,id),ids.length?inArray(docs.warehouseId,ids):sql`false`,isCount)).limit(1);
  const [row]=lock?await query.for('update'):await query;if(!row)fail(404,'Không tìm thấy phiếu kiểm kho.');
  const [state]=await db.select().from(states).where(eq(states.adjustmentId,id)).limit(1);return {row,state};
 }
 function editable(c:Ctx,r:Doc){if(me(c).role!=='manager'&&r.createdBy!==me(c).id)fail(403,'Chỉ người tạo hoặc Manager được sửa phiếu này.');}
 async function ensure(tx:Tx,id:string){await tx.insert(states).values({adjustmentId:id}).onConflictDoNothing();}
 async function bump(tx:Tx,id:string,version:number,extra:Partial<typeof states.$inferInsert>={}){await ensure(tx,id);await tx.update(states).set({...extra,revision:version+1}).where(eq(states.adjustmentId,id));}
 async function normalize(db:Db|Tx,raw:unknown){
  let lines:DraftLine[];try{lines=draftLines(raw);}catch(e){return fail(400,(e as Error).message);}
  if(lines.length){const found=await db.select({sku:products.sku}).from(products).where(inArray(products.sku,lines.map(l=>l.sku)));if(found.length!==lines.length)fail(400,'Mã không có trong danh mục. Chọn đúng mã hàng.');}return lines;
 }
 async function command(c:Ctx,ids:string[],body:Record<string,unknown>,action:(tx:Tx)=>Promise<{id:string;revision:number;status:string;refNo:string}>){
  const key=body.key;if(typeof key!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(key))fail(400,'Thiếu khóa chống gửi lặp.');
  const hash=sha256Hex(JSON.stringify({path:c.url.pathname,method:c.req.method,body})),actorId=me(c).id;
  return c.env.db.transaction(async tx=>{
   await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'stocktake-command:'+actorId+':'+key}))`);
   const [old]=await tx.select().from(commands).where(and(eq(commands.actorId,actorId),eq(commands.clientKey,key))).limit(1);
   if(old){if(old.requestHash!==hash)fail(409,'Khóa gửi đã dùng cho nội dung khác.','STOCKTAKE_KEY_CONFLICT');const result=JSON.parse(old.result);await get(tx,c,result.id,ids);return {...result,replayed:true};}
   const result=await action(tx);await tx.insert(commands).values({id:crypto.randomUUID(),actorId,clientKey:key,requestHash:hash,adjustmentId:result.id,result:JSON.stringify(result),createdAt:new Date().toISOString()});return {...result,replayed:false};
  });
 }
 async function create(tx:Tx,c:Ctx,warehouseId:string,note:string,lines:DraftLine[],key:string){
  const [warehouse]=await tx.select().from(warehouses).where(and(eq(warehouses.id,warehouseId),eq(warehouses.kind,'stock'),eq(warehouses.active,true))).limit(1);if(!warehouse)fail(400,'Chọn kho kiểm kê hợp lệ.');
  await assertWarehousesOpened(tx,[warehouseId]);
  // Same exclusive lock as legacy count creation: reference numbering cannot race it.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('stock_ledger_opening'))`);
  if((await tx.select({id:docs.id}).from(docs).where(and(eq(docs.createdBy,me(c).id),eq(docs.clientKey,key))).limit(1)).length)fail(409,'Khóa gửi đã được dùng ở giao diện khác. Kiểm tra phiếu đã có trước khi tạo lại.','STOCKTAKE_KEY_CONFLICT');
  const now=new Date().toISOString(),day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date()),pattern=documentNumberPatterns('KK',day)[0];
  const used=await tx.select({no:docs.refNo}).from(docs).where(sql`${docs.refNo} LIKE ${pattern}`),id=crypto.randomUUID(),refNo=nextDocumentNumber('KK',day,used.map(r=>r.no));
  await tx.insert(docs).values({id,refNo,warehouseId,reason:note,lines:JSON.stringify(lines),status:'pending',createdBy:me(c).id,createdAt:now,clientKey:key,payloadHash:sha256Hex(JSON.stringify({warehouseId,note,lines}))});
  await tx.insert(states).values({adjustmentId:id,revision:1});await audit(tx,me(c).id,id,'stocktake-draft-created',{refNo,warehouseId,lines});return {id,refNo,revision:1,status:'draft'};
 }
 async function shown(c:Ctx,rows:Doc[]){
  if(!rows.length)return [];
  const meta=await c.env.db.select().from(states).where(inArray(states.adjustmentId,rows.map(r=>r.id))),byId=new Map(meta.map(r=>[r.adjustmentId,r]));
  const peopleIds=[...new Set([...rows.flatMap(r=>[r.createdBy,...r.reviewedBy?[r.reviewedBy]:[]]),...meta.flatMap(r=>r.balancedBy?[r.balancedBy]:[])])],people=await c.env.db.select({id:employees.id,name:employees.name}).from(employees).where(inArray(employees.id,peopleIds));
  const whs=await allowed(c),person=new Map(people.map(p=>[p.id,p.name])),skus=[...new Set(rows.flatMap(r=>parse(r).map(l=>l.sku)))],names=await productNames(c.env.db,skus),costs=me(c).role==='manager'?Object.fromEntries(await latestCosts(c.env.db,skus)):undefined;
  return rows.map(row=>{const state=byId.get(row.id),snapshot=state?.costs&&state.costs!=='{}'?JSON.parse(state.costs):costs,lines=parse(row).map(l=>({...l,name:(names as Record<string,{name:string;unit:string}>)[l.sku]?.name||l.sku,unit:(names as Record<string,{name:string;unit:string}>)[l.sku]?.unit||'',...(costs&&snapshot[l.sku]!==undefined?{cost:snapshot[l.sku]}:{})}));
   return {id:row.id,refNo:row.refNo,warehouseId:row.warehouseId,warehouseName:whs.find(w=>w.id===row.warehouseId)?.name||'',note:row.reason,status:phase(row),legacyRejected:row.status==='rejected'&&!state?.cancelledAt,revision:state?.revision??0,createdBy:row.createdBy,createdByName:person.get(row.createdBy)||'',createdAt:row.createdAt,balancedByName:person.get(state?.balancedBy||(row.status==='approved'?row.reviewedBy:'')||'')||'',balancedAt:state?.balancedAt??(row.status==='approved'?row.reviewedAt:null),cancelledAt:state?.cancelledAt,mergedInto:state?.mergedInto,reviewNote:row.reviewNote,canEdit:row.status!=='rejected'&&can(me(c),'inventory.manage')&&(me(c).role==='manager'||row.createdBy===me(c).id),canComplete:row.status==='pending'&&me(c).role==='manager',canCancel:row.status!=='rejected'&&can(me(c),'inventory.manage')&&(me(c).role==='manager'||(row.status==='pending'&&row.createdBy===me(c).id)),lines,totals:stocktakeTotals(lines,costs?snapshot:undefined)};
  });
 }
 router.post('/inventory/stocktake-products',async c=>{
  const ids=await access(c),b=await readJson(c.req,100000),wh=String(b.warehouseId||''),q=String(b.q||'').trim().slice(0,100),skus=b.skus;
  if(!ids.includes(wh))fail(403,'Kho không thuộc phạm vi của bạn.');if(skus!==undefined&&(!Array.isArray(skus)||skus.length>300||skus.some(s=>typeof s!=='string'||!s||s.length>200)))fail(400,'Danh sách mã hàng không hợp lệ.');
  const like='%'+q.replace(/[\\%_]/g,m=>'\\'+m)+'%',rows=await c.env.db.select({sku:products.sku,name:products.name,unit:products.unit,imageUrl:products.imageUrl,barcodeMatch:q?sql<boolean>`EXISTS (SELECT 1 FROM product_barcodes b WHERE b.sku=${products.sku} AND b.barcode=${q})`:sql<boolean>`false`}).from(products).where(and(eq(products.active,true),Array.isArray(skus)?(skus.length?inArray(products.sku,skus):sql`false`):q?sql`(${products.sku} ILIKE ${like} OR ${products.name} ILIKE ${like} OR EXISTS (SELECT 1 FROM product_barcodes b WHERE b.sku=${products.sku} AND b.barcode=${q}))`:sql`false`)).orderBy(asc(products.name),asc(products.sku)).limit(Array.isArray(skus)?300:20);
  const wanted=rows.map(r=>r.sku),balances=wanted.length?await c.env.db.select().from(stockBalances).where(and(eq(stockBalances.warehouseId,wh),inArray(stockBalances.sku,wanted))):[],bySku=new Map(balances.map(r=>[r.sku,r.qty])),costs=me(c).role==='manager'?await latestCosts(c.env.db,wanted):null;
  return json({products:rows.map(p=>({...p,expectedQty:bySku.get(p.sku)||0,...(costs?.has(p.sku)?{cost:costs.get(p.sku)}:{})}))});
 },'business');
 router.get('/inventory/stocktakes',async c=>{
  const ids=await access(c),p=c.url.searchParams,selected=(p.get('statuses')??'draft,balanced').split(',').filter(Boolean),limit=Number(p.get('limit')||15),offset=Number(p.get('offset')||0),q=(p.get('q')||'').trim().slice(0,100),wh=p.get('warehouseId')||'',from=p.get('from')||'',to=p.get('to')||'',sort=p.get('sort')||'createdAt',direction=p.get('direction')||'desc';
  if(selected.some(x=>!['draft','balanced','cancelled'].includes(x))||![10,15,20,30,50,100].includes(limit)||!Number.isSafeInteger(offset)||offset<0||offset>1e6||!['createdAt','refNo','reviewedAt'].includes(sort)||!['asc','desc'].includes(direction))fail(400,'Bộ lọc phiếu không hợp lệ.');
  const valid=(d:string)=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
  if((from&&!valid(from))||(to&&!valid(to))||(from&&to&&from>to))fail(400,'Khoảng ngày không hợp lệ.');
  const statuses=selected.map(x=>x==='draft'?'pending':x==='balanced'?'approved':'rejected'),like='%'+q.replace(/[\\%_]/g,m=>'\\'+m)+'%',start=from?new Date(from+'T00:00:00+07:00').toISOString():'',end=to?new Date(Date.parse(to+'T00:00:00+07:00')+864e5).toISOString():'';
  const wantedIds=p.has('ids')?(p.get('ids')||'').split(',').filter(Boolean):null;if(wantedIds&&(wantedIds.length>500||wantedIds.some(id=>id.length>100)))fail(400,'Danh sách phiếu đánh dấu không hợp lệ.');
  const where=and(wantedIds?(wantedIds.length?inArray(docs.id,wantedIds):sql`false`):undefined,ids.length?inArray(docs.warehouseId,ids):sql`false`,isCount,statuses.length?inArray(docs.status,statuses as ['pending']):sql`false`,wh?eq(docs.warehouseId,wh):undefined,from?sql`${docs.createdAt}>=${start}`:undefined,to?sql`${docs.createdAt}<${end}`:undefined,q?sql`(${docs.refNo} ILIKE ${like} OR ${docs.reason} ILIKE ${like} OR EXISTS (SELECT 1 FROM jsonb_array_elements(${docs.lines}::jsonb) l LEFT JOIN products p ON p.sku=l->>'sku' WHERE l->>'sku' ILIKE ${like} OR p.name ILIKE ${like}))`:undefined);
  const sortColumn=sort==='refNo'?docs.refNo:sort==='reviewedAt'?docs.reviewedAt:docs.createdAt;
  const [rows,total]=await Promise.all([c.env.db.select().from(docs).where(where).orderBy(direction==='asc'?asc(sortColumn):desc(sortColumn),desc(docs.id)).limit(limit).offset(offset),c.env.db.select({total:sql<number>`count(*)::int`}).from(docs).where(where)]);
  const count=Number(total[0]?.total||0);return json({sheets:await shown(c,rows),total:count,offset,limit,nextOffset:offset+rows.length<count?offset+rows.length:null,canManage:can(me(c),'inventory.manage'),canComplete:me(c).role==='manager'});
 },'business');
 router.get('/inventory/stocktakes/groups',async c=>{
  await access(c);const rows=await c.env.db.selectDistinct({name:catalogueLibrary.category,sku:products.sku}).from(catalogueLibrary).innerJoin(products,eq(products.sku,catalogueLibrary.sku)).where(and(isNull(catalogueLibrary.deletedAt),eq(products.active,true),sql`${catalogueLibrary.category}<>''`));
  const groups=new Map<string,string[]>();for(const r of rows)groups.set(r.name,[...(groups.get(r.name)||[]),r.sku]);return json({groups:[...groups].sort(([a],[b])=>a.localeCompare(b,'vi')).map(([name,skus])=>({name,skus}))});
 },'business');
 router.get('/inventory/stocktakes/:id',async c=>{
  const ids=await access(c),{row}=await get(c.env.db,c,c.params.id!,ids),sheet=(await shown(c,[row]))[0]!,skus=sheet.lines.map(l=>l.sku);
  const balances=skus.length?await c.env.db.select().from(stockBalances).where(and(eq(stockBalances.warehouseId,row.warehouseId),inArray(stockBalances.sku,skus))):[];
  const names=await productNames(c.env.db,skus,me(c).role==='manager');const {clientKey:_key,payloadHash:_hash,...safeRow}=row;return json({sheet,adjustment:{...safeRow,lines:parse(row),warehouseName:sheet.warehouseName,createdByName:sheet.createdByName,reviewedByName:sheet.balancedByName},balances:Object.fromEntries(balances.map(b=>[b.sku,b.qty])),names,canApprove:me(c).role==='manager'});
 },'business');
 router.post('/inventory/stocktakes',async c=>{
  const ids=await access(c,true),b=await readJson(c.req,400000),wh=String(b.warehouseId||'');if(!ids.includes(wh))fail(403,'Kho không thuộc phạm vi của bạn.');
  const lines=await normalize(c.env.db,b.lines),note=String(b.note??'').trim().slice(0,500);
  const result=await command(c,ids,b,tx=>create(tx,c,wh,note,lines,String(b.key)));return json(result,result.replayed?200:201);
 },'business');
 router.put('/inventory/stocktakes/:id',async c=>{
  const ids=await access(c,true),b=await readJson(c.req,400000),version=revision(b),id=c.params.id!;
  const result=await command(c,ids,b,async tx=>{const {row,state}=await get(tx,c,id,ids,true);editable(c,row);if((state?.revision??0)!==version)fail(409,'Phiếu đã được sửa trên thiết bị khác. Tải lại trước khi lưu.','STOCKTAKE_REVISION');if(row.status==='rejected')fail(409,'Phiếu đã hủy, không thể sửa.');
   const note=String(b.note??'').trim().slice(0,500);
   if(row.status==='approved'){if(b.lines!==undefined||b.warehouseId!==undefined)fail(409,'Phiếu đã cân bằng chỉ được sửa ghi chú.');await tx.update(docs).set({reason:note}).where(eq(docs.id,id));}
   else{const wh=String(b.warehouseId??row.warehouseId);if(wh!==row.warehouseId)fail(409,'Không đổi kho của phiếu đã lưu. Tạo phiếu mới theo kho cần kiểm.');const lines=await normalize(tx,b.lines);await tx.update(docs).set({reason:note,lines:JSON.stringify(lines)}).where(eq(docs.id,id));}
   await bump(tx,id,version);await audit(tx,me(c).id,id,'stocktake-updated',{revision:version+1,note});return {id,revision:version+1,status:phase(row),refNo:row.refNo};});return json(result);
 },'business');
 router.post('/inventory/stocktakes/:id/complete',async c=>{
  const ids=await access(c,true);if(me(c).role!=='manager')fail(403,'Chỉ Manager được hoàn thành và ghi tồn kho.');const b=await readJson(c.req,3000),version=revision(b),id=c.params.id!;
  const result=await command(c,ids,b,async tx=>{const {row,state}=await get(tx,c,id,ids,true);if((state?.revision??0)!==version)fail(409,'Phiếu đã thay đổi, tải lại trước khi hoàn thành.','STOCKTAKE_REVISION');if(row.status!=='pending')fail(409,'Chỉ hoàn thành Phiếu tạm.');const raw=parse(row);if(!raw.length||raw.some(l=>l.countedQty===null))fail(400,'Nhập thực tế cho mọi mã, kể cả số0; còn mã chưa kiểm.');
   const lines=await catalogLines(tx,raw.map(l=>({...l,source:'stocktake' as const,countedQty:l.countedQty!})),true);await assertWarehousesOpened(tx,[row.warehouseId]);const drift=await countSnapshot(tx,row.warehouseId,lines,b.applyDelta===true);
   await postMoves(tx,me(c).id,lines.filter(l=>l.qty!==0).map(l=>({...l,warehouseId:row.warehouseId,kind:'adjust',refType:'adjustment',refId:id,refNo:row.refNo,note:row.reason})));
   const now=new Date().toISOString(),costs=Object.fromEntries(await latestCosts(tx,lines.map(l=>l.sku)));await tx.update(docs).set({status:'approved',lines:JSON.stringify(lines),reviewedBy:me(c).id,reviewedAt:now}).where(eq(docs.id,id));await bump(tx,id,version,{costs:JSON.stringify(costs),balancedAt:now,balancedBy:me(c).id});await audit(tx,me(c).id,id,'stocktake-completed',{revision:version+1,lines,drift});return {id,revision:version+1,status:'balanced',refNo:row.refNo};});return json(result);
 },'business');
 router.post('/inventory/stocktakes/:id/cancel',async c=>{
  const ids=await access(c,true),b=await readJson(c.req,3000),version=revision(b),id=c.params.id!;
  const result=await command(c,ids,b,async tx=>{const {row,state}=await get(tx,c,id,ids,true);editable(c,row);if((state?.revision??0)!==version)fail(409,'Phiếu đã thay đổi. Tải lại trước khi hủy.','STOCKTAKE_REVISION');if(row.status==='rejected')fail(409,'Phiếu đã hủy.');if(row.status==='approved'&&me(c).role!=='manager')fail(403,'Chỉ Manager được hủy phiếu đã cân bằng.');
   if(row.status==='approved'){const moves=await tx.select().from(stockMoves).where(and(eq(stockMoves.refType,'adjustment'),eq(stockMoves.refId,id),eq(stockMoves.kind,'adjust')));await postMoves(tx,me(c).id,moves.map(m=>({sku:m.sku,warehouseId:m.warehouseId,qty:-m.qty,kind:'reverse',refType:'adjustment',refId:id,refNo:row.refNo,note:'Hủy phiếu kiểm kho '+row.refNo})));}
   const now=new Date().toISOString();await tx.update(docs).set({status:'rejected',reviewNote:'Hủy phiếu kiểm kho',...(row.status==='pending'?{reviewedBy:me(c).id,reviewedAt:now}:{})}).where(eq(docs.id,id));await bump(tx,id,version,{cancelledAt:now,cancelledBy:me(c).id,...(row.status==='approved'?{balancedAt:row.reviewedAt,balancedBy:row.reviewedBy}:{})});await audit(tx,me(c).id,id,'stocktake-cancelled',{revision:version+1,previousStatus:row.status});return {id,revision:version+1,status:'cancelled',refNo:row.refNo};});return json(result);
 },'business');
 router.post('/inventory/stocktakes/:id/clone',async c=>{
  const ids=await access(c,true),b=await readJson(c.req,3000),version=revision(b);
  const result=await command(c,ids,b,async tx=>{const {row,state}=await get(tx,c,c.params.id!,ids,true);if((state?.revision??0)!==version)fail(409,'Phiếu nguồn đã thay đổi. Tải lại trước khi sao chép.');const lines=parse(row),balances=lines.length?await tx.select().from(stockBalances).where(and(eq(stockBalances.warehouseId,row.warehouseId),inArray(stockBalances.sku,lines.map(l=>l.sku)))):[],bySku=new Map(balances.map(b=>[b.sku,b.qty]));return create(tx,c,row.warehouseId,row.reason,lines.map(l=>({sku:l.sku,expectedQty:bySku.get(l.sku)||0,countedQty:null,qty:0,source:'stocktake-draft'})),String(b.key));});return json(result,result.replayed?200:201);
 },'business');
 router.post('/inventory/stocktakes/merge',async c=>{
  const ids=await access(c,true),b=await readJson(c.req,10000),sources=b.sources;if(!Array.isArray(sources)||sources.length<2||sources.length>20||new Set(sources.map(s=>s?.id)).size!==sources.length)fail(400,'Chọn từ2đến20phiếu tạm khác nhau.');
  const refs=sources.map(s=>({id:String(s.id||''),revision:revision(s)})).sort((a,b)=>a.id.localeCompare(b.id));
  const result=await command(c,ids,b,async tx=>{const rows:Doc[]=[];for(const ref of refs){const {row,state}=await get(tx,c,ref.id,ids,true);editable(c,row);if(row.status!=='pending'||(state?.revision??0)!==ref.revision)fail(409,'Chỉ gộp phiếu tạm đúng phiên bản. Tải lại danh sách.');rows.push(row);}const wh=rows[0]!.warehouseId;if(rows.some(r=>r.warehouseId!==wh))fail(400,'Các phiếu cần gộp phải cùng kho.');
   const skus=[...new Set(rows.flatMap(r=>parse(r).map(l=>l.sku)))],balances=skus.length?await tx.select().from(stockBalances).where(and(eq(stockBalances.warehouseId,wh),inArray(stockBalances.sku,skus))):[];
   let lines:DraftLine[];try{lines=mergeCountedLines(rows.map(parse),Object.fromEntries(balances.map(b=>[b.sku,b.qty])));}catch(e){return fail(400,(e as Error).message);}
   const target=await create(tx,c,wh,rows.map(r=>r.reason).filter(Boolean).join('; ').slice(0,500),lines,String(b.key)),now=new Date().toISOString();
   for(const [i,row]of rows.entries()){await tx.update(docs).set({status:'rejected',reviewNote:'Gộp vào '+target.refNo,reviewedBy:me(c).id,reviewedAt:now}).where(eq(docs.id,row.id));await bump(tx,row.id,refs[i]!.revision,{cancelledAt:now,cancelledBy:me(c).id,mergedInto:target.id});await audit(tx,me(c).id,row.id,'stocktake-merged',{targetId:target.id});}return target;});return json(result,result.replayed?200:201);
 },'business');
}
