/* Chép từ web cũ (public/contract-document.js): dựng bộ 3 file Word HĐKT (HĐKT, Biên bản nghiệm thu, Đề nghị tạm ứng) từ mẫu .docx.
   Khác web cũ: mẫu đọc theo đường dẫn tương đối; không đẩy file lên máy chủ khi tải. */
/* Builds the Bách Ngân contract paperwork as separate editable DOCX files. */
globalThis.ContractDocument = (() => {
  const {unzipSync, zipSync, strFromU8, strToU8} = globalThis.fflate || {};
  const bachNganTemplates = [
    {path: 'mau-hop-dong-bach-ngan-hdkt.docx?v=20260922', name: 'HOP_DONG_KINH_TE', file: 'HDKT'},
    {path: 'mau-bien-ban-ban-giao-nghiem-thu.docx?v=20261030', name: 'BIEN_BAN_BAN_GIAO_VA_NGHIEM_THU_SAN_PHAM', file: 'BBNT'},
    {path: 'mau-hop-dong-bach-ngan-tam-ung.docx?v=20260922', name: 'DE_NGHI_TAM_UNG', file: 'TAM_UNG'}
  ];
  const vigiftsTemplates = [
    {path: 'mau-hop-dong-vigifts-hdkt.docx', name: 'HOP_DONG_KINH_TE_VIGIFTS', file: 'HDKT'},
    {path: 'mau-bien-ban-ban-giao-nghiem-thu.docx?v=20261030', name: 'BIEN_BAN_BAN_GIAO_VA_NGHIEM_THU_SAN_PHAM_VIGIFTS', file: 'BBNT'},
    {path: 'mau-hop-dong-vigifts-tam-ung.docx', name: 'DE_NGHI_TAM_UNG_VIGIFTS', file: 'TAM_UNG'}
  ];
  const templatesFor = quote => quote.quote_type === 'VIGIFTS'
    ? vigiftsTemplates
    : bachNganTemplates; // mẫu HĐKT HRC / B2B của web cũ giống hệt mẫu Bách Ngân
  const money = value => new Intl.NumberFormat('vi-VN', {maximumFractionDigits: 0}).format(Math.round(Number(value) || 0));
  const unitMoney = value => new Intl.NumberFormat('vi-VN', {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(Number(value) || 0);
  const clean = value => String(value ?? '').replace(/^\s*[-–]\s*/, '').trim();
  const upper = value => String(value || '').toLocaleUpperCase('vi-VN');
  const xml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[char]));
  const xmlText = value => String(value ?? '').split(/\r?\n/).map(xml).join('</w:t><w:br/><w:t>');
  const token = key => `&lt;&lt;${key}&gt;&gt;`;
  const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const xmlGap = '(?:\\s|<[^>]+>)*';
  const tokenPattern = key => {
    const body = Array.from(String(key)).map(char => /\s/.test(char) ? xmlGap : `${escapeRegExp(char)}${xmlGap}`).join('');
    return new RegExp(`&lt;${xmlGap}&lt;${xmlGap}${body}&gt;${xmlGap}&gt;`, 'g');
  };
  const replaceToken = (source, key, value) => source.replaceAll(token(key), () => xmlText(value)).replace(tokenPattern(key), () => xmlText(value)) /* hàm thay thế: $&, $` trong dữ liệu không bị hiểu là mẫu */;
  const replaceTokens = (source, values) => Object.entries(values).reduce((result, [key, value]) => replaceToken(result, key, value), source);
  const removeLeftoverTokens = source => source.replace(new RegExp(`&lt;${xmlGap}&lt;${xmlGap}[\\s\\S]{0,240}?&gt;${xmlGap}&gt;`, 'g'), '');
  const dateParts = value => {
    const date = value ? new Date(`${value}T00:00:00`) : new Date();
    if (Number.isNaN(date.getTime())) return {day: '', month: '', year: ''};
    return {day: String(date.getDate()).padStart(2, '0'), month: String(date.getMonth() + 1).padStart(2, '0'), year: String(date.getFullYear())};
  };
  const amountInWords = value => globalThis.HrcPdf?.amountInWords ? globalThis.HrcPdf.amountInWords(Math.round(Number(value) || 0)) : 'Không đồng';
  const noteLines = notes => String(notes || '').split(/\r?\n/).map(clean).filter(Boolean);
  const paymentRate = value => {
    const text = String(value || '');
    const direct = text.match(/(?:tạm ứng|đặt cọc|thanh toán trước|thanh toán lần 1|lần 1|ứng trước)[^\d]{0,50}(\d+(?:[.,]\d+)?)\s*%/i)?.[1]
      || text.match(/(\d+(?:[.,]\d+)?)\s*%\s*(?:trị giá|giá trị|hợp đồng|đơn hàng)?[^\n\r]{0,80}(?:tạm ứng|đặt cọc|thanh toán trước|thanh toán lần 1|lần 1|ứng trước)/i)?.[1];
    if (direct) return Number(String(direct).replace(',', '.'));
    const pair = text.match(/\b(\d+(?:[.,]\d+)?)\s*(?:\/|-|–|:)\s*(\d+(?:[.,]\d+)?)\b/);
    if (pair) {
      const first = Number(pair[1].replace(',', '.')), second = Number(pair[2].replace(',', '.'));
      if (first > 0 && second >= 0 && Math.abs(first + second - 100) < 0.001) return first;
    }
    return NaN;
  };
  const noteValue = (lines, label) => {
    const line = lines.find(item => item.toLocaleLowerCase('vi-VN').startsWith(label.toLocaleLowerCase('vi-VN')));
    return line ? line.slice(line.indexOf(':') + 1).trim() : '';
  };
  const safeFilePart = value => String(value || '').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').replace(/[. ]+$/, '').slice(0, 120) || 'Khach-hang';
  const asciiFilePart = value => safeFilePart(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9._ -]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'HDKT';
  const archiveName = (quote, contractNumber) => {
    const fallback = quote.quote_number || quote.quoteNo || quote.customer?.customer_code || quote.customer?.name || 'HDKT';
    return `HDKT_${asciiFilePart(contractNumber || fallback)}`;
  };
  const paymentDetails = (quote, details = {}) => {
    const lines = noteLines(quote.notes);
    const paymentLines = lines.filter(line => /(thanh toán|tạm ứng|đặt cọc|còn lại)/i.test(line));
    const noteRate = paymentRate(paymentLines.join(' '));
    const detailRate = Number(details.depositRate);
    const useContractDetailsFirst = ['B2B', 'HRC'].includes(quote.quote_type);
    const depositRate = (useContractDetailsFirst ? [detailRate, noteRate] : [noteRate, detailRate]).find(Number.isFinite);
    if (!(depositRate >= 0 && depositRate <= 100)) throw new Error('Cần nhập tỷ lệ thanh toán trước từ 0 đến 100%.');
    const total = Number(quote.total) || 0;
    const deposit = Math.round(total * depositRate / 100);
    const remaining = total - deposit;
    return {depositRate, deposit, remaining, days: details.paymentDays, paymentText: paymentLines.join('\n') || 'Theo thỏa thuận của hai bên.', deadline: Number(details.paymentDays) > 0 ? `trong ${details.paymentDays} ngày` : (paymentLines.find(line => /(thời hạn|trong vòng|ngày)/i.test(line)) || '')};
  };
  // Điều khoản thanh toán theo ô nhập (tỉ lệ cọc + số ngày thanh toán phần còn lại):
  // 100% → thanh toán 100% trước khi giao hàng; 0% → thanh toán 100% sau N ngày kể từ ngày giao hàng; X% → cọc X% khi ký, phần còn lại trong N ngày kể từ ngày giao hàng.
  const paymentClause = payment => {
    const days = Math.max(0, parseInt(payment.days, 10) || 0);
    const after = days > 0 ? `trong vòng ${days} ngày kể từ ngày giao hàng` : 'ngay sau khi giao hàng';
    if (payment.depositRate === 100) return `Bên A thanh toán 100% giá trị hợp đồng tương ứng với số tiền là ${money(payment.deposit)} đồng (Bằng chữ: ${amountInWords(payment.deposit)}) trước khi giao hàng.`;
    if (payment.depositRate === 0) return `Bên A thanh toán 100% giá trị hợp đồng tương ứng với số tiền là ${money(payment.remaining)} đồng (Bằng chữ: ${amountInWords(payment.remaining)}) ${days > 0 ? `sau ${days} ngày kể từ ngày giao hàng` : 'ngay sau khi giao hàng'}.`;
    return `Bên A thanh toán cho Bên B ${money(payment.depositRate)}% giá trị của hợp đồng tương ứng với số tiền là ${money(payment.deposit)} đồng (Bằng chữ: ${amountInWords(payment.deposit)}) ngay sau khi ký hợp đồng. Thanh toán ${money(100 - payment.depositRate)}% giá trị còn lại tương ứng ${money(payment.remaining)} đồng (Bằng chữ: ${amountInWords(payment.remaining)}) ${after}.`;
  };
  const withoutRepeatedName = item => {
    const description = String(item.description || '').trim();
    const name = String(item.name || '').trim();
    if (!description) return '';
    if (!name) return description;
    const normalizedDescription = description.replace(/\s+/g, ' ').toLocaleLowerCase('vi-VN');
    const normalizedName = name.replace(/\s+/g, ' ').toLocaleLowerCase('vi-VN');
    if (normalizedDescription === normalizedName) return '';
    return normalizedDescription.startsWith(normalizedName)
      ? description.slice(name.length).replace(/^\s*[-–:|,;.]\s*/, '').trim()
      : description;
  };
  const productDescription = item => [withoutRepeatedName(item), item.bundle_contents ? `Bộ gồm: ${item.bundle_contents}` : '', item.print_description ? `In ấn: ${item.print_description}` : '', item.packaging_description ? `Đóng gói: ${item.packaging_description}` : ''].filter(Boolean).join('\n');
  const packing = item => {
    if (item.packaging_description) return item.packaging_description;
    const parts = [];
    if (Number(item.cartons) > 0 && Number(item.quantity) > 0) parts.push(`${money(Number(item.quantity) / Number(item.cartons))} ${item.unit || 'cái'}/thùng`);
    if (Number(item.weight_kg) > 0 && Number(item.cartons) > 0) parts.push(`nặng ${money(Number(item.weight_kg) / Number(item.cartons))} kg/thùng`);
    return parts.join('; ');
  };
  const contractUnitPrice = item => {
    const quoted = Number(item.price_after_discount);
    if (Number.isFinite(quoted) && quoted >= 0) return quoted;
    const quantity = Number(item.quantity), total = Number(item.line_total);
    if (Number.isFinite(quantity) && quantity > 0 && Number.isFinite(total)) return total / quantity;
    const price = Number(item.unit_price);
    return Number.isFinite(price) ? price : 0;
  };
  const itemValues = (item, index) => ({'Start: [Related Chi tiết đơn hàngs]': '', End: '', '[STT]': index + 1, '[Sản phẩm].[Tên sản phẩm]': item.name || '', '[Mô tả sản phẩm]': productDescription(item), '[Số lượng]': money(item.quantity), '[đơn giá bán]': unitMoney(contractUnitPrice(item)), '[Đơn giá bán]': unitMoney(contractUnitPrice(item)), '[Thành tiền (-VAT)]': money(item.line_total), '[Thành tiền (+VAT)]': money(Number(item.line_total) * (1 + (Number(item.tax_percent) || 0) / 100)), '[Đóng gói]': packing(item)});
  const expandItems = (source, items) => source.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, row => row.includes('Related Chi tiết đơn hàngs') ? items.map((item, index) => replaceTokens(row, itemValues(item, index))).join('') : row);
  // Nhãn dòng thuế: cùng một thuế suất → "VAT (8%)"; nhiều thuế suất → "VAT".
  const vatLabel = items => { const rates = [...new Set(items.map(i => Number(i.tax_percent) || 0))]; return rates.length === 1 ? ` (${money(rates[0])}%)` : ''; };
  // Khối chữ ký cuối văn bản: bảng 2 cột bằng nhau, rộng hết khổ chữ và không trôi (mẫu cũ lệch trái), để 2 cụm "Đại diện" cân đối với trang.
  // Tên người ký bên A luôn in hoa (<<[Bên A ký tên]>>); mẫu chưa có ô tên / chưa có khối chữ ký thì thêm vào.
  const textWidth = source => {
    const page = source.match(/<w:pgSz\b[^>]*w:w="([\d.]+)"/), margin = source.match(/<w:pgMar\b[^>]*>/)?.[0] || '';
    const side = name => Number(margin.match(new RegExp(`w:${name}="([\\d.]+)"`))?.[1] || 0);
    return Math.round((Number(page?.[1]) || 11906) - side('left') - side('right'));
  };
  const SIGN_A = token('[Bên A ký tên]');
  const signRun = (text, bold = true) => `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>${bold ? '<w:b/><w:bCs/>' : ''}<w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
  const signCell = (width, text) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:widowControl w:val="0"/><w:jc w:val="center"/></w:pPr>${text ? signRun(text) : ''}</w:p></w:tc>`;
  const signTable = (width, [left, right], [leftName, rightName]) => {
    const col = Math.floor(width / 2), row = (a, b, height = '') => `<w:tr>${height ? `<w:trPr><w:trHeight w:val="${height}"/></w:trPr>` : ''}${signCell(col, a)}${signCell(col, b)}</w:tr>`;
    return `<w:tbl><w:tblPr><w:tblW w:w="${col * 2}" w:type="dxa"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/><w:tblLook w:val="0600" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="${col}"/><w:gridCol w:w="${col}"/></w:tblGrid>${row(left, right)}${row('', '', 1560)}${row(leftName, rightName)}</w:tbl>`;
  };
  const tidySignature = (source, quote, documentType) => {
    const width = textWidth(source), col = Math.floor(width / 2);
    let found = false;
    const result = source.replace(/<w:tbl>(?:(?!<w:tbl>)[\s\S])*?<\/w:tbl>/g, table => {
      if (!/ĐẠI DIỆN BÊN A/.test(table)) return table;
      found = true;
      let out = table.replace(/<w:tblpPr\b[^>]*\/>/, '')
        .replace(/<w:tblW\b[^>]*\/>/, `<w:tblW w:w="${col * 2}" w:type="dxa"/>`)
        .replace(/<w:tblInd\b[^>]*\/>/, '')
        .replace(/<w:tblPr>[\s\S]*?<\/w:tblPr>/, pr => pr.replace(/<w:jc\b[^>]*\/>/, '').replace(/<w:tblW\b[^>]*\/>/, m => `${m}<w:jc w:val="center"/>`))
        .replace(/<w:gridCol\b[^>]*\/>/g, `<w:gridCol w:w="${col}"/>`)
        .replace(/<w:tcW\b[^>]*\/>/g, `<w:tcW w:w="${col}" w:type="dxa"/>`)
        .replaceAll(token('[Bên A]'), SIGN_A)
        .replace(/(<w:t\b[^>]*>)\s*([^<]*?)\s*(<\/w:t>)/g, '$1$2$3'); // bỏ dấu cách thừa làm lệch chữ khi căn giữa
      if (!out.includes(SIGN_A)) { // ô tên bên A (hàng cuối, cột đầu) còn trống → điền chỗ tên
        const rows = out.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [], last = rows[rows.length - 1];
        const cell = last?.match(/<w:tc>[\s\S]*?<\/w:tc>/)?.[0];
        if (cell && !/<w:t[^>]*>[^<]*\S[^<]*<\/w:t>/.test(cell)) {
          const filled = /<w:t\b[^>]*>[^<]*<\/w:t>/.test(cell) ? cell.replace(/<w:t\b[^>]*>[^<]*<\/w:t>/, `<w:t>${SIGN_A}</w:t>`) : cell.replace('</w:p>', `${signRun(SIGN_A)}</w:p>`);
          out = out.replace(last, last.replace(cell, filled));
        }
      }
      return out;
    });
    // Đề nghị tạm ứng (mẫu Vigifts): khối ký chỉ có bên B, là bảng "trôi" – bản xem trên web bỏ qua vị trí trôi nên hiện lệch trái.
    // Đặt thành bảng thường, rộng nửa khổ chữ, sát lề phải = đúng chỗ cột "Đại diện bên B" của HĐKT. Không đụng các đoạn chữ (giữ chỗ sửa đã lưu).
    if (!found && documentType === 'TAM_UNG') return result.replace(/<w:tbl>(?:(?!<w:tbl>)[\s\S])*?<\/w:tbl>/g, table => !/ĐẠI DIỆN BÊN B/.test(table) ? table : table
      .replace(/<w:tblpPr\b[^>]*\/>/, '')
      .replace(/<w:tblPr>[\s\S]*?<\/w:tblPr>/, pr => pr.replace(/<w:jc\b[^>]*\/>/, '').replace(/<w:tblW\b[^>]*\/>/, `<w:tblW w:w="${col}" w:type="dxa"/><w:jc w:val="right"/>`))
      .replace(/<w:gridCol\b[^>]*\/>/g, `<w:gridCol w:w="${col}"/>`));
    if (found || documentType !== 'BBNT') return result;
    // Biên bản nghiệm thu Bách Ngân: mẫu cũ không có khối chữ ký → thêm (bên nhận = khách bên trái, bên giao = công ty bên phải).
    const companySigner = quote.quote_type === 'VIGIFTS' ? 'HUỲNH CHÂU YẾN' : 'LÊ MINH THÁI';
    const block = signTable(width, ['ĐẠI DIỆN BÊN NHẬN', 'ĐẠI DIỆN BÊN GIAO'], [SIGN_A, companySigner]);
    const at = result.lastIndexOf('<w:sectPr');
    return at < 0 ? result : `${result.slice(0, at)}${block}<w:p/>${result.slice(at)}`;
  };
  const buildXml = (source, quote, contractNumber, documentType = 'HDKT') => {
    const lines = noteLines(quote.notes), payment = paymentDetails(quote, quote.contractDetails), date = dateParts(quote.quote_date);
    const deliveryTime = quote.contractDetails?.deliveryTime || noteValue(lines, 'Thời gian giao hàng') || noteValue(lines, 'Giao hàng') || 'Theo thỏa thuận của hai bên.';
    const deliveryPlace = quote.contractDetails?.deliveryAddress || noteValue(lines, 'Địa điểm giao hàng') || 'Theo thỏa thuận của hai bên.';
    const paymentMethod = quote.contractDetails?.paymentMethod || noteValue(lines, 'Phương thức thanh toán') || 'Chuyển khoản.';
    const customer = quote.customer || {};
    const paymentText = paymentClause(payment);
    const rawName = String(customer.contact_name || customer.contact || '').trim();
    const prefix = /^(ông|bà)\s+/i.exec(rawName);
    const partyAName = prefix ? rawName.slice(prefix[0].length).trim() : rawName;
    const selectedHonorific = quote.contractDetails?.representativeHonorific;
    const honorific = ['', 'Ông', 'Bà'].includes(selectedHonorific) ? selectedHonorific : prefix ? (/^ông$/i.test(prefix[1]) ? 'Ông' : 'Bà') : '';
    source = tidySignature(source, quote, documentType);
    // Mẫu cũ có Ông trước token: thay riêng chữ này, giữ nguyên các run/định dạng Word.
    source = source.replace(/<w:p\b[\s\S]*?<\/w:p>/g, paragraph => {
      const at = tokenPattern('[Bên A]').exec(paragraph)?.index;
      if (at === undefined) return paragraph;
      let hasHonorific = false;
      const before = paragraph.slice(0, at).replace(/(<w:t\b[^>]*>[^<]*?)(?:Ông|Bà)(\s*)(<\/w:t>|$)/gi, (_, open, gap, close) => { hasHonorific = true; return open + xml(honorific) + gap + close; });
      if (hasHonorific) return before + paragraph.slice(at);
      return replaceToken(paragraph, '[Bên A]', [honorific, partyAName].filter(Boolean).join(' '));
    });
    const seller = quote.quote_type === 'VIGIFTS' ? { name: 'CÔNG TY TNHH SẢN XUẤT THƯƠNG MẠI QUẢNG CÁO VIGIFTS', address: 'Số W36, Đường số 9, Khu dân cư công ty 8, Khu vực 2, Phường Cái Răng, TP Cần Thơ, Việt Nam.', taxCode: '1801291722', representative: 'Bà Huỳnh Châu Yến' } : { name: 'CÔNG TY TNHH SẢN XUẤT THƯƠNG MẠI BÁCH NGÂN', address: '102B đường 3/2, Phường Tân An, Thành phố Cần Thơ, Việt Nam.', taxCode: '1801686576', representative: 'Ông Lê Minh Thái' };
    const values = {'[Bên giao tên]': seller.name, '[Bên giao địa chỉ]': seller.address, '[Bên giao MST]': seller.taxCode, '[Bên giao đại diện]': seller.representative, '[Số HĐ]': contractNumber, '[dấu thời gian]': `${date.day}/${date.month}/${date.year}`, '[Ngày ký]': `${date.day}/${date.month}/${date.year}`, '[KH_NDP].[TênKH]': customer.name || '', '[KH_NDP].[dia chi]': customer.address || '', '[KH_NDP].[Dia Chi]': customer.address || '', '[KH_NDP].[Ma So Thue]': customer.tax_code || '', '[Bên A]': partyAName, '[Bên A ký tên]': upper(partyAName), '[Chức vụ]': quote.contractTitle || '', '[Thời gian giao hàng]': deliveryTime, '[Địa điểm giao hàng]': deliveryPlace, '[Phương thức thanh toán]': paymentMethod, '[Thời hạn thanh toán]': paymentText, '[hình thức thanh toán]': paymentText, '[Tỉ lệ cọc]': money(payment.depositRate), '[số tiền tạm ứng]': money(payment.deposit), '[bằng chữ tạm ứng]': amountInWords(payment.deposit), '[Thành Tiền (-Thuế)]': money(quote.subtotal), '[Tiền thuế]': money(quote.vat_amount), '[Thành tiền (+thuế)]': money(quote.total), '[Số tiền bằng chữ]': amountInWords(quote.total), '[Nhãn VAT]': vatLabel(quote.items || [])};
    // Cột "Đóng gói" (mẫu biên bản Vigifts) có đoạn trống phía trên chỗ điền → chữ bị đẩy xuống: bỏ đoạn trống trong ô đó.
    source = source.replace(/<w:tc>(?:(?!<w:tc>)[\s\S])*?<\/w:tc>/g, cell => !cell.includes(token('[Đóng gói]')) ? cell
      : cell.replace(/<w:p\b(?:(?!<w:p\b)[\s\S])*?<\/w:p>/g, p => /<w:t\b/.test(p) ? p : ''));
    let result = replaceTokens(expandItems(source, quote.items || []), values);
    result = result.replace('Hôm nay, ngày      tháng      năm 2025, chúng tôi gồm:', `Hôm nay, ngày ${date.day} tháng ${date.month} năm ${date.year}, chúng tôi gồm:`);
    result = result.replace('TP Cần Thơ, ngày 04 tháng 06 năm 2025', `TP Cần Thơ, ngày ${date.day} tháng ${date.month} năm ${date.year}`);
    result = result.replace('ký ngày  07  tháng 05  năm 2025', `ký ngày ${date.day} tháng ${date.month} năm ${date.year}`);
    result = result.replace('Phương thức thanh toán: Chuyển khoản.', () => xml(`Phương thức thanh toán: ${paymentMethod}`));
    if(documentType==='HDKT')result=result.replace(/<w:p\b[\s\S]*?<\/w:p>/g, paragraph=>{
      const text=[...paragraph.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map(m=>m[1]).join('');
      const value=/^\s*Hôm nay,\s*ngày/i.test(text)?`Hôm nay, ngày ${date.day} tháng ${date.month} năm ${date.year}, chúng tôi gồm:`
        :/^\s*5\.2\s*Địa điểm giao hàng\s*:/i.test(text)?`5.2   Địa điểm giao hàng: ${deliveryPlace}`:null;
      if(value===null)return paragraph;
      let first=true;return paragraph.replace(/(<w:t\b[^>]*>)[^<]*(<\/w:t>)/g,(_,a,b)=>{const v=first?xml(value):'';first=false;return a+v+b;});
    });
    return tidyDocumentTerms(removeLeftoverTokens(result), documentType);
  };
  // Work across Word runs without dropping paragraph/run formatting.
  const tidyDocumentTerms = (source, documentType) => source.replace(/<w:p\b[\s\S]*?<\/w:p>/g, paragraph => {
    const nodes = [...paragraph.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)];
    const text = nodes.map(n => n[1]).join('');
    if (documentType === 'HDKT' && /Hợp đồng này được làm thành/i.test(text)) {
      const parts = nodes.map(n => n[1]);
      const offsets = []; let offset = 0;
      for (const part of parts) { offsets.push(offset); offset += part.length; }
      // Only the legacy four-copy clause changes; already corrected clauses remain intact.
      if (/04\s*\(bốn\)/i.test(text)) {
        const matches = [...text.matchAll(/0([24])\s*\((?:hai|bốn)\)/gi)];
        for (const match of matches.reverse()) {
          const from = match.index, to = from + match[0].length;
          const replacement = match[1] === '4' ? '02 (hai)' : '01 (một)';
          for (let i = 0; i < parts.length; i++) {
            const left = offsets[i], right = left + nodes[i][1].length;
            if (right <= from || left >= to) continue;
            parts[i] = parts[i].slice(0, Math.max(0, from - left)) + (from >= left ? replacement : '') + parts[i].slice(Math.min(to - left, nodes[i][1].length));
          }
        }
        let i = 0;
        paragraph = paragraph.replace(/(<w:t\b[^>]*>)[^<]*(<\/w:t>)/g, (_, open, close) => open + parts[i++] + close);
      }
    }
    if (documentType === 'BBNT' && /^\s*[^,]*,?\s*ngày\s*\.{2,}\s*tháng\s*\.{2,}\s*năm\s*\.{2,}\s*$/i.test(text)) {
      paragraph = paragraph.replace(/<w:tab\s*\/>/g, '').replace(/(<w:t\b[^>]*>)\s+/, '$1');
      const align = '<w:jc w:val="right"/>';
      if (/<w:pPr\b[^>]*\/>/.test(paragraph)) paragraph = paragraph.replace(/<w:pPr\b[^>]*\/>/, '<w:pPr>' + align + '</w:pPr>');
      else if (/<w:pPr\b/.test(paragraph)) paragraph = paragraph.replace(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/, props => props.replace(/<w:jc\b[^>]*\/>/g, '').replace(/<w:ind\b[^>]*\/>/g, '').replace('</w:pPr>', align + '</w:pPr>'));
      else paragraph = paragraph.replace(/(<w:p\b[^>]*>)/, '$1<w:pPr>' + align + '</w:pPr>');
    }
    return paragraph;
  });
  const templateMark = (quote, documentType = 'HDKT') => `${quote.quote_type === 'VIGIFTS' ? 'VG' : 'BN'}-${documentType}-20261002`;
  function addWebSourceFooter(files, quote, documentType) {
    const mark = templateMark(quote, documentType);
    const paragraph = `<w:p><w:pPr><w:jc w:val="right"/><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:color w:val="B8B8B8"/><w:sz w:val="16"/></w:rPr><w:t>${xml(mark)}</w:t></w:r></w:p>`;
    const existingFooters = Object.keys(files).filter(path => /^word\/footer[^/]*\.xml$/.test(path));
    for (const path of existingFooters) files[path] = strToU8(strFromU8(files[path]).replace('</w:ftr>', `${paragraph}</w:ftr>`));
    const path = 'word/footerWebSource.xml';
    files[path] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${paragraph}</w:ftr>`);
    const relPath = 'word/_rels/document.xml.rels';
    let relationships = files[relPath] ? strFromU8(files[relPath]) : '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    let id = 'rIdWebSource';
    while (relationships.includes(`Id="${id}"`)) id += '1';
    relationships = relationships.replace('</Relationships>', `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footerWebSource.xml"/></Relationships>`);
    files[relPath] = strToU8(relationships);
    let documentXml = strFromU8(files['word/document.xml']);
    documentXml = documentXml.replace(/<w:sectPr\b([^>]*)>([\s\S]*?)<\/w:sectPr>/g, (section, attrs, content) => {
      const references = ['default', 'first', 'even'].filter(type => !new RegExp(`<w:footerReference[^>]*w:type="${type}"`).test(content)).map(type => `<w:footerReference w:type="${type}" r:id="${id}"/>`).join('');
      content = content.replace(/^((?:<w:headerReference\b[^>]*\/>)*)([\s\S]*)$/, (_, headers, rest) => headers + references + rest);
      content = content.replace(/w:footer="[^"]*"/, 'w:footer="360"');
      return `<w:sectPr${attrs}>${content}</w:sectPr>`;
    });
    files['word/document.xml'] = strToU8(documentXml);
    const types = strFromU8(files['[Content_Types].xml']);
    files['[Content_Types].xml'] = strToU8(types.replace('</Types>', '<Override PartName="/word/footerWebSource.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'));
  }
  // Explicit fonts defeat inherited Calibri / theme fonts in Word and docx-preview alike.
  // Apply before table copying so the BBNT table remains byte-for-byte identical to the HĐKT.
  function normalizeFonts(files) {
    const fonts = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>';
    for (const path of Object.keys(files).filter(p => /^word\/(?:document|styles|header[^/]*|footer[^/]*)\.xml$/.test(p))) {
      let source = strFromU8(files[path]).replace(/<w:rFonts\b[^>]*\/>/g, fonts);
      source = source.replace(/<w:r\b([^>]*)>([\s\S]*?)<\/w:r>/g, (_, attrs, body) => {
        if (/^<w:rPr>/.test(body)) body = body.replace(/^<w:rPr>([\s\S]*?)<\/w:rPr>/, (_, props) => '<w:rPr>' + fonts + props.replace(/<w:rFonts\b[^>]*\/>/g, '') + '</w:rPr>');
        else if (/^<w:rPr\s*\/>/.test(body)) body = body.replace(/^<w:rPr\s*\/>/, '<w:rPr>' + fonts + '</w:rPr>');
        else body = '<w:rPr>' + fonts + '</w:rPr>' + body;
        return '<w:r' + attrs + '>' + body + '</w:r>';
      });
      files[path] = strToU8(source);
    }
  }
  async function prepareDocument({quote, contractNumber, templateBytes, details, documentType = 'HDKT', contractBytes}) {
    if (!unzipSync) throw new Error('Chưa tải được bộ tạo file HĐKT. Vui lòng tải lại trang.');
    if (!['HRC', 'B2B', 'VIGIFTS'].includes(quote.quote_type)) throw new Error('Loại báo giá không hỗ trợ tải HĐKT.');
    if (!contractNumber) throw new Error('Thiếu số HĐKT.');
    const files = unzipSync(new Uint8Array(templateBytes)), path = 'word/document.xml';
    if (documentType === 'BBNT' && quote.quote_type === 'VIGIFTS' && files['word/media/logo-vigifts.png']) {
      files['word/media/image1.png'] = files['word/media/logo-vigifts.png'];
      files[path] = strToU8(strFromU8(files[path]).replace(/<w:drawing\b[\s\S]*?<\/w:drawing>/g, drawing => !drawing.includes('r:embed="rId4"') ? drawing : drawing.replace(/<(wp:extent|a:ext) cx="(\d+)" cy="\d+"\/>/g, (_, tag, width) => '<' + tag + ' cx="' + width + '" cy="' + Math.round(Number(width) * 1420 / 2048) + '"/>')));
    }
    if (!files[path]) throw new Error('Mẫu HĐKT không hợp lệ.');
    const filledQuote = {...quote,...(details?.signedDate?{quote_date:details.signedDate}:{}), contractDetails: details || {}, customer: {...(quote.customer || {}), contact_name: details?.representativeName || quote.customer?.contact_name || quote.customer?.contact || ''}, contractTitle: details?.representativeTitle || ''};
    files[path] = strToU8(buildXml(strFromU8(files[path]), filledQuote, contractNumber, documentType));
    addWebSourceFooter(files, quote, documentType);
    const oldTypography = zipSync(files, {level: 6});
    normalizeFonts(files);
    let base=zipSync(files, {level: 6});
    let edits=(documentType==='HDKT'?quote.contract_word_edits:quote.contract_document_edits?.[documentType])||[],locked=[];
    if(edits.length && globalThis.ContractWordEdit?.rebaseTypography) edits=await globalThis.ContractWordEdit.rebaseTypography(oldTypography,base,edits);
    if(documentType==='BBNT'&&contractBytes){
      if(!globalThis.ContractWordEdit)throw new Error('Chưa tải công cụ chỉnh Word.');
      ({base,edits,locked}=await globalThis.ContractWordEdit.copyContractTable(base,contractBytes,edits));
    }
    if(edits.length){
      if(!globalThis.ContractWordEdit)throw new Error('Chưa tải công cụ chỉnh Word.');
      edits=await globalThis.ContractWordEdit.rebaseRepresentative(base,edits,details||{});
      if(documentType==='HDKT')edits=await globalThis.ContractWordEdit.rebaseFields(base,edits);
    }
    if(documentType==='HDKT'&&globalThis.ContractWordEdit?.formFieldParagraphs)locked=globalThis.ContractWordEdit.formFieldParagraphs(base);
    return {base,edits,locked};
  }
  async function build(options){
    const {base,edits}=await prepareDocument(options);
    return edits.length?globalThis.ContractWordEdit.apply(base,edits):base;
  }
  async function buildPack({quote, contractNumber, details, templateFiles}) {
    const folder = archiveName(quote, contractNumber), files = {};
    const typeOf=t=>t.file||(t.name.includes('BIEN_BAN')?'BBNT':t.name.includes('TAM_UNG')?'TAM_UNG':'HDKT');
    const hdkt=templateFiles.find(t=>typeOf(t)==='HDKT');
    if(!hdkt)throw Error('Thiếu mẫu HĐKT để lập bộ hồ sơ.');
    const contractBytes=await build({quote,contractNumber,details,templateBytes:hdkt.templateBytes});
    for(const template of templateFiles){
      const documentType=typeOf(template);
      files[`${template.file||template.name}.docx`]=documentType==='HDKT'?contractBytes:await build({quote,contractNumber,details,templateBytes:template.templateBytes,documentType,contractBytes});
    }
    return {bytes: zipSync(files, {level: 6}), folder};
  }
  async function download({quote, contractNumber, details}) {
    const templateFiles = await Promise.all(templatesFor(quote).map(async template => {
      const response = await fetch(template.path);
      if (!response.ok) throw new Error('Không tải được mẫu biểu HĐKT.');
      return {...template, templateBytes: await response.arrayBuffer()};
    }));
    const archive = await buildPack({quote, contractNumber, details, templateFiles});
    const blob = new Blob([archive.bytes], {type: 'application/zip'}), link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = `${archive.folder}.zip`; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  return {build, buildPack, download, paymentDetails, prepareDocument, contractUnitPrice, templatesFor, archiveName};
})();
