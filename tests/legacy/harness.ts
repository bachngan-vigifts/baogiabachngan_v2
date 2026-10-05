/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Chạy CHÍNH code bản cũ (lib/product-catalog.mjs) trên kho R2 giả để đối chiếu với bản mới.
 * Cần repo cũ đã `npm ci`: đặt biến môi trường LEGACY_REPO=/đường/dẫn, hoặc để thư mục `bach-ngan-bao-gia` nằm cạnh dự án này.
 * Không có repo cũ → các test đối chiếu tự bỏ qua (không làm hỏng CI).
 */
const CANDIDATES = [process.env.LEGACY_REPO, join(import.meta.dirname, '..', '..', '..', 'bach-ngan-bao-gia')].filter(Boolean) as string[];
export const LEGACY_DIR = CANDIDATES.find(d => existsSync(join(d, 'lib/product-catalog.mjs')) && existsSync(join(d, 'node_modules')));
export const legacyAvailable = Boolean(LEGACY_DIR);
export const skipReason = legacyAvailable ? false : 'không tìm thấy repo cũ (đặt LEGACY_REPO=/đường/dẫn và chạy npm ci ở đó)';

export async function loadLegacy(): Promise<Record<string, (...a: any[]) => Promise<any>>> {
  return await import(pathToFileURL(join(LEGACY_DIR!, 'lib/product-catalog.mjs')).href);
}

export class FakeBucket {
  store = new Map<string, { data: any; etag: string }>();
  private n = 0;
  async get(k: string) {
    const v = this.store.get(k); if (!v) return null;
    return { etag: v.etag, body: v.data, json: async () => JSON.parse(typeof v.data === 'string' ? v.data : new TextDecoder().decode(v.data)), text: async () => String(v.data), arrayBuffer: async () => v.data };
  }
  async put(k: string, data: any, opts: any = {}) {
    const cur = this.store.get(k);
    if (opts.onlyIf?.etagMatches && (!cur || cur.etag !== opts.onlyIf.etagMatches)) return null;
    if (opts.onlyIf?.etagDoesNotMatch === '*' && cur) return null;
    this.store.set(k, { data, etag: String(++this.n) }); return { etag: String(this.n) };
  }
  async delete(k: string) { this.store.delete(k); }
  async list() { return { objects: [], truncated: false }; }
  index(): any { return JSON.parse(this.store.get('incoming-stock/index.json')!.data); }
  shipment(): any { return this.index().shipments[0]; }
}

export const ID = '11111111-1111-1111-1111-111111111111';
export const DETAIL_KEY = 'incoming-stock/detail.json';
export const T0 = '2026-10-02T00:00:00.000Z';

export interface Scenario {
  source: string; approvalStatus: string; supplierKey: 'S1' | 'S2';
  confirmed: boolean; sigUploaded: boolean; sigDownloaded: boolean;
  depositRequested: boolean; depositPaid: boolean; deliveryReady: boolean; received: boolean;
}
export const baseScenario: Scenario = { source: 'supplier-order', approvalStatus: 'approved', supplierKey: 'S1', confirmed: false, sigUploaded: true, sigDownloaded: false, depositRequested: false, depositPaid: false, deliveryReady: false, received: false };

export const EMAIL: Record<string, string> = { S1: 's1@x.vn', S2: 's2@x.vn' };
export const STOCK_ROWS = [{ sku: 'A1', quantity: 10 }, { sku: 'B2', quantity: 5 }];
export const DETAIL_ROWS = [
  { sku: 'A1', name: 'Nồi', unit: 'cái', quantity: 10, price: 100000, taxRate: 8, printFee: 2000 },
  { sku: 'B2', name: 'Chảo', unit: 'cái', quantity: 5, price: 200000, taxRate: 10, printFee: 0 },
];

