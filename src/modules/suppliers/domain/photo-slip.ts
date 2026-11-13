import { z } from 'zod';

/** Giới hạn một phiếu đọc từ ảnh; trùng với giới hạn 300 dòng của phiếu xin hàng trước. */
export const PHOTO_SLIP_MAX_ROWS = 300;
const SKU = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,99}$/;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

/** JSON Schema gửi cho model: chỉ mã hàng, số lượng và số chứng từ. Không có đơn giá hay thành tiền. */
export const PHOTO_SLIP_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['readable', 'rows', 'statedTotalQuantity', 'pxkNo', 'orderNo', 'supplierOrderNo', 'orderReference'],
  properties: {
    readable: { type: 'boolean', description: 'false khi ảnh không phải phiếu hàng hoặc mờ tới mức không đọc được bảng.' },
    rows: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['sku', 'quantity', 'uncertain'],
        properties: {
          sku: { type: 'string', description: 'Mã hàng đúng như in trên phiếu, không thêm bớt ký tự.' },
          quantity: { type: 'integer', description: 'Số lượng giao/xin của dòng, số nguyên không có dấu phân cách nghìn. 0 khi không đọc được.' },
          uncertain: { type: 'boolean', description: 'true khi có ký tự của mã hoặc số lượng không chắc chắn.' },
        },
      },
    },
    statedTotalQuantity: { type: 'integer', description: 'Tổng số lượng in sẵn trên phiếu (ví dụ "Tổng SL giao"). 0 khi phiếu không in tổng.' },
    pxkNo: { type: 'string', description: 'Số phiếu xuất kho / phiếu giao hàng. Chuỗi rỗng khi không có.' },
    orderNo: { type: 'string', description: 'Số đơn mua của CRM (bắt đầu bằng DMH). Chuỗi rỗng khi không có.' },
    supplierOrderNo: { type: 'string', description: 'Số đơn của nhà cung cấp khi phiếu ghi rõ là đơn của NCC. Chuỗi rỗng khi không có.' },
    orderReference: { type: 'string', description: 'Số đơn hàng in trên phiếu khi không rõ là đơn CRM hay đơn NCC. Chuỗi rỗng khi không có.' },
  },
} as const;

const modelOutput = z.object({
  readable: z.boolean(),
  rows: z.array(z.object({ sku: z.string(), quantity: z.number(), uncertain: z.boolean() })),
  statedTotalQuantity: z.number(),
  pxkNo: z.string(), orderNo: z.string(), supplierOrderNo: z.string(), orderReference: z.string(),
});

export interface PhotoSlipRow { sku: string; quantity: string; uncertain: boolean }
export interface PhotoSlip {
  readable: boolean;
  rows: PhotoSlipRow[];
  document: { pxkNo: string; orderNo: string; supplierOrderNo: string; orderReference: string };
  /** Tổng in trên phiếu; null khi phiếu không in tổng. */
  statedTotal: number | null;
  /** Tổng các dòng đọc được; null khi có dòng thiếu số lượng. */
  rowTotal: number | null;
  totalCheck: 'match' | 'mismatch' | 'unknown';
}
export class PhotoSlipError extends Error {}

const reference = (value: string) => { const text = value.trim(); return REFERENCE.test(text) ? text : ''; };

/**
 * Kiểm và chuẩn hoá kết quả model trả về. Không sửa mã, không đoán số:
 * mã sai dạng hoặc số lượng không phải số nguyên dương thì để trống và đánh dấu cần kiểm.
 */
export function cleanPhotoSlip(raw: unknown): PhotoSlip {
  const parsed = modelOutput.safeParse(raw);
  if (!parsed.success) throw new PhotoSlipError('Kết quả đọc ảnh sai định dạng.');
  const data = parsed.data;
  if (data.rows.length > PHOTO_SLIP_MAX_ROWS) throw new PhotoSlipError(`Ảnh vượt ${PHOTO_SLIP_MAX_ROWS} dòng. Tách ảnh thành nhiều phiếu.`);
  const seen = new Set<string>();
  const rows = data.rows.map(row => {
    const code = row.sku.trim(), validSku = SKU.test(code), validQty = Number.isSafeInteger(row.quantity) && row.quantity > 0 && row.quantity <= 999_999_999;
    const duplicate = validSku && seen.has(code); if (validSku) seen.add(code);
    return { sku: validSku ? code : '', quantity: validQty ? String(row.quantity) : '', uncertain: row.uncertain || !validSku || !validQty || duplicate };
  }).filter(row => row.sku || row.quantity);
  const complete = rows.length > 0 && rows.every(row => row.quantity);
  const rowTotal = complete ? rows.reduce((sum, row) => sum + Number(row.quantity), 0) : null;
  const statedTotal = Number.isSafeInteger(data.statedTotalQuantity) && data.statedTotalQuantity > 0 ? data.statedTotalQuantity : null;
  return {
    readable: data.readable && rows.length > 0, rows,
    document: { pxkNo: reference(data.pxkNo), orderNo: reference(data.orderNo), supplierOrderNo: reference(data.supplierOrderNo), orderReference: reference(data.orderReference) },
    statedTotal, rowTotal,
    totalCheck: statedTotal === null || rowTotal === null ? 'unknown' : statedTotal === rowTotal ? 'match' : 'mismatch',
  };
}
