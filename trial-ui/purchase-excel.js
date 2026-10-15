import { purchaseExportData } from './purchase-export-data.js';
let ready;
const loadExcel = () => ready ||= new Promise((resolve, reject) => {
  if (globalThis.ExcelJS) return resolve(globalThis.ExcelJS);
  const s = document.createElement('script'); s.src = new URL('./exceljs.min.js', import.meta.url).href;
  s.onload = () => resolve(globalThis.ExcelJS); s.onerror = () => { ready = null; reject(Error('Không tải được công cụ Excel.')); }; document.head.append(s);
});
const copy = o => JSON.parse(JSON.stringify(o));
const money = '#,##0.00';
/** Layout/style descriptors are extracted from the three supplied workbooks, without sample orders/catalogs. */
export async function buildSupplierWorkbook(v, kind, { ExcelJS, templates }, options = {}) {
  if (!['lock', 'minh-long', 'minh-long-logo'].includes(kind)) throw Error('Chọn mẫu Excel Minh Long hoặc Lock.');
  const data = purchaseExportData(v, options), template = templates[kind];
  if (!template) throw Error('Không tải được mẫu Excel NCC.');
  const wb = new ExcelJS.Workbook(); wb.creator = data.buyer.name; wb.calcProperties.fullCalcOnLoad = true;
  function create(def) {
    const ws = wb.addWorksheet(def.name, { pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      horizontalCentered: true, margins: { left: .25, right: .25, top: .35, bottom: .35, header: .15, footer: .15 } } });
    def.columns.forEach(c => { ws.getColumn(c.index).width = c.width; });
    Object.entries(def.heights).forEach(([r, h]) => { if (Number(r) <= def.headerLast) ws.getRow(Number(r)).height = h; });
    for (const [ref, c] of Object.entries(def.cells)) {
      if (Number(ref.match(/\d+/)[0]) > def.headerLast) continue;
      const cell = ws.getCell(ref); cell.style = copy(def.styles[c.style]); if (c.value != null) cell.value = String(c.value);
    }
    def.merges.forEach(range => ws.mergeCells(range));
    ws.pageSetup.printTitlesRow = `1:${def.headerLast}`;
    return ws;
  }
  function put(ws, ref, value, fmt) { const c = ws.getCell(ref); c.value = value ?? ''; c.alignment = { ...c.alignment, wrapText: true, vertical: 'middle' }; if (fmt) c.numFmt = fmt; return c; }
  function line(ws, def, r, values) {
    const row = ws.getRow(r); row.height = Math.max(32, ...values.map((value, i) => typeof value === 'string' ? (Math.ceil(value.length / Math.max(8, ws.getColumn(i + 1).width - 2)) + value.split('\n').length - 1) * 14 + 8 : 0));
    values.forEach((value, i) => {
      const ref = ws.getColumn(i + 1).letter, model = def.cells[ref + def.prototypeRow];
      const cell = ws.getCell(ref + r); if (model) cell.style = copy(def.styles[model.style]);
      cell.value = value ?? ''; cell.alignment = { ...cell.alignment, wrapText: true, vertical: 'middle' };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      if (typeof value === 'string') cell.numFmt = '@'; else if (typeof value === 'number' || value?.formula) cell.numFmt = money;
      if (i === 0) cell.numFmt = '0';
    });
  }
  const formula = (expression, result) => ({ formula: expression, result });
  if (kind === 'minh-long') {
    const def = template.sheets[0], ws = create(def);
    [6, 18, 58, 22, 24, 12, 12, 34, 30].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    data.lines.forEach((l, i) => {
      line(ws, def, 2 + i, [i + 1, l.sku, l.name, l.collection, l.pattern, l.quality, l.quantity, data.supplier.name, `${l.promisedDate} · ${data.ticketNumber}`]);
    });
  } else if (kind === 'lock') {
    const def = template.sheets[0], ws = create(def);
    for (const [ref, value] of Object.entries({ A2: `SALES ORDER / ĐƠN ĐẶT HÀNG ${data.ticketNumber}`, A3: `Orderer (NV đặt hàng): ${data.contact}`,
      A4: `Customer (Khách hàng): ${data.buyer.name}`, A5: `Address Deliver (Địa chỉ giao): ${data.address}`, A6: `Contact Person (Liên hệ): ${data.contact} · ${data.phone}`,
      A7: `Order Date (Ngày đặt): ${data.orderDate}`, A8: `Request Delivery Date (Ngày giao): ${data.arrivalDate}`, A9: `Supplier (Nhà cung cấp): ${data.supplier.name}` })) put(ws, ref, value);
    ['A5:I5','A6:I6','A7:I7','A8:I8'].forEach(r => ws.mergeCells(r));
    data.lines.forEach((l, i) => { const r = 12 + i;
      line(ws, def, r, [i + 1, l.erp, l.sku, l.name, l.perCarton, l.quantity, l.price * (1 + l.taxRate / 100),
        formula(`(G${r}*(1-${l.discount}/100)+${l.printFee}*(1+${l.taxRate}/100))`, l.total / l.quantity), formula(`H${r}*F${r}`, l.total)]);
    });
    const end = 12 + data.lines.length; ws.mergeCells(`A${end}:E${end}`); put(ws, `A${end}`, 'G-Total (Tổng cộng)');
    put(ws, `F${end}`, formula(`SUM(F12:F${end - 1})`, data.lines.reduce((t, l) => t + l.quantity, 0)));
    put(ws, `I${end}`, formula(`SUM(I12:I${end - 1})`, data.totals.total), money);
    ws.mergeCells(`A${end + 1}:I${end + 1}`); put(ws, `A${end + 1}`, data.note); ws.getRow(end + 1).height = 40;
  } else {
    const def = template.sheets[0], ws = create(def);
    put(ws, 'A1', `TRIỂN KHAI MẪU · ${data.ticketNumber}`); ws.mergeCells('A1:G1');
    const values = { C2: data.supplierContact, E2: data.supplierBranch, C3: data.supplierEmail, E3: data.supplierPhone, C4: data.buyer.short,
      C5: data.logoCustomer, C6: data.orderDate, E6: data.sampleDate };
    Object.entries(values).forEach(([r, value]) => put(ws, r, value));
    data.lines.forEach((l, i) => line(ws, def, 9 + i, [i + 1, l.sku, l.name, l.collection, l.pattern, l.unit, l.quantity]));
    const end = 9 + data.lines.length;
    put(ws, `C${end}`, 'NGÀY Y/C:'); put(ws, `D${end}`, data.orderDate); put(ws, `G${end}`, data.sampleDate);
    ws.mergeCells(`A${end + 1}:B${end + 1}`); put(ws, `A${end + 1}`, 'NỘI DUNG IN LOGO');
    ws.mergeCells(`C${end + 1}:G${end + 1}`); put(ws, `C${end + 1}`, data.logoContent); ws.getRow(end + 1).height = 60;
    if (data.note) { ws.mergeCells(`A${end + 2}:G${end + 2}`); put(ws, `A${end + 2}`, 'GHI CHÚ: ' + data.note); ws.getRow(end + 2).height = 45; }
  }
  wb.eachSheet(ws => { ws.pageSetup.printArea = `A1:${ws.getColumn(template.sheets.find(s => s.name === ws.name).maxColumn).letter}${ws.rowCount}`; });
  return wb;
}
export async function downloadSupplierExcel(v, kind, options = {}) {
  const [ExcelJS, response] = await Promise.all([loadExcel(), fetch(new URL('./templates/supplier-orders.json', import.meta.url))]);
  if (!response.ok) throw Error('Không tải được mẫu Excel NCC.');
  const wb = await buildSupplierWorkbook(v, kind, { ExcelJS, templates: await response.json() }, options);
  const bytes = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url; a.download = `${v.ticketNumber}-${kind}.xlsx`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
