import { purchaseExportData } from './purchase-export-data.js';

// Patch only the agreed inputs and expanded order rows. Do not round-trip the
// workbook through a spreadsheet model: its catalogue, styles and native parts
// belong to the supplier template and must survive byte-for-byte.
export const LOCK_TEMPLATE_URL = './templates/lock-order-e551e09b.xlsx';
const orderPath = 'xl/worksheets/sheet2.xml';
const xmlText = value => {
  const text = String(value ?? '');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw Error('Thông tin xuất Excel có ký tự không hợp lệ.');
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
};
function setCell(xml, ref, value) {
  const pattern = new RegExp(`<c\\b([^>]*\\br="${ref}"[^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/c>)`);
  if (!pattern.test(xml)) throw Error(`Mẫu Lock thiếu ô ${ref}.`);
  return xml.replace(pattern, (_match, attributes) => {
    const attrs = attributes.replace(/\s+t="[^"]*"/, '').replace(/\/$/, '');
    if (value === '' || value == null) return `<c${attrs}/>`;
    if (typeof value === 'number') return `<c${attrs}><v>${value}</v></c>`;
    return `<c${attrs} t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
  });
}
// Excel fill-down semantics: absolute row references remain fixed.
function fillFormula(formula, offset) {
  // Approved exception to the original template: lock the catalogue ranges so
  // copying a line cannot omit catalogue entries at the beginning of Total.
  const fixedLookup = formula.replace(/Total!([A-Z]+)(\d+):([A-Z]+)(\d+)/g, (_m, firstCol, firstRow, lastCol, lastRow) => `Total!$${firstCol}$${firstRow}:$${lastCol}$${lastRow}`);
  return fixedLookup.replace(/\b(\$?[A-Z]{1,3})(\$?)(\d+)\b/g, (_m, col, fixed, row) => `${col}${fixed}${Number(row) + (fixed ? 0 : offset)}`);
}
function relocateRow(row, source, target) {
  return row.replace(/\br="([A-Z]*)(\d+)"/g, (match, col, number) => Number(number) === source ? `r="${col}${target}"` : match);
}
function updateFormulaCells(row, translate) {
  return row.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (cell, attrs, body) => {
    if (!body || !/<f\b/.test(body)) return cell;
    const formula = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(body)?.[1];
    if (!formula) throw Error('Công thức mẫu Lock không hợp lệ.');
    // Remove stale sample results and shared-formula metadata; Excel recalculates
    // the unchanged expressions after opening the populated workbook.
    return `<c${attrs.replace(/\s+t="[^"]*"/, '')}><f>${translate(formula)}</f></c>`;
  });
}

export function buildLockSupplierFile(v, templateBytes, zip, options = {}) {
  const data = purchaseExportData(v, options);
  if (data.lines.length > 1048563) throw Error('Đơn có quá nhiều dòng để xuất Excel.');
  const files = zip.unzipSync(new Uint8Array(templateBytes));
  for (const path of [orderPath, 'xl/workbook.xml', 'xl/calcChain.xml', 'xl/worksheets/sheet1.xml']) {
    if (!files[path]) throw Error('Không đọc được mẫu Excel Lock.');
  }
  let order = zip.strFromU8(files[orderPath]);
  const prototype = /<row\b[^>]*\br="12"[^>]*>[\s\S]*?<\/row>/.exec(order)?.[0];
  const total = /<row\b[^>]*\br="13"[^>]*>[\s\S]*?<\/row>/.exec(order)?.[0];
  if (!prototype || !total) throw Error('Mẫu Excel Lock không đúng cấu trúc dòng hàng.');
  const last = 11 + data.lines.length, totalRow = last + 1;
  const rows = data.lines.map((line, index) => {
    const rowNumber = 12 + index;
    let row = updateFormulaCells(relocateRow(prototype, 12, rowNumber), f => fillFormula(f, index));
    for (const [column, value] of Object.entries({ A: index + 1, C: line.sku, F: line.quantity, G: '' })) row = setCell(row, `${column}${rowNumber}`, value);
    return row;
  }).join('');
  const totals = updateFormulaCells(relocateRow(total, 13, totalRow), f => f.replace(/([FGJ])12:\1\d+/g, (_m, col) => `${col}12:${col}${last}`));
  order = order.replace(prototype, () => rows).replace(total, () => totals)
    .replace('ref="A1:K13"', `ref="A1:K${totalRow}"`)
    .replace('<autoFilter ref="A11:H13"', `<autoFilter ref="A11:H${totalRow}"`)
    .replace('<mergeCell ref="A13:D13"', `<mergeCell ref="A${totalRow}:D${totalRow}"`);
  for (const [ref, value] of Object.entries({ G2: '', G3: data.contact, G4: '', D5: data.address, D6: data.phone, G7: data.orderDate, E8: data.arrivalDate, G9: 'LOCKNLOCK' })) order = setCell(order, ref, value);
  files[orderPath] = zip.strToU8(order);
  let workbook = zip.strFromU8(files['xl/workbook.xml']);
  workbook = workbook.replace('order!$A$11:$H$13', `order!$A$11:$H$${totalRow}`)
    .replace(/<calcPr\b([^>]*?)\/>/, (_m, attrs) => `<calcPr${attrs.replace(/\s+(?:fullCalcOnLoad|forceFullCalc)="[^"]*"/g, '')} fullCalcOnLoad="1" forceFullCalc="1"/>`);
  files['xl/workbook.xml'] = zip.strToU8(workbook);
  let chain = zip.strFromU8(files['xl/calcChain.xml']);
  const lineEntries = [...chain.matchAll(/<c\b[^>]*\br="[A-Z]+12"[^>]*\/>/g)].map(m => m[0]).join('');
  const totalEntries = [...chain.matchAll(/<c\b[^>]*\br="[A-Z]+13"[^>]*\/>/g)].map(m => m[0]).join('');
  chain = chain.replace(/(<calcChain\b[^>]*>)[\s\S]*?(<\/calcChain>)/, (_m, start, end) => start + data.lines.map((_line, i) => relocateRow(lineEntries, 12, 12 + i)).join('') + relocateRow(totalEntries, 13, totalRow) + end);
  files['xl/calcChain.xml'] = zip.strToU8(chain);
  return zip.zipSync(files, { level: 6 });
}
