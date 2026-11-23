import {supplierScope} from './purchase-store.ts';
import type {SessionState} from '../../staff/api/auth-routes.ts';
import {and,asc,eq,inArray,sql} from 'drizzle-orm';
import {AppError} from '../../../core/errors.ts';
import {foldSql,matchAllWords} from '../../../core/text/fold.ts';
import {json,type Router,type RouteContext} from '../../../core/http/router.ts';
import type {StaffEnv} from '../../staff/api/auth-routes.ts';
import {suppliers,supplierContacts} from '../schema.ts';

/** Purchasing lookup, including contact names; does not grant supplier-directory editing access. */
export function registerPurchaseSupplierSearch(router:Router<StaffEnv>,guard:(c:RouteContext<StaffEnv>)=>void|Promise<void>){
 router.get('/purchase-options/suppliers',async c=>{
  await guard(c);const term=(c.url.searchParams.get('q')||'').trim().slice(0,200),offset=Number(c.url.searchParams.get('offset')||0),limit=12;
  if(!Number.isSafeInteger(offset)||offset<0||offset>10000)throw new AppError(400,'Trang tìm nhà cung cấp không hợp lệ.');
  const contactText=sql`coalesce((select string_agg(${foldSql(supplierContacts.name,supplierContacts.phone)},' ') from ${supplierContacts} where ${supplierContacts.supplierId}=${suppliers.id}),'')`;
  const searchText=sql`${foldSql(suppliers.name,suppliers.taxCode,suppliers.phone)} || ' ' || ${contactText}`;
  const rows=await c.env.db.select({id:suppliers.id,name:suppliers.name,taxCode:suppliers.taxCode,phone:suppliers.phone}).from(suppliers)
   .where(and(supplierScope((c.state.session as SessionState).member),eq(suppliers.active,true),matchAllWords(searchText,term))).orderBy(asc(suppliers.name),asc(suppliers.id)).limit(limit+1).offset(offset);
  const page=rows.slice(0,limit),contacts=page.length?await c.env.db.select({supplierId:supplierContacts.supplierId,name:supplierContacts.name,phone:supplierContacts.phone}).from(supplierContacts).where(inArray(supplierContacts.supplierId,page.map(r=>r.id))).orderBy(asc(supplierContacts.name)):[];
  return json({suppliers:page.map(row=>({...row,contacts:contacts.filter(ct=>ct.supplierId===row.id).map(({name,phone})=>({name,phone}))})),nextOffset:rows.length>limit?offset+limit:null,limit});
 },'business');
}
