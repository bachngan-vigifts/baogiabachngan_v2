// Thử demo như người dùng thật: nạp file HTML đã đóng gói vào jsdom rồi bấm qua các luồng chính.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('./dist/demo.html', import.meta.url), 'utf8');
function open() {
  const errors = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://demo.test/', pretendToBeVisual: true,
    beforeParse(w) { w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = () => {}; w.addEventListener('error', e => errors.push(e.message)); } });
  const w = dom.window, d = w.document;
  const $ = (s, r = d) => r.querySelector(s), $$ = (s, r = d) => [...r.querySelectorAll(s)];
  const click = el => { assert.ok(el, 'không tìm thấy phần tử để bấm'); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); };
  const byText = (sel, text, r = d) => $$(sel, r).find(e => e.textContent.trim().startsWith(text));
  const as = name => click($$('.chip').find(c => c.querySelector('span').firstChild.textContent === name));
  const tab = name => click(byText('.tabs button', name));
  const set = (name, v, r = d) => { const el = $(`[name="${name}"]`, r); assert.ok(el, 'thiếu ô ' + name); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const submit = (form = $('form')) => form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const sheet = () => $('.sheet'), text = () => d.getElementById('app').textContent.replace(/\s+/g, ' ');
  const state = () => w.__demo.state;
  return { w, d, $, $$, click, byText, as, tab, set, submit, sheet, text, errors, state };
}

test('nạp trang không lỗi, có đủ 6 tài khoản thử và dữ liệu mẫu', () => {
  const a = open();
  assert.deepEqual(a.errors, []);
  assert.equal(a.$$('.chip').length, 6);
  assert.match(a.text(), /Bản demo thao tác thử/);
  assert.equal(a.$$('.card').length, 2); // An: BG-0001 (của mình) và BG-0003 (là chủ, đã giao Bình)
});

test('QUYỀN XEM BÁO GIÁ: mỗi người chỉ thấy phần của mình; Manager thấy tất cả; NCC không có tab Báo giá', () => {
  const a = open(); const codes = () => a.$$('.card b').map(e => e.textContent).sort();
  assert.deepEqual(codes(), ['BG-0001', 'BG-0003']);       // An
  a.as('Bình'); assert.deepEqual(codes(), ['BG-0002', 'BG-0003']);   // Bình: của mình + được giao phụ trách
  a.as('Chi'); assert.deepEqual(codes(), ['BG-0002']);   // Chi (Kế toán): chỉ báo giá được chia sẻ cho chức vụ Kế toán
  a.as('Lan'); assert.deepEqual(codes(), ['BG-0001', 'BG-0002', 'BG-0003']);
  a.as('Minh Long'); assert.equal(a.byText('.tabs button', 'Báo giá'), undefined);
  assert.deepEqual(a.errors, []);
});

test('TẠO BÁO GIÁ: lỗi nhập liệu hiện thông báo thật của hệ thống; sửa đúng thì lưu được và tổng tiền đúng', () => {
  const a = open();
  a.click(a.byText('button', 'Báo giá mới'));
  assert.ok(a.sheet());
  assert.match(a.$('#live').textContent, /Tổng cộng/);
  a.set('customer', 'Công ty Test');
  a.set('vat', '150'); a.submit();
  assert.match(a.sheet().textContent, /Số liệu báo giá không hợp lệ/);
  a.set('vat', 'abc'); assert.match(a.$('#live').textContent, /chờ số hợp lệ/); a.submit();
  assert.match(a.sheet().textContent, /Số liệu báo giá không hợp lệ/);
  a.set('vat', '8'); a.set('quoteNo', ''); a.submit();
  assert.match(a.sheet().textContent, /Vui lòng nhập số báo giá/);
  a.set('quoteNo', 'BG-9999'); a.set('qty_0', '10'); a.set('price_0', '100000'); a.set('disc_0', '10'); a.set('fee_0', '0'); a.set('cost_0', '50000');
  a.submit();
  // 10 × 100.000 × 0,9 = 900.000; VAT 8% = 72.000; tổng 972.000
  assert.match(a.sheet().textContent, /BG-9999/); assert.match(a.sheet().textContent, /972\.000 ₫/);
  assert.match(a.sheet().textContent, /Lợi nhuận gộp/);
  assert.equal(a.state().quotes[0].creatorId, 'an');
  assert.deepEqual(a.errors, []);
});

