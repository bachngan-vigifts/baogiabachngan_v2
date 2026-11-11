import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

class Element {
  children: Element[] = []; dataset: Record<string, string> = {}; value = ''; textContent = '';
  events = new Map<string, Function>();
  append(...els: Element[]) { this.children.push(...els); }
  addEventListener(event: string, fn: Function) { this.events.set(event, fn); }
  emit(event: string) { this.events.get(event)?.(); }
}
function setup(before?: (p: any) => void) {
  const source = readFileSync(new URL('../../trial-ui/order-print-form.js', import.meta.url), 'utf8');
  const context: any = { document: { createElement: () => new Element() } };
  runInNewContext(source.replace('export function initOrderPrintForm', 'globalThis.initOrderPrintForm = function'), context);
  const host = new Element(), data = { seller: 'BN', department: 'Kinh doanh', orderNo: 'DH_001', quoteNo: 'BG_001', customerName: 'Khách', customerCode: 'KH_1', taxCode: '123', contact: 'Anh Hải', orderDate: '12/10/2026', expectedDeliveryDate: '20/10/2026', address: 'Kho khách', note: 'Ghi chú gốc\nDòng 2', signDate: 'Ngày 12 Tháng 10 Năm 2026', signers: ['Hải', 'Nhân viên', 'Lê Minh Thái'], lines: [{ name: 'Sản phẩm' }] };
  let renders = 0;
  const form = context.initOrderPrintForm({ host, data, beforeUpdate: () => before?.(data), onUpdate: () => renders++ });
  const walk = (el: Element): Element[] => [el, ...el.children.flatMap(walk)];
  const controls = new Map(walk(host).filter(el => el.dataset.printField).map(el => [el.dataset.printField!, el]));
  return { data, controls, form, renders: () => renders, source };
}

test('form In/Tải đơn: điền thông tin và cập nhật bản xem, ghi chú/ba chữ ký dùng cùng snapshot', () => {
  const s = setup(); assert.equal(s.controls.size, 14);
  assert.equal(s.controls.has('seller'),false);assert.equal(s.controls.has('department'),false);
  assert.equal(s.controls.get('note')!.value, 'Ghi chú gốc\nDòng 2');
  const note = s.controls.get('note')!; note.value = 'Ghi chú mới\nGọi trước khi giao'; note.emit('input');
  assert.equal(s.data.note, note.value); assert.equal(s.renders(), 1);
  const signer = s.controls.get('signers.2')!; signer.value = 'Người phê duyệt khác'; signer.emit('input');
  assert.equal(s.data.signers[2], signer.value);
  assert.doesNotMatch(s.source, /innerHTML|localStorage|sessionStorage|fetch\(/);
});

test('form In/Tải: sửa trực tiếp trên phiếu và sửa form không ghi đè lẫn nhau trước xuất', () => {
  let paperNote = 'Ghi chú gốc\nDòng 2';
  const s = setup(p => { p.note = paperNote; p.lines[0].name = 'Tên sửa trên phiếu'; });
  const address = s.controls.get('address')!; address.value = 'Địa chỉ sửa trong form'; address.emit('input');
  assert.equal(s.data.address, 'Địa chỉ sửa trong form'); assert.equal(s.data.lines[0]!.name, 'Tên sửa trên phiếu');
  paperNote = 'Ghi chú sửa trực tiếp trên phiếu'; s.form.apply();
  assert.equal(s.data.note, paperNote, 'unchanged note input must not overwrite newer paper content');
  assert.equal(s.controls.get('note')!.value, paperNote);
  s.data.signers[0] = 'Tên người đặt sửa trên giấy'; s.form.sync();
  assert.equal(s.controls.get('signers.0')!.value, s.data.signers[0]);
});
