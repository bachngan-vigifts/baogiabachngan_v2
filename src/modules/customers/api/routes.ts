import { asc, eq } from 'drizzle-orm';
import type { Router } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { customers } from '../schema.ts';

export function registerCustomerRoutes(router: Router<StaffEnv>) {
  router.get('/customers', async c => {
    const raw = Number(new URL(c.req.url).searchParams.get('offset') || 0);
    const offset = Number.isSafeInteger(raw) && raw >= 0 ? raw : 0;
    const rows = await c.env.db.select().from(customers).orderBy(asc(customers.name),asc(customers.id)).offset(offset).limit(200);
    return json({customers:rows,nextOffset:rows.length===200?offset+200:null});
  }, 'business');
  const save = async (c: Parameters<Parameters<Router<StaffEnv>['post']>[1]>[0], update: boolean) => {
    const body = await readJson(c.req, 16_384);
    const text = (key: string, max = 500) => {
      const v = body[key] ?? '';
      if (typeof v !== 'string' || v.length > max) throw new AppError(400, 'Thông tin khách hàng không hợp lệ.');
      return v.trim();
    };
    const name = text('name'); if (!name) throw new AppError(400, 'Vui lòng nhập tên khách hàng.');
    const now = new Date().toISOString(), id = update ? c.params.id! : crypto.randomUUID();
    const row = { name, contact: text('contact'), phone: text('phone', 40), email: text('email'), address: text('address', 2000), taxCode: text('taxCode'), customerCode: text('customerCode'), search: name.toLowerCase(), sourceVersion: 0, syncedAt: now };
    if (update) {
      if (!(await c.env.db.update(customers).set(row).where(eq(customers.id, id)).returning({ id: customers.id })).length) throw new AppError(404, 'Không tìm thấy khách hàng.');
    } else await c.env.db.insert(customers).values({ id, createdAt: now, ...row });
    return json({ id }, update ? 200 : 201);
  };
  router.post('/customers', c => save(c, false), 'business');
  router.put('/customers/:id', c => save(c, true), 'business');
}