test('CHIA SẺ: nhân viên được chia sẻ xem được; quyền "chỉ xem" thì không sửa được; người nhận không chia sẻ tiếp được', () => {
  const a = open();
  a.click(a.byText('.card', 'BG-0001')); a.click(a.byText('.sheet button', 'Chia sẻ'));
  a.set('target', 'binh'); a.set('permission', 'view'); a.submit();
  assert.match(a.sheet().textContent, /Chia sẻ cho Bình: chỉ xem/);
  a.click(a.$('.x')); // đóng
  a.as('Bình'); a.click(a.byText('.card', 'BG-0001'));
  assert.match(a.sheet().textContent, /Được chia sẻ|Bạn chỉ được xem báo giá này/);
  assert.equal(a.byText('.sheet button', 'Sửa').disabled, true);
  assert.equal(a.byText('.sheet button', 'Chia sẻ').disabled, true);
  assert.doesNotMatch(a.sheet().textContent, /Giá vốn/); // không sửa được → ẩn giá vốn và lợi nhuận
});

test('NCC không nằm trong danh sách chia sẻ hay giao phụ trách', () => {
  const a = open();
  a.click(a.byText('.card', 'BG-0001')); a.click(a.byText('.sheet button', 'Chia sẻ'));
  assert.ok(!a.$$('select[name=target] option').some(o => /NCC|Minh Long|Gốm Việt/.test(o.textContent)));
  a.click(a.$('.x')); a.click(a.byText('.card', 'BG-0001')); a.click(a.byText('.sheet button', 'Đổi người phụ trách'));
  assert.ok(!a.$$('select[name=to] option').some(o => /Minh Long|Gốm Việt/.test(o.textContent)));
});

test('NGƯỜI PHỤ TRÁCH ĐƯỢC ƯU TIÊN: chủ chưa giao thì giao được; đã giao thì chủ không đổi được, Manager đổi được', () => {
  const a = open();
  // BG-0003: An là chủ, đã giao Bình → An không đổi được
  a.click(a.byText('.card', 'BG-0003'));
  assert.equal(a.byText('.sheet button', 'Đổi người phụ trách').disabled, true);
  assert.match(a.sheet().textContent, /Đã giao Bình phụ trách — chỉ Manager đổi được/);
  assert.equal(a.byText('.sheet button', 'Sửa').disabled, false); // chủ vẫn sửa được
  // BG-0001 chưa giao → An giao cho Chi
  a.click(a.$('.x')); a.click(a.byText('.card', 'BG-0001')); a.click(a.byText('.sheet button', 'Đổi người phụ trách'));
  a.set('to', 'chi'); a.submit();
  assert.match(a.sheet().textContent, /Người phụ trách: Chi/);
  assert.equal(a.byText('.sheet button', 'Đổi người phụ trách').disabled, true); // đã giao → An không đè lên được
  // Manager đổi lại được
  a.click(a.$('.x')); a.as('Lan'); a.click(a.byText('.card', 'BG-0001'));
  assert.equal(a.byText('.sheet button', 'Đổi người phụ trách').disabled, false);
  a.click(a.byText('.sheet button', 'Đổi người phụ trách')); a.set('to', 'binh'); a.submit();
  assert.match(a.sheet().textContent, /Người phụ trách: Bình/); assert.match(a.sheet().textContent, /Lan: đổi người phụ trách từ Chi sang Bình/);
  // Chi (người phụ trách cũ) mất quyền; Bình thấy và sửa được
  a.click(a.$('.x')); a.as('Chi'); assert.ok(!a.byText('.card', 'BG-0001'));
  a.as('Bình'); a.click(a.byText('.card', 'BG-0001')); assert.equal(a.byText('.sheet button', 'Sửa').disabled, false);
  assert.deepEqual(a.errors, []);
});

test('ĐƠN NCC – NCC khác không thấy đơn của nhau; nhân viên thấy nhưng bị ẩn giá', () => {
  const a = open(); a.tab('Đơn NCC');
  assert.match(a.text(), /Giá ẩn/);                       // An (nhân viên)
  a.as('Minh Long'); assert.deepEqual(a.$$('.card b').map(e => e.textContent), ['PO-2610-02']);   // đơn đã duyệt của Minh Long (đơn chờ duyệt chưa hiện)
  assert.doesNotMatch(a.text(), /PO-2610-03/);
  a.as('Gốm Việt'); assert.deepEqual(a.$$('.card b').map(e => e.textContent), ['PO-2610-03']);
  a.as('Lan'); assert.match(a.text(), /Chờ bạn duyệt/); assert.match(a.text(), /PO-2610-01/);
});

