/** PDF gửi NCC: chỉ mã, tên, ĐVT và số lượng thiếu so với tồn khả dụng. */
export function shortageRows(items, products, availableStock) {
  const grouped = new Map();
  for (const item of items) {
    const qty = Number(item.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const prior = grouped.get(item.sku);
    if (prior) prior.qty += qty;
    else grouped.set(item.sku, { sku: item.sku, name: item.name, unit: item.unit || '', qty });
  }
  const rows = []; let unknown = 0;
  for (const item of grouped.values()) {
    const product = products.get(item.sku), available = product ? availableStock(product) : null;
    if (available === null || available === undefined || !Number.isFinite(Number(available))) { unknown++; continue; }
    const missing = Math.max(0, item.qty - Math.max(0, Number(available)));
    if (missing > 0) rows.push({ sku: item.sku, name: item.name, unit: item.unit, missing });
  }
  return { rows, unknown };
}

let ready;
function loadScript(file, present) {
  if (present()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = new URL(file, import.meta.url).href;
    script.onload = () => present() ? resolve() : reject(Error('Bộ tạo PDF chưa sẵn sàng.'));
    script.onerror = () => { script.remove(); reject(Error('Không tải được bộ tạo PDF. Vui lòng thử lại.')); };
    document.head.append(script);
  });
}
async function resources() {
  return ready ||= (async () => {
    await Promise.all([loadScript('./pdf-lib.min.js', () => !!globalThis.PDFLib), loadScript('./fontkit.umd.min.js', () => !!globalThis.fontkit)]);
    const fonts = await Promise.all(['TimesNewRoman.ttf', 'TimesNewRomanBold.ttf'].map(async file => {
      const response = await fetch(new URL('./fonts/' + file, import.meta.url));
      if (!response.ok) throw Error('Không tải được font PDF. Vui lòng thử lại.');
      return new Uint8Array(await response.arrayBuffer());
    }));
    return { PDFLib: globalThis.PDFLib, fontkit: globalThis.fontkit, fonts };
  })().catch(error => { ready = null; throw error; });
}

export async function buildShortagePdf({ rows, unknown = 0 }, { PDFLib, fontkit, fonts }) {
  if (!rows.length) throw Error('Không có mã thiếu để xuất PDF.');
  const pdf = await PDFLib.PDFDocument.create(); pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(fonts[0], { subset: true }), bold = await pdf.embedFont(fonts[1], { subset: true });
  const widths = [28, 96, 283, 47, 69], starts = [36, 64, 160, 443, 490], size = 10, lineHeight = 13;
  let page, y;
  const write = (text, x, top, font = regular, fontSize = size) => page.drawText(String(text), { x, y: top - fontSize, font, size: fontSize });
  function newPage() {
    page = pdf.addPage([595.28, 841.89]);
    write('DANH SÁCH HÀNG CẦN BỔ SUNG', 36, 805, bold, 15);
    write('Đề nghị nhà cung cấp kiểm tra và báo khả năng cung ứng.', 36, 779);
    write('Số lượng thiếu tính theo tồn khả dụng tại thời điểm xuất danh sách.', 36, 763, regular, 9);
    if (unknown) write(`${unknown} mã chưa có số liệu tồn, chưa được tính vào danh sách.`, 36, 748, regular, 9);
    y = unknown ? 724 : 739;
    ['STT', 'Mã hàng', 'Tên sản phẩm', 'ĐVT', 'SL thiếu'].forEach((s, i) => write(s, starts[i] + 4, y, bold)); y -= 25;
  }
  function wrap(value, width) {
    const lines = []; let current = '';
    for (const char of String(value ?? '').replace(/\s+/g, ' ').trim()) {
      if (regular.widthOfTextAtSize(current + char, size) > width && current) { lines.push(current.trim()); current = ''; }
      current += char;
    }
    if (current || !lines.length) lines.push(current.trim()); return lines;
  }
  newPage();
  rows.forEach((row, index) => {
    const cells = [index + 1, row.sku, row.name, row.unit, Number(row.missing).toLocaleString('vi-VN', { maximumFractionDigits: 6 })]
      .map((v, i) => wrap(v, widths[i] - 8));
    let offset = 0, count = Math.max(...cells.map(c => c.length));
    while (offset < count) {
      if (y < 75) newPage();
      const take = Math.min(count - offset, Math.floor((y - 52) / lineHeight));
      const height = Math.max(26, take * lineHeight + 8);
      cells.forEach((lines, i) => lines.slice(offset, offset + take).forEach((text, j) => write(text, starts[i] + 4, y - j * lineHeight)));
      page.drawLine({ start: { x: 36, y: y - height + 4 }, end: { x: 559, y: y - height + 4 }, thickness: 0.4, color: PDFLib.rgb(.75, .78, .82) });
      y -= height; offset += take;
      if (offset < count) newPage();
    }
  });
  const pages = pdf.getPages(); pages.forEach((p, index) => p.drawText(`Trang ${index + 1}/${pages.length}`, { x: 490, y: 25, font: regular, size: 9 }));
  pdf.setTitle('Danh sách hàng cần bổ sung');
  return pdf.save();
}

export async function downloadShortagePdf(data, requestId) {
  const bytes = await buildShortagePdf(data, await resources());
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a'); link.href = url;
  link.download = 'Ma-thieu-' + String(requestId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0,60) + '.pdf';
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
