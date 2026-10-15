import { SELLERS } from './order-print.js';
export const SUPPLIER_TEMPLATES = [['pdf', 'PDF đơn đặt hàng'], ['minh-long', 'Excel Minh Long – đơn thường'], ['minh-long-logo', 'Excel Minh Long – in logo'], ['lock', 'Excel Lock']];
export const exportDate = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
export function suggestedSupplierTemplate(v) {
  const name = String(v.supplier?.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/lock/.test(name)) return 'lock';
  if (/minh\s*long/.test(name)) return v.lines?.some(l => l.printDescription || Number(l.printFee) > 0) ? 'minh-long-logo' : 'minh-long';
  return 'pdf';
}
/** Read the authorized purchase snapshot; catalog metadata never overrides its prices/quantities. */
export function purchaseExportData(v, options = {}) {
  if (v.priceHidden || !v.totals || !v.actions?.includes('pdf')) throw Error('Chỉ người có quyền xem giá mua được xuất đơn gửi NCC.');
  if (!Array.isArray(v.lines) || !v.lines.length) throw Error('Đơn mua chưa có dòng hàng.');
  const entity = SELLERS[options.entity] || SELLERS.BN;
  const by = action => v.events?.find(e => e.action === action)?.by || '';
  const lineOptions = options.lines || {};
  const lines = v.lines.map(l => {
    if (l.price == null || !Number.isFinite(Number(l.price)) || l.lineTotal == null || !Number.isFinite(Number(l.lineTotal))) throw Error(`Mã ${l.sku} chưa có giá mua hợp lệ.`);
    const extra = lineOptions[l.id || l.sku] || {}, quantity = number(l.quantity), subtotal = number(l.lineTotal), taxRate = number(l.taxRate);
    if (!(quantity > 0)) throw Error(`Mã ${l.sku} chưa có số lượng hợp lệ.`);
    const price = number(l.price), discount = number(l.purchaseDiscount), afterDiscount = price * (1 - discount / 100);
    return { sku: String(l.sku || ''), name: String(l.name || ''), unit: String(l.unit || ''), quantity, price, discount,
      printFee: l.printFee == null ? Math.max(0, subtotal / quantity - afterDiscount) : number(l.printFee), taxRate, subtotal, vat: subtotal * taxRate / 100,
      total: subtotal * (1 + taxRate / 100), promisedDate: exportDate(l.promisedDate || options.arrivalDate || v.arrivalDate),
      note: l.supplierNote || '', printDescription: l.printDescription || '', erp: extra.erp || '', collection: extra.collection || '', pattern: extra.pattern || '',
      quality: extra.quality || '', perCarton: number(extra.perCarton) || '', weight: extra.weight === '' || extra.weight == null ? '' : number(extra.weight) };
  });
  return { ticketNumber: String(v.ticketNumber || ''), internalNo: v.internalNo || '', supplier: v.supplier || {}, buyer: entity,
    contact: options.contact ?? by('create'), phone: options.phone || '', address: options.address ?? v.warehouse ?? '',
    orderDate: exportDate(v.approvedAt || v.createdAt), arrivalDate: exportDate(options.arrivalDate ?? v.arrivalDate), note: options.note ?? v.note ?? '',
    approver: options.approver ?? by('approve'), logoCustomer: options.logoCustomer ?? [...new Set(v.lines.flatMap(l => l.sources || []).map(s => s.customerName).filter(Boolean))].join(' · '),
    logoContent: options.logoContent ?? [...new Set(lines.map(l => l.printDescription).filter(Boolean))].join('\n'),
    supplierContact: options.supplierContact || '', supplierEmail: options.supplierEmail ?? v.supplierEmail ?? v.supplier?.email ?? '',
    supplierBranch: options.supplierBranch || '', supplierPhone: options.supplierPhone ?? v.supplier?.phone ?? '',
    sampleDate: exportDate(options.sampleDate),
    payment: options.payment ?? (v.schedules || []).map(s => `${s.kind === 'deposit' ? 'Đặt cọc' : 'Thanh toán'}: ${number(s.amount).toLocaleString('vi-VN')} đ${s.dueDate ? ' – hạn ' + exportDate(s.dueDate) : ''}`).join('\n'),
    deposit: (v.schedules || []).filter(s => s.kind === 'deposit').reduce((t, s) => t + number(s.amount), 0),
    totals: { subtotal: number(v.totals.subtotal), vat: number(v.totals.vat), total: number(v.totals.total) }, lines };
}
