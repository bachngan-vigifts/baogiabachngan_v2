import { purchaseExportData } from './purchase-export-data.js';
import { buildLockSupplierFile, LOCK_TEMPLATE_URL } from './purchase-lock-template.js';
let ready, zipReady;
const loadZip = () => zipReady ||= new Promise((resolve, reject) => {
  if (globalThis.fflate) return resolve(globalThis.fflate);
  const script = document.createElement('script'); script.src = new URL('./fflate.min.js', import.meta.url).href;
  script.onload = () => resolve(globalThis.fflate); script.onerror = () => { zipReady = null; reject(Error('Không tải được công cụ Excel Lock.')); }; document.head.append(script);
});
const loadExcel = () => ready ||= new Promise((resolve, reject) => {
  if (globalThis.ExcelJS) return resolve(globalThis.ExcelJS);
  const s = document.createElement('script'); s.src = new URL('./exceljs.min.js', import.meta.url).href;
  s.onload = () => resolve(globalThis.ExcelJS); s.onerror = () => { ready = null; reject(Error('Không tải được công cụ Excel.')); }; document.head.append(s);
});
const copy = o => JSON.parse(JSON.stringify(o));
const money = '#,##0.00';
/** Minh Long uses its existing layout descriptors; Lock preserves its native workbook separately. */
export async function buildSupplierWorkbook(v, kind, { ExcelJS, templates }, options = {}) {
  if (!['minh-long', 'minh-long-logo'].includes(kind)) throw Error('Chọn mẫu Excel Minh Long.');
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
  if (kind === 'minh-long') {
    const def = template.sheets[0], ws = create(def);
    [6, 18, 58, 22, 24, 12, 12, 34, 30].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    data.lines.forEach((l, i) => {
      line(ws, def, 2 + i, [i + 1, l.sku, l.name, l.collection, l.pattern, l.quality, l.quantity, data.supplier.name, `${l.promisedDate} · ${data.ticketNumber}`]);
    });
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
  if (kind === 'lock') {
    const [zip, response] = await Promise.all([loadZip(), fetch(new URL(LOCK_TEMPLATE_URL, import.meta.url))]);
    if (!response.ok) throw Error('Không tải được mẫu Excel Lock.');
    saveSupplierExcel(v, kind, buildLockSupplierFile(v, await response.arrayBuffer(), zip, options));
    return;
  }
  const [ExcelJS, response] = await Promise.all([loadExcel(), fetch(new URL('./templates/supplier-orders.json', import.meta.url))]);
  if (!response.ok) throw Error('Không tải được mẫu Excel NCC.');
  const wb = await buildSupplierWorkbook(v, kind, { ExcelJS, templates: await response.json() }, options);
  saveSupplierExcel(v, kind, await wb.xlsx.writeBuffer());
}
function saveSupplierExcel(v, kind, bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url; a.download = `${v.ticketNumber}-${kind}.xlsx`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
