import { asc } from 'drizzle-orm';
import type { Router } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { printingWorkshops as DEFAULT_WORKSHOPS } from '../../quotes/domain/quote-math.ts';
import { printingWorkshops } from '../schema.ts';

/** Khoá so trùng tên xưởng (như `key` trong lib/printing-workshops.mjs bản cũ). */
const nameKey = (name: string) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
const FIELDS = { name: 180, taxCode: 40, address: 1000, phone: 40, email: 254 } as const;

/** Xưởng in dùng chung cho mục "Phí in gia công" trong lợi nhuận tạm tính – chỉ Manager (khu vực 'admin'). */
export function registerPrintingRoutes(router: Router<StaffEnv>) {
  router.get('/printing-workshops', async c => {
    const rows = await c.env.db.select({ id: printingWorkshops.id, name: printingWorkshops.name, taxCode: printingWorkshops.taxCode, address: printingWorkshops.address, phone: printingWorkshops.phone, email: printingWorkshops.email })
      .from(printingWorkshops).orderBy(asc(printingWorkshops.createdAt), asc(printingWorkshops.name));
    return json({ workshops: [...DEFAULT_WORKSHOPS.map((name, i) => ({ id: `default-${i}`, name, taxCode: '', address: '', phone: '', email: '' })), ...rows] });
  }, 'admin');

  router.post('/printing-workshops', async c => {
    const body = await readJson(c.req, 8_192);
    const clean = {} as Record<keyof typeof FIELDS, string>;
    for (const [field, max] of Object.entries(FIELDS) as [keyof typeof FIELDS, number][]) {
      const v = body?.[field] ?? '';
      if (typeof v !== 'string' || v.length > max) throw new AppError(400, 'Thông tin xưởng in không hợp lệ.');
      clean[field] = v.trim();
    }
    if (!clean.name) throw new AppError(400, 'Vui lòng nhập tên xưởng.');
    if (clean.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) throw new AppError(400, 'Email xưởng không hợp lệ.');
    const key = nameKey(clean.name);
    if (DEFAULT_WORKSHOPS.some(n => nameKey(n) === key)) throw new AppError(409, 'Xưởng này đã có trong danh sách.');
    const id = crypto.randomUUID(), member = (c.state.session as SessionState).member;
    const inserted = await c.env.db.insert(printingWorkshops).values({ id, ...clean, nameKey: key, createdAt: new Date().toISOString(), createdBy: member.id })
      .onConflictDoNothing({ target: printingWorkshops.nameKey }).returning({ id: printingWorkshops.id });
    if (!inserted.length) throw new AppError(409, 'Xưởng này đã có trong danh sách.');
    return json({ ok: true, workshop: { id, ...clean } }, 201);
  }, 'admin');
}