test('LUỒNG ĐƠN NCC từ đầu đến cuối với đúng người đúng việc, kèm các lỗi dữ liệu', () => {
  const a = open(); a.tab('Đơn NCC');
  const stage = id => a.state().orders.find(o => o.id === id);
  // Manager duyệt đơn chờ duyệt
  a.as('Lan'); a.click(a.byText('.card', 'PO-2610-01'));
  assert.deepEqual(a.$$('.sheet .actions button').map(b => b.textContent), ['Duyệt đơn']);
  a.click(a.byText('.sheet button', 'Duyệt đơn'));
  a.set('email', 'sai-email'); a.set('d_0', '10'); a.set('d_1', '10'); a.submit();
  assert.match(a.sheet().textContent, /Thông tin phê duyệt đơn hàng không hợp lệ/);
  a.set('email', 'dathang@minhlong.example'); a.set('d_0', '101'); a.submit();
  assert.match(a.sheet().textContent, /Chiết khấu từng mã phải từ 0 đến 100%/);
  a.set('d_0', '12'); a.set('d_1', '8'); a.submit();
  assert.equal(stage('o1').approvalStatus, 'approved');
  // NCC Minh Long: chưa ký thì chưa xác nhận được
  a.click(a.$('.x')); a.as('Minh Long'); a.click(a.byText('.card', 'PO-2610-01'));
  assert.ok(!a.byText('.sheet button', 'Xác nhận đơn'));
  a.click(a.byText('.sheet button', 'Tải bản ký'));
  a.set('mime', 'application/zip'); a.submit(); assert.match(a.sheet().textContent, /Chỉ upload ảnh hoặc file PDF/);
  a.set('mime', 'application/pdf'); a.set('mb', '7'); a.submit(); assert.match(a.sheet().textContent, /tối đa 6MB/);
  a.set('mb', '0.4'); a.submit();
  // Xác nhận: sai ngày, sai SL, rồi đổi ngày hẹn hợp lệ → ghi lại thay đổi
  a.click(a.byText('.sheet button', 'Xác nhận đơn'));
  a.set('date_0', '2026-02-31'); a.submit(); assert.match(a.sheet().textContent, /tick xác nhận CK, SL và ngày hẹn giao/);
  a.set('date_0', '2026-11-05'); a.set('q_0', '99'); a.submit(); assert.match(a.sheet().textContent, /không khớp đơn đã gửi NCC/);
  a.set('q_0', '100'); a.submit();
  assert.ok(stage('o1').confirmedAt); assert.equal(stage('o1').dateChanges.length, 1);
  assert.match(a.sheet().textContent, /NCC đổi ngày hẹn/);
  // Không còn xoá/thay bản ký (luật mặc định)
  assert.ok(!a.byText('.sheet button', 'Xoá bản ký')); assert.ok(!a.byText('.sheet button', 'Tải bản ký'));
  // Yêu cầu cọc; Manager ghi nhận cọc
  a.click(a.byText('.sheet button', 'Yêu cầu cọc')); a.set('rate', '40'); a.submit();
  assert.equal(stage('o1').depositRate, 40);
  a.click(a.$('.x')); a.as('Lan'); a.click(a.byText('.card', 'PO-2610-01'));
  a.click(a.byText('.sheet button', 'Ghi nhận cọc')); a.submit(); assert.ok(stage('o1').depositPaidAt);
  assert.match(a.sheet().textContent, /Còn lại/);
  // NCC báo sẵn sàng giao một phần, quá số lượng bị từ chối
  a.click(a.$('.x')); a.as('Minh Long'); a.click(a.byText('.card', 'PO-2610-01')); a.click(a.byText('.sheet button', 'Báo sẵn sàng giao'));
  a.set('mode', 'partial'); a.set('p_0', '101'); a.submit(); assert.match(a.sheet().textContent, /không vượt quá số lượng trong đơn/);
  a.set('p_0', '40'); a.submit(); assert.equal(stage('o1').ready.mode, 'partial');
  // Manager nhập kho → NCC bị khoá thao tác
  a.click(a.$('.x')); a.as('Lan'); a.click(a.byText('.card', 'PO-2610-01')); a.click(a.byText('.sheet button', 'Nhập kho')); a.submit();
  assert.ok(stage('o1').receivedAt); assert.match(a.sheet().textContent, /Đã nhập kho/);
  a.click(a.$('.x')); a.as('Minh Long'); a.click(a.byText('.card', 'PO-2610-01'));
  assert.deepEqual(a.$$('.sheet .actions button').map(b => b.textContent), ['Nhập số phiếu NCC']); // chỉ còn sửa số phiếu nội bộ
  assert.deepEqual(a.errors, []);
});

