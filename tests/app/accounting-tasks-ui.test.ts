import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
class Element {
  children: Element[] = []; dataset: Record<string, string> = {}; attrs: Record<string, string> = {}; own = ''; className = ''; href = ''; events: Record<string, Function> = {};
  constructor(readonly tagName: string) {}
  set innerHTML(_: string) { throw new Error('Server data must never use innerHTML'); }
  set textContent(value: string) { this.own = String(value); this.children = []; }
  get textContent(): string { return this.own + this.children.map(e => e.textContent).join(' '); }
  append(...children: Element[]) { this.children.push(...children); }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  addEventListener(k: string, f: Function) { this.events[k] = f; }
}
function fixture() {
  const ctx: any = { document: { createElement: (tag: string) => new Element(tag) }, Intl, Date, URLSearchParams };
  vm.createContext(ctx); vm.runInContext(readFileSync(new URL('../../trial-ui/accounting-tasks.js', import.meta.url), 'utf8').replace(/export /g, ''), ctx);
  return ctx;
}
const nodes = (e: Element): Element[] => [e, ...e.children.flatMap(nodes)];
test('Kế toán UI: KPI lấy số API và banner ẩn khi rỗng, hiện số còn tồn và link đúng nguồn', () => {
  const c = fixture();
  const box: Element = c.accountingKpis({ kpis: { invoices: { count: 7, overdue: 2 }, purchases: { count: 3, amount: 1234567, overdue: 1 }, debts: { count: 4, amount: 9876543 }, unclaimed: 5 } });
  assert.equal(box.children.length, 4); assert.match(box.textContent, /1\.234\.567 đ/); assert.match(box.textContent, /9\.876\.543 đ/); assert.match(box.textContent, /3 kỳ/);
  assert.equal(c.accountingWarning([]), null);
  const alert: Element = c.accountingWarning([{ title: '<img onerror=alert(1)>', source: { kind: 'debt', docNo: 'ĐƠN-TEST', overdue: 1234, link: '#/orders/id-test', linkLabel: 'Mở đơn' } }]);
  assert.match(alert.textContent, /1 việc đã đóng tay/); assert.match(alert.textContent, /1\.234 đ/); assert.equal(nodes(alert).find(e => e.tagName === 'a')!.href, '#/orders/id-test');
});
test('Kế toán UI: đơn web không có link hiển thị nhãn/mã GHN, tên từ server chỉ là text; mobile giữ bảng 7 cột', () => {
  const c = fixture(), data = { today: '2026-10-20', tasks: [{ id: 'web', title: '<img src=x onerror=alert(1)>', due: 'today', dueDate: '2026-10-20', status: 'todo', priority: 'high', viewOnly: true, canClaim: false, sourceData: { kind: 'web', available: true, amount: 98765, docNo: 'WEB-TEST', ghnCode: 'GHN-TEST', link: 'javascript:alert(1)' } }] };
  const box: Element = c.accountingTable(data, () => {}, () => {});
  assert.match(box.textContent, /Không có link đơn/); assert.match(box.textContent, /GHN-TEST/); assert.match(box.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(nodes(box).some(e => e.tagName === 'img' || e.tagName === 'a'), false); assert.equal(nodes(box).some(e => e.tagName === 'button' && e.textContent === 'Nhận việc'), false);
  const mobile: Element = c.accountingTable(data, () => {}, () => {}, true);
  assert.equal(nodes(mobile).filter(e => e.tagName === 'thead')[0]!.children[0]!.children.length, 7);
});

test('cảnh báo dữ liệu nguồn: số thật, link NCC, trạng thái web, giờ Việt Nam; toàn bộ nội dung chỉ dùng DOM text', () => {
  const c = fixture();
  assert.equal(c.accountingSourceWarnings(), null);
  assert.equal(c.accountingSourceWarnings({ purchases: { count: 0 }, web: { count: 0 } }), null);
  const box: Element = c.accountingSourceWarnings({ purchases: { count: 2, orderCount: 1, orders: [{ docNo: '<img onerror=x>', missingPeriods: 2, link: '#/purchases/BUY', linkLabel: 'Bổ sung hạn trả' }] }, web: { count: 3, missingCode: 1, missingStatus: 1, delivered: 1, orders: [
    { docNo: 'WEB-1', source: 'lock', issue: 'missing_code', updatedAt: '2026-10-20T06:52:01' },
    { docNo: 'WEB-2', source: 'minhlong', issue: 'missing_status', ghnCode: '<script>x</script>', updatedAt: 'invalid' },
    { docNo: 'WEB-3', source: 'lock', issue: 'delivered', ghnCode: 'GHN-3', ghnStatus: 'delivered', updatedAt: '2026-10-20T06:52:01Z' },
  ] } });
  assert.match(box.textContent, /2 kỳ · 1 đơn mua/); assert.match(box.textContent, /Chưa có mã vận đơn/); assert.match(box.textContent, /Chưa nhận trạng thái GHN/); assert.match(box.textContent, /Đã giao thành công/);
  assert.match(box.textContent, /13:52/); assert.match(box.textContent, /Chưa có mốc cập nhật/); assert.match(box.textContent, /không phải thời điểm kiểm tra GHN/);
  assert.equal(nodes(box).filter(e => e.tagName === 'a').length, 1);
  assert.equal(nodes(box).find(e => e.tagName === 'a')!.href, '#/purchases/BUY');
  assert.equal(nodes(box).filter(e => e.tagName === 'details').length, 2);
  assert.equal(nodes(box).some(e => ['img', 'script'].includes(e.tagName)), false); assert.match(box.textContent, /<script>x<\/script>/);
});