export function buildShipment(sc: Scenario, extra: Record<string, unknown> = {}): any {
  return {
    id: ID, key: DETAIL_KEY, ticketNumber: 'T1', source: sc.source, approvalStatus: sc.approvalStatus, warehouse: 'KHO', arrivalDate: '2026-10-20',
    supplierName: 'NCC ' + sc.supplierKey, supplierEmail: EMAIL[sc.supplierKey], quoteNumber: 'BG1', createdBy: 'm1', createdAt: '2026-10-01T00:00:00.000Z', depositRate: 30,
    itemDiscounts: [{ sku: 'A1', purchaseDiscount: 25 }, { sku: 'B2', purchaseDiscount: 10 }], stockRows: STOCK_ROWS.map(r => ({ ...r })),
    supplierStatus: sc.confirmed ? 'confirmed' : 'pending',
    ...(sc.confirmed ? { supplierConfirmedAt: T0 } : {}),
    ...(sc.sigUploaded ? { supplierSignatureUploadedAt: T0, supplierSignatureFile: { key: 'supplier-signatures/x.png', name: 'k.png', type: 'image/png', size: 5 } } : {}),
    ...(sc.sigDownloaded ? { supplierSignatureDownloadedAt: T0 } : {}),
    ...(sc.depositRequested ? { depositRequestedAt: T0 } : {}),
    ...(sc.depositPaid ? { depositPaidAt: T0, paidAmount: 100, depositPaidAmount: 100 } : {}),
    ...(sc.deliveryReady ? { supplierDeliveryReadyAt: T0, supplierDeliveryReadyMode: 'full', supplierDeliveryReadyDate: '2026-10-30', supplierDeliveryReadyRows: STOCK_ROWS } : {}),
    ...(sc.received ? { receivedAt: T0, receivedWarehouse: 'KHO' } : {}),
    ...extra,
  };
}

export function bucketWith(shipments: any[], detailRows: any[] = DETAIL_ROWS): FakeBucket {
  const b = new FakeBucket();
  b.store.set('incoming-stock/index.json', { data: JSON.stringify({ shipments }), etag: 'e0' });
  b.store.set(DETAIL_KEY, { data: JSON.stringify({ rows: detailRows }), etag: 'e1' });
  b.store.set('supplier-signatures/x.png', { data: new Uint8Array([1, 2, 3]), etag: 'e2' });
  return b;
}

export const members = {
  manager: { id: 'm1', role: 'manager', email: 'mgr@x.vn', name: 'Manager' },
  employee: { id: 'e1', role: 'employee', email: 'e@x.vn', name: 'NV' },
  supplier1: { id: 'n1', role: 'supplier', email: EMAIL.S1, name: 'NCC1' },
  supplier2: { id: 'n2', role: 'supplier', email: EMAIL.S2, name: 'NCC2' },
};
/** Cùng bốn người nhìn từ phía bản mới (NCC gắn với nhà cung cấp bằng supplierId thay vì so email). */
export const actors = {
  manager: { id: 'm1', role: 'manager' as const, active: true, positionId: 'manager', supplierId: null },
  employee: { id: 'e1', role: 'employee' as const, active: true, positionId: 'sale', supplierId: null },
  supplier1: { id: 'n1', role: 'supplier' as const, active: true, positionId: 'supplier', supplierId: 'S1' },
  supplier2: { id: 'n2', role: 'supplier' as const, active: true, positionId: 'supplier', supplierId: 'S2' },
};

export async function attempt(fn: () => Promise<any>): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  try { await fn(); return { ok: true }; } catch (e: any) { return { ok: false, status: e.status, message: e.message }; }
}

export function rng(seed: number) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export const picker = (r: () => number) => <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

/** Tải `staffApi` bản cũ (cần repo cũ đã `npm ci`). */
export async function loadLegacyStaffApi(): Promise<(req: Request, env: unknown) => Promise<Response>> {
  const m = await import(pathToFileURL(join(LEGACY_DIR!, 'lib/staff-api.mjs')).href);
  return m.staffApi;
}
export const legacyMigrationsDir = () => join(LEGACY_DIR!, 'drizzle');
