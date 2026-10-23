import { AppError } from '../../../core/errors.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';

export const LOCK_GHN_SHOP_ID = '6096731';
const GHN_SHOPS = 'https://online-gateway.ghn.vn/shiip/public-api/v2/shop/all';
const mlShopCache = new Map<string, string>();

export type PosGhnAccount = { kind: 'lock' | 'minh-long'; token: string; shopId: string };

export const posGhnKind = (registerName: unknown): PosGhnAccount['kind'] | null => {
  const name = String(registerName ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/lock/.test(name)) return 'lock';
  if (/minh\s*long|gom\s*su/.test(name)) return 'minh-long';
  return null;
};

async function minhLongShopId(env: StaffEnv): Promise<string> {
  const token = env.ghnMlToken || '';
  if (!token) throw new AppError(503, 'CRM chưa có token GHN Minh Long (secret GHN_ML_API_TOKEN).', 'GHN_ML_NOT_CONFIGURED');
  const cached = mlShopCache.get(token); if (cached) return cached;
  const response = await (env.ghnFetch ?? fetch)(GHN_SHOPS, { headers: { Token: token } });
  const raw = await response.text(); let body: Record<string, unknown> = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { /* GHN có thể trả text khi lỗi. */ }
  const data = body.data && typeof body.data === 'object' ? body.data as Record<string, unknown> : {};
  const shops = Array.isArray(data.shops) ? data.shops as Record<string, unknown>[] : Array.isArray(body.data) ? body.data as Record<string, unknown>[] : [];
  const active = shops.filter(x => !/inactive|deleted/i.test(String(x.status ?? '')));
  if (!response.ok || active.length !== 1) throw new AppError(503, active.length > 1
    ? 'Token GHN Minh Long có nhiều shop; cần cấu hình GHN_ML_SHOP_ID.'
    : 'Không lấy được ShopId từ token GHN Minh Long.', 'GHN_ML_SHOP_NOT_FOUND');
  const shopId = String(active[0]!.id ?? active[0]!.shop_id ?? '').trim();
  if (!/^\d+$/.test(shopId)) throw new AppError(503, 'ShopId GHN Minh Long không hợp lệ.', 'GHN_ML_SHOP_NOT_FOUND');
  mlShopCache.set(token, shopId); return shopId;
}

export async function posGhnAccount(env: StaffEnv, registerName: unknown): Promise<PosGhnAccount | null> {
  const kind = posGhnKind(registerName);
  if (kind === 'lock') {
    if (!env.ghnToken) throw new AppError(503, 'CRM chưa có token GHN Lock (secret GHN_API_TOKEN).', 'GHN_NOT_CONFIGURED');
    return { kind, token: env.ghnToken, shopId: LOCK_GHN_SHOP_ID };
  }
  if (kind === 'minh-long') return { kind, token: env.ghnMlToken || '', shopId: env.ghnMlShopId || await minhLongShopId(env) };
  return null;
}

export const resetGhnAccountCache = () => mlShopCache.clear();
