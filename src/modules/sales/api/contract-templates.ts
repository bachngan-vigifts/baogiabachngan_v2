import {desc,eq} from 'drizzle-orm';
import {AppError} from '../../../core/errors.ts';
import {json,readJson,type Router,type RouteContext} from '../../../core/http/router.ts';
import type {StaffEnv,SessionState} from '../../staff/api/auth-routes.ts';
import {cleanWordEdits} from '../../quotes/domain/quotation-schema.ts';
import {contractTemplateVersions as versions} from '../contract-template-schema.ts';
import manifest from '../domain/contract-template-manifest.json' with {type:'json'};

type Db=StaffEnv['db']|Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
type Brand=keyof typeof manifest;
export async function contractTemplateSnapshot(db:Db,entity:string){
 const brand:Brand=entity==='VG'?'VG':'BN';
 const [row]=await db.select().from(versions).where(eq(versions.brand,brand)).orderBy(desc(versions.revision)).limit(1);
 return {brand,revision:row?.revision??0,sourceHash:row?.sourceHash??manifest[brand].sourceHash,edits:row?cleanWordEdits(JSON.parse(row.edits)):[]};
}
export function registerContractTemplateRoutes(router:Router<StaffEnv>){
 const manager=(c:RouteContext<StaffEnv>)=>{const me=(c.state.session as SessionState).member;if(me.role!=='manager')throw new AppError(403,'Chỉ Manager được xem và chỉnh sửa mẫu HĐKT gốc.');return me;};
 const brandOf=(c:RouteContext<StaffEnv>):Brand=>{if(c.params.brand!=='BN'&&c.params.brand!=='VG')throw new AppError(400,'Mẫu HĐKT không hợp lệ.');return c.params.brand;};
 router.get('/contract-templates/:brand',async c=>{
  manager(c);const brand=brandOf(c),snapshot=await contractTemplateSnapshot(c.env.db,brand);
  if(snapshot.sourceHash!==manifest[brand].sourceHash)throw new AppError(409,'File mẫu gốc đã đổi. Cần chuyển phiên bản mẫu trước khi chỉnh sửa.');
  return json({...snapshot,locked:manifest[brand].paragraphs.filter(p=>p.locked).map(p=>p.index)});
 },'business');
 router.put('/contract-templates/:brand',async c=>{
  const me=manager(c),brand=brandOf(c),body=await readJson(c.req,600000),base=manifest[brand];
  if(!Number.isSafeInteger(body.revision)||Number(body.revision)<0||body.sourceHash!==base.sourceHash)throw new AppError(409,'Mẫu gốc đã thay đổi. Mở lại mẫu trước khi lưu.');
  // Paragraph hashes are client serialization details. The immutable source digest + index
  // identify the paragraph; the client rebinds each edit to its actual XML hash before applying.
  const edits=cleanWordEdits(body.edits).map(edit=>({...edit,hash:'0'.repeat(64)}));
  for(const edit of edits){
   const paragraph=base.paragraphs.find(p=>p.index===edit.index);
   if(!paragraph||paragraph.locked)throw new AppError(400,'Không được sửa trường tự điền hoặc đoạn không thuộc mẫu gốc.');
   if([edit.text,...(edit.runs||[]).map(run=>run.text)].some(text=>/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF\uD800-\uDFFF]/u.test(text)))throw new AppError(400,'Nội dung mẫu có ký tự không hợp lệ trong Word.');
   if(/<<|>>/.test(edit.text))throw new AppError(400,'Không thêm trường tự điền vào nội dung mẫu.');
  }
  const result=await c.env.db.transaction(async tx=>{
   const current=await contractTemplateSnapshot(tx,brand);
   if(current.revision!==body.revision||current.sourceHash!==body.sourceHash)throw new AppError(409,'Manager khác đã sửa mẫu. Mở lại mẫu trước khi lưu.');
   const revision=current.revision+1;
   const inserted=await tx.insert(versions).values({brand,revision,sourceHash:base.sourceHash,edits:JSON.stringify(edits),createdBy:me.id,createdAt:new Date().toISOString()}).onConflictDoNothing().returning({revision:versions.revision});
   if(!inserted.length)throw new AppError(409,'Manager khác vừa lưu mẫu. Mở lại mẫu trước khi lưu.');
   return {brand,revision,sourceHash:base.sourceHash,edits};
  });
  return json(result);
 },'business');
}
