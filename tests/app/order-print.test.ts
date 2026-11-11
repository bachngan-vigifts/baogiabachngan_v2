import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const print = await import(pathToFileURL(new URL('../../trial-ui/order-print.js', import.meta.url).pathname).href);
const order = { orderNo: 'DH_20261008_002', customerName: 'Khách', expectedDeliveryDate: '2026-10-10' };
const contract = { contractNo: '10-02/08102026/HĐKT/BN-QTSM' };
test('phiếu giao: ghi chú nghiệm thu thay toàn bộ ghi chú cũ, hình ảnh an toàn và tổng đúng cột',()=>{
  const p=print.deliveryPrintData({seller:'BN',order:{...order,note:'Ghi chú cũ không in'},lines:[{sku:'001',name:'Ly <x>',unit:'Cái',ordered:4,qty:2,imageUrl:'https://images.test/ly.png'},{sku:'002',name:'Đĩa',ordered:3,qty:1,imageUrl:'javascript:alert(1)'}]});
  assert.equal(p.note,'- Phiếu bàn giao sản phẩm này cũng chính là biên bản nghiệm thu sản phẩm và được kết thúc ngay sau khi hai bên ký giao – nhận đầy đủ sản phẩm.');
  for(const edit of [false,true]){const html=print.slipSheetHtml(p,{edit});assert.match(html,/<th>Hình ảnh<\/th>/);assert.match(html,/<img src="https:\/\/images.test\/ly.png" alt="Ly &lt;x&gt;">/);assert.doesNotMatch(html,/Ghi chú cũ|javascript:|data-f="lines\.0\.imageUrl"/);assert.match(html,/colspan="5"/);}
  assert.equal(print.packingPrintData({seller:'BN',order,slip:{note:'Ghi chú đóng gói'},lines:[]}).note,'Ghi chú đóng gói');
});
test('phiếu có HĐKT dùng số hợp đồng và giữ số riêng của phiếu / chuyến', () => {
  const packing = print.packingPrintData({ seller: 'BN', order, contract, slip: { slipNo: 'PK_001' }, lines: [] });
  const delivery = print.deliveryPrintData({ seller: 'BN', order, contract, delivery: { deliveryNo: 'GH_001' }, lines: [] });
  for (const p of [packing, delivery]) {
    assert.deepEqual(p.info[1], ['Số HĐKT', contract.contractNo]);
    const html = print.slipSheetHtml(p);
    assert.ok(html.includes(contract.contractNo));
    assert.ok(!html.includes(order.orderNo));
  }
  assert.equal(packing.docNo, 'PK_001');
  assert.equal(delivery.docNo, 'GH_001');
});
test('phiếu từ trang Kho dùng contractNo trong thông tin đơn tối giản', () => {
  const o = { ...order, contractNo: contract.contractNo };
  for (const build of [print.packingPrintData, print.deliveryPrintData]) {
    const p = build({ seller: 'BN', order: o, lines: [] });
    assert.deepEqual(p.info[1], ['Số HĐKT', contract.contractNo]);
    assert.equal(p.docNo, contract.contractNo);
  }
});
test('đơn chưa có HĐKT vẫn hiện số đơn đặt hàng', () => {
  assert.deepEqual(print.orderReference(order), { label: 'Số ĐH', number: order.orderNo });
  for (const build of [print.packingPrintData, print.deliveryPrintData]) {
    const p = build({ seller: 'BN', order, lines: [] });
    assert.deepEqual(p.info[1], ['Số ĐH', order.orderNo]);
  }
  assert.equal(print.orderPrintData({ order, lines: [], contract }).orderNo, order.orderNo);
});

