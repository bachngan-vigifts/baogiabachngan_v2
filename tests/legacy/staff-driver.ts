/* eslint-disable @typescript-eslint/no-explicit-any */
import { TestD1, createTestDb } from '../helpers/d1.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createStaffRouter, type StaffEnv } from '../../src/modules/staff/api/auth-routes.ts';
import { json } from '../../src/core/http/router.ts';
import { legacyMigrationsDir } from './harness.ts';

/** Hai "driver" cùng giao diện – một chạy `staffApi` bản cũ, một chạy router bản mới – trên DB đã nạp CÙNG dữ liệu mồi. */
export const O = 'https://staff.test';
export interface Call { method?: string; body?: unknown; raw?: string; cookie?: string; origin?: string | null; type?: string | null; ip?: string }
export interface Result { status: number; body: any; cookie: string | null }
export interface Driver { d1: TestD1; call(path: string, c?: Call): Promise<Result> }

export const req = (path: string, c: Call = {}) => {
  const method = c.method ?? (c.body !== undefined || c.raw !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = {};
  if (c.origin !== null) headers.origin = c.origin ?? O;
  if (c.type !== null && (c.body !== undefined || c.raw !== undefined)) headers['content-type'] = c.type ?? 'application/json';
  if (c.cookie) headers.cookie = c.cookie;
  if (c.ip) headers['cf-connecting-ip'] = c.ip;
  return new Request(O + '/api/staff' + path, { method, headers, body: c.raw ?? (c.body !== undefined ? JSON.stringify(c.body) : undefined) });
};
export const read = async (r: Response): Promise<Result> => ({ status: r.status, body: await r.json().catch(() => null), cookie: r.headers.get('set-cookie') });

export async function legacyDriver(staffApi: (req: Request, env: unknown) => Promise<Response>): Promise<Driver> {
  const d1 = new TestD1().migrate(legacyMigrationsDir());
  d1.exec("INSERT INTO staff_setup (id) VALUES ('initial-roster-v1')"); // bỏ qua bước nạp danh sách nhân viên ban đầu của bản cũ
  await seedStaff(d1);
  return { d1, call: async (p, c) => read(await staffApi(req(p, c), { DB: d1 })) };
}
export async function newDriver(): Promise<Driver> {
  const { d1, db } = createTestDb(); await seedStaff(d1);
  const router = createStaffRouter();
  router.get('/customers', () => json({ ok: true }), 'business'); // đại diện một route nghiệp vụ để so quyền NCC
  const env: StaffEnv = { db, passwordIterations: 1000 };
  return { d1, call: async (p, c) => read(await router.handle(req(p, c), env)) };
}

/** Che các giá trị ngẫu nhiên (token 64 hex, id nhân viên NV-uuid) để so được hai bản. */
export const maskRandom = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null).replace(/[a-f0-9]{64}/g, '<TOKEN>').replace(/NV-[0-9a-f-]{36}/g, 'NV-<ID>'));
export const cookieOf = (r: Result) => r.cookie?.split(';')[0] ?? '';
export const tokenFromUrl = (r: Result): string => /token=([a-f0-9]{64})/.exec(r.body?.url ?? '')?.[1] ?? '';
export const login = (d: Driver, email: string, password: any = PASSWORD, ip?: string) => d.call('/login', { body: { email, password }, ip });
