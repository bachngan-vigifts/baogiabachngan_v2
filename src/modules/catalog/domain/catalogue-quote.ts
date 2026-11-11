import { z } from 'zod';
import { AppError } from '../../../core/errors.ts';
import { cleanCatalogueProduct } from './catalogue-data.ts';
const quoteProduct=z.object({crmSku:z.string().max(100).optional(),id:z.string().min(1).max(80),discount:z.number().finite().min(0).max(100),fee:z.number().finite().min(0).max(1e8),qty:z.number().int().min(1).max(1e6),override:z.number().finite().min(0).max(1e10).nullable(),sharedId:z.string().max(80).optional(),sharedRevision:z.number().int().positive().nullable().optional()});
const settings=z.object({productsPerPage:z.union([z.literal(4),z.literal(6),z.literal(8)]).default(4),lockDiscount:z.number().finite().min(0).max(100),minhDiscount:z.number().finite().min(0).max(100),fee:z.number().finite().min(0).max(1e8),cover:z.boolean(),dividers:z.boolean(),closing:z.boolean(),qr:z.boolean(),regular:z.boolean(),proposedPrice:z.boolean().default(true),sortPrice:z.boolean(),selectionSort:z.enum(['manual','newest','price','collection','category','pattern','color']).optional(),bundle10:z.boolean(),bundle10Ids:z.array(z.string().max(80)).max(1000)});
export function stableJson(value:unknown):string{if(Array.isArray(value))return'['+value.map(stableJson).join(',')+']';if(value&&typeof value==='object')return'{'+Object.keys(value).sort().filter(k=>(value as Record<string,unknown>)[k]!==undefined).map(k=>JSON.stringify(k)+':'+stableJson((value as Record<string,unknown>)[k])).join(',')+'}';return JSON.stringify(value);}
export function cleanCatalogueQuote(raw:unknown){
 if(!raw||typeof raw!=='object')throw new AppError(400,'Thiếu nội dung báo giá.');const b=raw as Record<string,unknown>;
 if(b.version!==1||!Array.isArray(b.products)||b.products.length>1000||!Array.isArray(b.selected)||!b.selected.length||b.selected.length>1000)throw new AppError(400,'Báo giá phải có từ 1 đến 1.000 sản phẩm.');
 const selected=[...new Set(b.selected)];if(selected.some(id=>typeof id!=='string'||id.length>80))throw new AppError(400,'Mã sản phẩm trong báo giá không hợp lệ.');
 const chosen=b.products.filter((p:unknown)=>p&&typeof p==='object'&&selected.includes((p as Record<string,unknown>).id));if(chosen.length!==selected.length)throw new AppError(400,'Danh sách sản phẩm đã chọn không khớp.');
 const products=chosen.map((p:unknown)=>{const data=quoteProduct.safeParse(p);if(!data.success)throw new AppError(400,'Kiểm tra số lượng, chiết khấu và giá chào sản phẩm.');return{...cleanCatalogueProduct(p),...data.data};});if(new Set(products.map(p=>p.id)).size!==products.length)throw new AppError(400,'Trùng mã dữ liệu sản phẩm.');
 const inputMeta=b.meta as Record<string,unknown>|undefined,meta:Record<string,string>={};for(const key of ['title','customer','quoteNo','employee','phone','date','note']){if(typeof inputMeta?.[key]!=='string'||inputMeta[key].length>500)throw new AppError(400,'Thông tin báo giá chưa hợp lệ.');meta[key]=inputMeta[key] as string;}if(!meta.quoteNo?.trim())throw new AppError(400,'Nhập mã báo giá.');
 if(inputMeta&&Object.hasOwn(inputMeta,'customerId')){if(typeof inputMeta.customerId!=='string'||inputMeta.customerId.length>200)throw new AppError(400,'Mã khách hàng chưa hợp lệ.');meta.customerId=inputMeta.customerId.trim();}
 if(inputMeta&&Object.hasOwn(inputMeta,'customerGroup')){if(typeof inputMeta.customerGroup!=='string'||inputMeta.customerGroup.length>200)throw new AppError(400,'Nhóm khách hàng chưa hợp lệ.');meta.customerGroup=inputMeta.customerGroup.trim();}
 const config=settings.safeParse(b.settings);if(!config.success)throw new AppError(400,'Thiết lập báo giá chưa hợp lệ.');config.data.bundle10Ids=config.data.bundle10Ids.filter(id=>selected.includes(id));
 const pageText:Record<string,Record<string,string>>={};if(b.pageText&&typeof b.pageText==='object')for(const [key,fields]of Object.entries(b.pageText).slice(0,1000)){if(key.length>500||!['cover','closing'].includes(key)&&!/^divider:\d+$/.test(key)&&!key.startsWith('products:')||!fields||typeof fields!=='object')continue;const values:Record<string,string>={};for(const [position,value]of Object.entries(fields).slice(0,100))if(/^\d+:\d+$/.test(position)&&typeof value==='string'&&value.length<=2000)values[position]=value;pageText[key]=values;}
 const customBrands=Array.isArray(b.customBrands)?b.customBrands.slice(0,30).filter(p=>p&&typeof p==='object').map(p=>{const clean:Record<string,unknown>={};for(const key of ['id','name','origin','sourceUrl','collectionUrl','categoryLabel','platform','currency'])if(typeof p[key]==='string'&&p[key].length<=2500)clean[key]=p[key];for(const key of ['discount','fee'])if(typeof p[key]==='number'&&Number.isFinite(p[key]))clean[key]=p[key];clean.includeContact=p.includeContact===true;return clean;}):[];
 return{version:1,products,selected:selected as string[],meta,settings:config.data,pageText,customBrands};
}





