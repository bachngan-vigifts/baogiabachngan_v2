const node = (doc, tag, text, cls) => {
  const n = doc.createElement(tag);
  if (text != null) n.textContent = String(text);
  if (cls) n.className = cls;
  return n;
};
/** Print the existing payment request, never create/confirm a payment or order. */
export function buildPaymentQrPrint(doc, data) {
  if (!/^https:\/\//i.test(data.url || '') || !Number.isSafeInteger(data.amount) || data.amount <= 0 || !data.content) throw Error('Thông tin mã thanh toán không hợp lệ.');
  const sheet = node(doc, 'main', null, 'payment-qr-paper');
  const image = node(doc, 'img');
  image.src = data.url;
  image.alt = 'VietQR thanh toán';
  image.width = 260;
  image.height = 260;
  sheet.append(node(doc, 'h2', data.register?.name || 'Bách Ngân'), node(doc, 'h3', 'QUÉT MÃ THANH TOÁN'),
    node(doc, 'p', Number(data.amount).toLocaleString('vi-VN') + ' đ', 'amount'), image,
    node(doc, 'p', 'Nội dung: ' + data.content), node(doc, 'p', 'Vui lòng kiểm tra người nhận, số tiền và nội dung trước khi chuyển khoản.'),
    node(doc, 'p', 'Mã yêu cầu thanh toán — chưa xác nhận thu tiền.', 'note'));
  return sheet;
}
export async function printPaymentQr(data, isCurrent = () => true) {
  if (!isCurrent()) throw Error('Mã thanh toán đã hết hạn hoặc giỏ hàng đã thay đổi. Vui lòng tạo mã mới.');
  const frame = document.createElement('iframe');
  frame.title = 'In mã thanh toán';
  frame.className = 'pos-print-frame';
  document.body.append(frame);
  let imageTimeout, cleanupTimeout;
  const cleanup = () => { clearTimeout(imageTimeout); clearTimeout(cleanupTimeout); frame.remove(); };
  try {
    const doc = frame.contentDocument, win = frame.contentWindow;
    if (!doc || !win) throw Error('Không mở được trang in.');
    const sheet = buildPaymentQrPrint(doc, data);
    doc.head.append(node(doc, 'style', '@page{size:80mm auto;margin:0}body{margin:0;background:white;color:black;font:13px Arial}.payment-qr-paper{width:72mm;padding:4mm;text-align:center;overflow-wrap:anywhere}h2{font-size:17px}h3{font-size:15px}.amount{font-size:21px;font-weight:bold}img{display:block;width:68mm;height:auto;max-width:100%;margin:4mm auto}.note{font-size:11px}'));
    doc.body.append(sheet);
    const image = sheet.querySelector('img');
    await Promise.race([image.decode().catch(() => { throw Error('Không tải được ảnh QR. Vui lòng thử in lại.'); }), new Promise((_, reject) => { imageTimeout = setTimeout(() => reject(Error('Tải ảnh QR quá lâu. Vui lòng thử in lại.')), 15000); })]);
    clearTimeout(imageTimeout);
    if (!image.naturalWidth) throw Error('Không tải được ảnh QR. Vui lòng thử in lại.');
    if (!isCurrent()) throw Error('Mã thanh toán đã hết hạn hoặc giỏ hàng đã thay đổi. Vui lòng tạo mã mới.');
    win.addEventListener('afterprint', cleanup, { once: true });
    cleanupTimeout = setTimeout(cleanup, 120000);
    win.focus();
    win.print();
  } catch (error) {
    cleanup();
    throw Error(error?.message || 'Không in được mã thanh toán. Vui lòng thử lại.');
  }
}
