import { AppError } from '../../../core/errors.ts';

/** Sale is a presentation profile of fee-capable B2B quotes; downstream document types stay unchanged. */
export function missingSaleDesign(doc: {template?: unknown; rows?: Record<string, any>[]}): boolean {
  return doc.template === 'sale' && (doc.rows || []).some(row => (!String(row.image || '').trim() && !row.designImageKey) || row.designImage !== true);
}
export function assertSaleTemplate(doc: { template?: unknown; type?: unknown; rows?: Record<string, any>[] }, requireDesign = true): void {
  if (doc.template !== 'sale') return;
  if (doc.type !== 'B2B') throw new AppError(400, 'Mẫu Sale phải dùng cách tính giá có phí in.');
  for (const [i, row] of (doc.rows || []).entries()) {
    if (requireDesign && ((!String(row.image || '').trim() && !row.designImageKey) || row.designImage !== true))
      throw new AppError(400, `Báo giá Sale: đính kèm ảnh thiết kế cho sản phẩm dòng ${i + 1}.`, 'SALE_DESIGN_REQUIRED');
    if (Number(row.discount || 0) !== 0)
      throw new AppError(400, `Báo giá Sale: nhập giá bán thực tế tại dòng ${i + 1}, không dùng chiết khấu ẩn.`);
  }
}