test('LUẬT SIẾT CHẶT tắt/bật được và có hiệu lực ngay', () => {
  const a = open(); a.as('Gốm Việt'); a.tab('Đơn NCC'); a.click(a.byText('.card', 'PO-2610-03'));
  assert.ok(!a.byText('.sheet button', 'Xoá bản ký'));       // đã xác nhận → khoá bản ký
  a.click(a.$('.x')); a.tab('Quyền'); a.click(a.$('input[data-k=lockSignatureAfterConfirm]'));
  a.tab('Đơn NCC'); a.click(a.byText('.card', 'PO-2610-03'));
  assert.ok(a.byText('.sheet button', 'Xoá bản ký'));        // tắt luật → xoá được
});

test('TAB QUYỀN: liệt kê đúng khu vực được/bị chặn; NCC bị chặn khu vực nghiệp vụ; đặt lại dữ liệu mẫu hoạt động', () => {
  const a = open(); a.as('Gốm Việt'); a.tab('Quyền');
  const row = t => a.byText('.areas li', '', a.d) && a.$$('.areas li').find(li => li.textContent.includes(t)).className;
  assert.equal(row('Báo giá, khách hàng, sản phẩm'), 'no'); assert.equal(row('Cổng NCC'), 'yes'); assert.equal(row('Quản trị nhân viên'), 'no');
  a.as('Lan'); a.tab('Quyền'); assert.equal(row('Quản trị nhân viên'), 'yes');
  a.click(a.byText('button', 'Đặt lại dữ liệu mẫu')); assert.match(a.text(), /Đã đặt lại/);
});

test('dữ liệu được nhớ lại khi tải lại trang (localStorage) và an toàn với dữ liệu hỏng', () => {
  const a = open(); a.click(a.byText('.card', 'BG-0001')); a.click(a.byText('.sheet button', 'Chia sẻ')); a.set('target', 'chi'); a.submit();
  const saved = a.w.localStorage.getItem('bn-demo-v1'); assert.ok(saved);
  const b = new JSDOM(html, { runScripts: 'dangerously', url: 'https://demo.test/', beforeParse(w) { w.scrollTo = () => {}; w.localStorage.setItem('bn-demo-v1', saved); } });
  assert.equal(JSON.parse(b.window.localStorage.getItem('bn-demo-v1')).quotes[0].shares.length, 1);
  const c = new JSDOM(html, { runScripts: 'dangerously', url: 'https://demo.test/', beforeParse(w) { w.scrollTo = () => {}; w.localStorage.setItem('bn-demo-v1', '{hỏng'); } });
  assert.equal(c.window.document.querySelectorAll('.chip').length, 6); // vẫn chạy với dữ liệu mẫu
});

test('chống chèn mã: tên khách có thẻ HTML được hiển thị như chữ, không chạy', () => {
  const a = open(); a.click(a.byText('button', 'Báo giá mới'));
  a.set('customer', '<img src=x onerror="window.__xss=1"><b>đậm</b>'); a.submit();
  assert.equal(a.w.__xss, undefined); assert.equal(a.$('.sheet img'), null);
  assert.match(a.sheet().textContent, /<img src=x/);
});

test('lỗi nhập liệu KHÔNG làm mất dữ liệu đã gõ (form giữ nguyên, lỗi hiện tại chỗ)', () => {
  const a = open(); a.click(a.byText('button', 'Báo giá mới'));
  a.set('customer', 'Khách đã gõ dở'); a.set('vat', '999'); a.set('price_0', '123456'); a.submit();
  assert.match(a.sheet().textContent, /Số liệu báo giá không hợp lệ/);
  assert.equal(a.$('[name=customer]').value, 'Khách đã gõ dở'); assert.equal(a.$('[name=price_0]').value, '123456'); assert.equal(a.$('[name=vat]').value, '999');
  a.set('vat', '1000'); a.submit(); assert.equal(a.$$('.err').length, 1); // lỗi mới thay lỗi cũ, không chồng lên nhau
  a.set('vat', '8'); a.submit(); assert.match(a.sheet().textContent, /Lợi nhuận gộp/);
  // đơn NCC: cũng giữ dữ liệu
  a.click(a.$('.x')); a.as('Gốm Việt'); a.tab('Đơn NCC'); a.click(a.byText('.card', 'PO-2610-03')); a.click(a.byText('.sheet button', 'Báo sẵn sàng giao'));
  a.set('date', 'rác'); a.set('mode', 'partial'); a.submit();
  assert.equal(a.$('[name=date]').value, 'rác'); assert.equal(a.$('[name=mode]').value, 'partial');
});