test('đơn đặt hàng: ghi chú, ngày hẹn giao và ba người ký dùng chung cho mẫu xem/in', () => {
  const note = 'Giao tại kho\nGọi trước 30 phút <không để ngoài trời>';
  const p = print.orderPrintData({ order: { ...order, orderDate: '2026-10-08', note, contact: 'Anh Hải', ownerName: 'Võ Huỳnh Mai' }, lines: [] }, 'Người đang tải');
  assert.equal(p.note, note); assert.equal(p.expectedDeliveryDate, '10/10/2026');
  assert.deepEqual(p.signers, ['Anh Hải', 'Võ Huỳnh Mai', 'Lê Minh Thái']);
  const html = print.orderSheetHtml(p, { edit: true });
  assert.match(html, /Ngày hẹn giao<\/span><b[^>]*>10\/10\/2026/);
  assert.ok(html.indexOf('Ngày đặt') < html.indexOf('Ngày hẹn giao'));
  assert.match(html, /Giao tại kho\nGọi trước 30 phút &lt;không để ngoài trời&gt;/);
  assert.match(html, /Người phê duyệt/); assert.doesNotMatch(html, /Người tiếp nhận|Người soạn|Người đang tải/);
  assert.equal((html.match(/data-f="signers\./g) ?? []).length, 3);
  assert.equal(print.orderPrintData({ order: { ...order, expectedDeliveryDate: null }, lines: [] }).expectedDeliveryDate, '');
});

test('Excel đơn đặt hàng giữ ghi chú và cùng ngày hẹn giao/ba chữ ký, cả hai chế độ giá', async () => {
  const g = globalThis as any, saved = { document: g.document, ExcelJS: g.ExcelJS };
  let cells = new Map<string, any>();
  class Workbook {
    xlsx = { writeBuffer: async () => new Uint8Array([1]) };
    addWorksheet() {
      cells = new Map();
      return { columns: [], mergeCells() {}, getColumn: (n: number) => ({ letter: String.fromCharCode(64 + n) }),
        getCell: (ref: string) => { if (!cells.has(ref)) cells.set(ref, {}); return cells.get(ref); } };
    }
  }
  g.ExcelJS = { Workbook };
  g.document = { body: { append() {} }, createElement: () => ({ click() {}, remove() {} }) };
  try {
    const p = print.orderPrintData({ order: { ...order, note: 'Ghi chú dòng 1\nDòng 2', ownerName: 'Nhân viên phụ trách' }, lines: [{ name: 'Bình', qty: 110, unitPrice: 255851.64, amount: 28143680.4 }] }, 'Người tải');
    for (const prices of [false, true]) {
      await print.downloadOrderExcel(p, { prices });
      const values = [...cells.values()].map(c => c.value);
      assert.ok(!values.includes(p.seller) && !values.includes(p.department));
      assert.equal(cells.get('A1')?.value,'ĐƠN ĐẶT HÀNG');
      if (prices) {
        const price = [...cells.values()].find(c => c.value === 255851.64);
        assert.ok(price); assert.equal(price.numFmt, '#,##0.## \"đ\"');
      }
      assert.ok(values.includes('Ngày hẹn giao')); assert.ok(values.includes('10/10/2026')); assert.ok(values.includes(p.note));
      assert.ok(values.includes('Người phê duyệt')); assert.ok(values.includes('Lê Minh Thái')); assert.ok(values.includes('Nhân viên phụ trách'));
      assert.ok(!values.includes('Người tiếp nhận') && !values.includes('Người soạn') && !values.includes('Người tải'));
      const deliveryLabel = [...cells.entries()].find(([, c]) => c.value === 'Ngày hẹn giao')![0];
      assert.equal(deliveryLabel.slice(-1), '6', 'ngày hẹn giao ở hàng ngay sau ngày đặt');
    }
  } finally { g.document = saved.document; g.ExcelJS = saved.ExcelJS; }
});

test('phiếu giao hàng: đại diện bên nhận trái, bên giao phải, để trống tên ký tay', () => {
  const p = print.deliveryPrintData({ seller: 'BN', order: { ...order, contact: 'Anh Hải' }, lines: [] }, 'Nhân viên lập phiếu');
  assert.deepEqual(print.SLIP_KINDS.delivery.signers, ['ĐẠI DIỆN BÊN NHẬN', 'ĐẠI DIỆN BÊN GIAO']);
  assert.deepEqual(p.names, ['', '']);
  for (const edit of [false, true]) {
    const html = print.slipSheetHtml(p, { edit });
    const signatures = html.slice(html.indexOf('<div class="ddh-sign'));
    assert.match(signatures, /ddh-delivery-sign/);
    assert.match(signatures, /<b>ĐẠI DIỆN BÊN NHẬN<\/b>[\s\S]*?<b>ĐẠI DIỆN BÊN GIAO<\/b>/);
    assert.doesNotMatch(signatures, /Người lập phiếu|Người phê duyệt|Nhân viên lập phiếu|Lê Minh Thái/);
    assert.equal((signatures.match(/class="space"/g) || []).length, 2);
    if (edit) for (const i of [0, 1]) assert.ok(signatures.includes(`data-f="names.${i}"></span>`));
  }
  assert.deepEqual(print.SLIP_KINDS.packing.signers, ['Người lập phiếu', 'Thủ kho', 'Người đóng gói', 'Người kiểm tra']);
});


test('phiếu giao hàng: ngày ký và tên người nhận để ghi tay, bỏ ngày giao ở đầu phiếu kể cả có HĐKT', () => {
  for (const k of [null, contract]) {
    const p = print.deliveryPrintData({ seller: 'BN', order: { ...order, contact: 'Mạnh', phone: '0900', taxCode: '123' }, contract: k, delivery: { deliveryNo: 'GH_001', plannedDate: '2026-10-12', receiverName: 'Tên người nhận chuyến', timeSlot: '9h–11h' }, lines: [] }, 'Người lập');
    assert.equal(p.signDate, print.deliverySignDate());
    assert.equal(p.names[0], '');
    assert.ok(!p.info.some(([label]: string[]) => label === 'Ngày giao'));
    assert.ok(p.info.some(([label, value]: string[]) => label === 'SĐT người giao' && value === ''));
    const html = print.slipSheetHtml(p, { edit: true });
    assert.doesNotMatch(html, /Ngày giao|12\/10\/2026/);
    assert.match(html, /data-f="names\.0"><\/span>/);
    assert.ok(html.includes(print.deliverySignDate()));
  }
  const packing = print.packingPrintData({ seller: 'BN', order, lines: [] });
  assert.ok(packing.info.some(([label]: string[]) => label === 'Ngày giao'));
  assert.notEqual(packing.signDate, 'Ngày …… Tháng …… Năm ……');
});

test('năm mặc định trên phiếu giao tính theo Việt Nam tại giao thừa, ngày/tháng để ghi tay',()=>{
  assert.equal(print.deliverySignDate(new Date('2026-12-31T16:59:59Z')),'Ngày …… Tháng …… Năm 2026');
  assert.equal(print.deliverySignDate(new Date('2026-12-31T17:00:00Z')),'Ngày …… Tháng …… Năm 2027');
});

test('Bản in đơn POS tách phí dịch vụ/ship, không cộng số lượng kho, tên phí được escape', () => {
  const p = print.orderPrintData({ order: { ...order, subtotal: 130000, tax: 8800, total: 138800, posFees: { service: { name: '<img src=x onerror=alert(1)>', amount: 10800, subtotal: 10000, taxRate: 8 }, shippingFee: 20000 } }, lines: [{ sku: '001', name: 'Ly', qty: 1, unitPrice: 100000, amount: 100000 }], contract: null });
  assert.equal(p.lines.length, 1);
  assert.equal(p.charges.length, 2);
  assert.equal(p.charges[1].taxRate, 0);
  const html = print.orderSheetHtml(p, { prices: true });
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('Phí ship (không VAT)'));
  assert.ok(html.includes('138.800'));
});


test('bản in đơn hiển thị 2 số lẻ đơn giá thay vì làm tròn trước khi nhân SL', () => {
  const p = print.orderPrintData({ order, lines: [{ name: 'Bình', qty: 110, unitPrice: 255851.64, amount: 28143680.4 }] });
  assert.match(print.orderSheetHtml(p, { prices: true }), /255\.851,64 đ/);
});

test('đơn POS nhiều phí: bản in tách đủ khoản, ship không VAT và tên độc hại được escape', () => {
  const p = print.orderPrintData({ order: { ...order, posFees: { services: [{ name: 'Phí in', amount: 21600, subtotal: 20000, taxRate: 8 }, { name: '<img src=x onerror=1>', amount: 5400, subtotal: 5000, taxRate: 8 }], shippingFee: 20000 } }, lines: [] });
  assert.deepEqual(p.charges, [{ name: 'Phí in', amount: 20000, taxRate: 8 }, { name: '<img src=x onerror=1>', amount: 5000, taxRate: 8 }, { name: 'Phí ship (không VAT)', amount: 20000, taxRate: 0 }]);
  const html = print.orderSheetHtml(p, { prices: true });
  assert.ok(html.includes('Phí in')); assert.ok(html.includes('&lt;img src=x onerror=1&gt;')); assert.ok(!html.includes('<img src=x onerror=1>'));
});


test('phiếu giao ưu tiên người nhận chuyến, rồi người nhận đơn, không ghép nhầm SĐT người mua; đổi ô người giao', () => {
  const base = { ...order, contact: 'Người mua', phone: '0901000001', receiverName: 'Người nhận', receiverPhone: '0902000002' };
  const make = (o: any, delivery: any = null) => print.deliveryPrintData({ seller: 'BN', order: o, delivery, lines: [] });
  const receiver = (p:any) => p.info.find(([label]:string[]) => label==='Người nhận')[1];
  assert.equal(receiver(make(base)), 'Người nhận · 0902000002');
  assert.equal(receiver(make(base,{receiverName:'Người nhận chuyến'})), 'Người nhận chuyến');
  assert.equal(receiver(make({...base,receiverName:'',receiverPhone:''})), 'Người mua · 0901000001');
  const p = make(base,{senderName:'Anh Giao',senderPhone:'0903000003'});
  assert.deepEqual(p.info.find(([label]:string[])=>label==='Người giao'),['Người giao','Anh Giao']);
  assert.deepEqual(p.info.find(([label]:string[])=>label==='SĐT người giao'),['SĐT người giao','0903000003']);
  assert.equal(p.info.some(([label]:string[])=>label==='MST'||label==='Thời gian'),false);
});


test('phiếu giao: tên sản phẩm và ghi chú có bề rộng cố định 24%/18%, mẫu đóng gói không đổi',()=>{
 const p=print.deliveryPrintData({seller:'BN',order,lines:[]});const html=print.slipSheetHtml(p);
 assert.match(html,/<th>Tên sản phẩm<\/th>/);assert.doesNotMatch(html,/<th>Chủng loại<\/th>/);
 assert.match(html,/<colgroup>.*width:24%.*width:18%.*<\/colgroup>/);
 const packed=print.slipSheetHtml(print.packingPrintData({seller:'BN',order,slip:{},lines:[]}));assert.doesNotMatch(packed,/<colgroup>/);
});

test('VIGIFTS: phiếu đóng gói, phiếu giao hàng, đơn đặt hàng dùng ảnh tiêu đề VIGIFTS; Bách Ngân giữ nguyên', () => {
  const order = { orderNo: 'DH1', customerName: 'Khách', address: 'HCM' };
  const vg = print.SELLERS.VG.short, bn = print.SELLERS.BN.short;
  for (const make of [print.packingPrintData, print.deliveryPrintData]) {
    const v = make({ seller: vg, order, lines: [] }), b = make({ seller: bn, order, lines: [] });
    assert.match(print.slipSheetHtml(v), /src="slip-letterhead-vigifts\.jpg"[^>]*width="1891" height="218"/);
    assert.match(print.slipSheetHtml(v), /class="slip-letterhead letterhead-vigifts"/);
    assert.match(print.slipSheetHtml(b), /src="slip-letterhead\.jpg"/);
    assert.doesNotMatch(print.slipSheetHtml(b), /vigifts/);
    v.seller = 'Tên sửa tay'; assert.match(print.slipSheetHtml(v), /slip-letterhead-vigifts\.jpg/);
  }
  const d = (o: Record<string, unknown>) => ({ order: { orderNo: 'DH1', customerName: 'K', ...o }, lines: [] });
  assert.match(print.orderSheetHtml(print.orderPrintData(d({ quoteType: 'VIGIFTS' }))), /slip-letterhead-vigifts\.jpg/);
  assert.doesNotMatch(print.orderSheetHtml(print.orderPrintData(d({}))), /slip-letterhead/);
});


test('mẫu xem/in không lặp tên công ty và bộ phận bên cạnh tiêu đề',()=>{
 const data={order:{...order,quoteType:'VIGIFTS'},lines:[]};
 const models=[print.orderPrintData(data),print.packingPrintData({seller:print.SELLERS.VG.short,order,lines:[]}),print.deliveryPrintData({seller:print.SELLERS.BN.short,order,lines:[]}),print.transferPrintData({transferNo:'TEST',status:'approved',lines:[]})];
 for(const [i,p] of models.entries())for(const edit of [false,true]){
  const html=i===0?print.orderSheetHtml(p,{edit}):print.slipSheetHtml(p,{edit});
  assert.doesNotMatch(html,/class="ddh-co"|data-f="seller"|data-f="department"|Phòng Kinh Doanh|CTY TNHH SX TM/);
  assert.match(html,/<div class="ddh-top"><h1>[^<]+<\/h1><\/div>/);
  assert.match(html,/class="slip-letterhead/);
 }
});
