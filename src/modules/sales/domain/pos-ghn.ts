import { AppError } from '../../../core/errors.ts';

/**
 * TẠO VẬN ĐƠN GHN cho đơn Ship COD ở quầy Lock (shop GHN 6096731) – phần thuần: đọc thông tin giao từ form, dựng body API GHN.
 * Phí ship thu khách nhập tay ở ô "Phí ship" của giỏ (0 = free ship) và đã nằm trong tiền COD → GHN luôn tính phí cho shop
 * (payment_type_id = 1), thu hộ đúng số "Còn lại thu khi giao". Mặc định cho khách xem hàng, không cho thử.
 */
export const GHN_REQUIRED_NOTES = {
  CHOXEMHANGKHONGTHU: 'Cho xem hàng, không cho thử',
  CHOTHUHANG: 'Cho thử hàng',
  KHONGCHOXEMHANG: 'Không cho xem hàng',
} as const;
export type GhnRequiredNote = keyof typeof GHN_REQUIRED_NOTES;
export const GHN_COD_MAX = 50_000_000;

export interface GhnShip {
  provinceId: number; districtId: number; wardCode: string;
  /** Gram. */ weight: number; length: number; width: number; height: number;
  requiredNote: GhnRequiredNote; note: string;
}

const int = (v: unknown, label: string, min: number, max: number, fallback?: number) => {
  if ((v === undefined || v === null || v === '') && fallback !== undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new AppError(400, `${label} phải là số nguyên từ ${min} đến ${max}.`);
  return n;
};

/** Thông tin GHN của chuyến giao COD (body.delivery). Thiếu quận / phường → null (đơn sẽ không tự tạo vận đơn được). */
export function parseGhnShip(input: Record<string, unknown>): GhnShip | null {
  const districtId = Number(input.ghnDistrictId), wardCode = String(input.ghnWardCode ?? '').trim().slice(0, 20);
  if (!Number.isInteger(districtId) || districtId <= 0 || !wardCode) return null;
  const requiredNote = String(input.ghnRequiredNote || 'CHOXEMHANGKHONGTHU') as GhnRequiredNote;
  if (!Object.hasOwn(GHN_REQUIRED_NOTES, requiredNote)) throw new AppError(400, 'Chọn cách cho khách xem hàng hợp lệ.');
  return {
    provinceId: Math.max(0, Number(input.ghnProvinceId) || 0), districtId, wardCode,
    weight: int(input.ghnWeight, 'Khối lượng (gram)', 1, 50_000, 500),
    length: int(input.ghnLength, 'Dài (cm)', 1, 200, 20), width: int(input.ghnWidth, 'Rộng (cm)', 1, 200, 20), height: int(input.ghnHeight, 'Cao (cm)', 1, 200, 10),
    requiredNote, note: String(input.ghnNote ?? '').trim().replace(/\s+/g, ' ').slice(0, 500),
  };
}

/** Số điện thoại người nhận theo chuẩn GHN (10 số bắt đầu bằng 0; +84 / 84 đổi về 0). */
export function ghnPhone(value: unknown): string {
  const digits = String(value ?? '').replace(/[^\d+]/g, '').replace(/^\+?84/, '0');
  if (!/^0\d{9}$/.test(digits)) throw new AppError(400, 'Số điện thoại người nhận không hợp lệ cho GHN (cần 10 số, bắt đầu bằng 0).');
  return digits;
}

export interface GhnCreateInput {
  orderNo: string; receiverName: string; receiverPhone: string; address: string; codAmount: number;
  ship: GhnShip; lines: readonly { sku: string; name: string; qty: number; unitPrice: number }[];
}
/** Body gọi `shipping-order/create` (GHN API v2). `client_order_code` = số đơn CRM để GHN chặn tạo trùng. */
export function ghnCreateBody(x: GhnCreateInput) {
  const cod = Math.round(x.codAmount);
  if (!Number.isSafeInteger(cod) || cod < 0 || cod > GHN_COD_MAX) throw new AppError(400, `Tiền thu hộ GHN phải từ 0 đến ${GHN_COD_MAX.toLocaleString('vi-VN')} đ.`);
  const name = x.receiverName.trim().slice(0, 100), address = x.address.trim().slice(0, 1000);
  if (!name) throw new AppError(400, 'Nhập tên người nhận.');
  if (!address) throw new AppError(400, 'Nhập địa chỉ giao.');
  return {
    payment_type_id: 1, // shop trả phí GHN; phí ship thu khách (nếu có) đã cộng trong tiền COD
    required_note: x.ship.requiredNote, note: x.ship.note, client_order_code: x.orderNo,
    to_name: name, to_phone: ghnPhone(x.receiverPhone), to_address: address,
    to_ward_code: x.ship.wardCode, to_district_id: x.ship.districtId,
    cod_amount: cod, content: x.lines.map(l => l.name).join(', ').slice(0, 2000),
    weight: x.ship.weight, length: x.ship.length, width: x.ship.width, height: x.ship.height,
    service_type_id: 2, insurance_value: 0,
    items: x.lines.map(l => ({ name: l.name.slice(0, 200), code: l.sku.slice(0, 100), quantity: Math.max(1, Math.ceil(l.qty)), price: Math.max(0, Math.round(l.unitPrice)) })),
  };
}
