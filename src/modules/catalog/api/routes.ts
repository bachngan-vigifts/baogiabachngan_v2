import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Router } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { products, productPrices, pricePolicies, warehouses, productStock } from '../schema.ts';

const amount = z.number().finite().min(0).max(1e12).nullable();
const catalog = z.object({
  format: z.literal('sapo-catalog-v1'),
  warehouses: z.array(z.string().trim().min(1).max(200)).max(30),
  pricePolicies: z.array(z.string().trim().min(1).max(200)).max(30),
  products: z.array(z.object({
    sku: z.string().trim().min(1).max(500), name: z.string().trim().min(1).max(2000),
    brand: z.string().max(4000).default(''), pattern: z.string().max(4000).default(''),
    unit: z.string().max(4000).default(''), image: z.string().max(4000).default(''),
    taxBasis: z.string().max(4000).default(''), taxable: z.boolean().default(false),
    taxIn: z.number().min(0).max(100).nullable().default(null),
    taxOut: z.number().min(0).max(100).nullable().default(null),
    prices: z.array(amount), stock: z.array(z.number().finite().min(-1e12).max(1e12).nullable()),
  })).min(1).max(50000),
}).superRefine((data, ctx) => {
  if (new Set(data.products.map(p => p.sku)).size !== data.products.length ||
      new Set(data.warehouses).size !== data.warehouses.length ||
      new Set(data.pricePolicies).size !== data.pricePolicies.length ||
      data.products.some(p => p.prices.length !== data.pricePolicies.length || p.stock.length !== data.warehouses.length))
    ctx.addIssue({ code: 'custom', message: 'Mã sản phẩm trùng hoặc số cột giá/tồn kho không khớp.' });
});

export function registerCatalogRoutes(router: Router<StaffEnv>) {
  router.get('/products', async c => {
    const url = new URL(c.req.url), search = (url.searchParams.get('q') || '').trim().slice(0,200);
    const pattern = '%' + search.replace(/[\\%_]/g, '\\$&') + '%';
    const rows = await c.env.db.select().from(products).where(and(eq(products.active,true), search ? or(ilike(products.name,pattern),ilike(products.sku,pattern)) : undefined)).orderBy(asc(products.name)).limit(50);
    const policies = await c.env.db.select().from(pricePolicies).orderBy(asc(pricePolicies.sortOrder));
    const skuList = rows.map(p => p.sku);
    const prices = skuList.length ? await c.env.db.select().from(productPrices).where(sql`${productPrices.sku} in (${sql.join(skuList.map(sku=>sql`${sku}`),sql`,`)})`) : [];
    return json({ products: rows.map(p=>({...p, prices: prices.filter(v=>v.sku===p.sku).map(v=>({policyId:v.policyId,price:v.price}))})), pricePolicies:policies });
  }, 'business');
  router.post('/admin/catalog-import', async c => {
    const parsed = catalog.safeParse(await readJson(c.req,20_000_000));
    if (!parsed.success) throw new AppError(400,'File danh mục không hợp lệ. Chọn JSON danh mục từ web báo giá cũ.');
    const data = parsed.data, now = new Date().toISOString();
    await c.env.db.transaction(async tx => {
      const policyIds: string[] = [], warehouseIds: string[] = [];
      for (const [i,name] of data.pricePolicies.entries()) {
        const [p] = await tx.insert(pricePolicies).values({id:'legacy:'+name,name,sortOrder:i}).onConflictDoUpdate({target:pricePolicies.name,set:{name}}).returning();
        policyIds.push(p!.id);
      }
      for (const [i,name] of data.warehouses.entries()) {
        const [w] = await tx.insert(warehouses).values({id:'legacy:'+name,name,sortOrder:i,kind:name==='NCC'?'supplier':name==='Hàng chờ về'?'incoming':'stock'}).onConflictDoUpdate({target:warehouses.name,set:{name}}).returning();
        warehouseIds.push(w!.id);
      }
      for (const p of data.products) {
        const row = {sku:p.sku,name:p.name,brand:p.brand,pattern:p.pattern,unit:p.unit,imageUrl:p.image,taxBasis:p.taxBasis,taxIn:p.taxIn,taxOut:p.taxOut,taxable:p.taxable,updatedAt:now};
        await tx.insert(products).values(row).onConflictDoNothing();
        if (policyIds.length) await tx.insert(productPrices).values(policyIds.map((policyId,i)=>({sku:p.sku,policyId,price:p.prices[i]!}))).onConflictDoNothing();
        const stockRows = warehouseIds.flatMap((warehouseId,i)=>p.stock[i]===null?[]:[{sku:p.sku,warehouseId,quantity:p.stock[i]!,updatedAt:now}]);
        if (stockRows.length) await tx.insert(productStock).values(stockRows).onConflictDoNothing();
      }
    });
    return json({count:data.products.length,message:'Đã nhập danh mục. Dữ liệu đã có được giữ nguyên.'});
  }, 'admin');
}
