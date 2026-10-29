import { test } from 'node:test';
import assert from 'node:assert/strict';
// Module trình duyệt (JS thuần) – nạp qua URL để TypeScript không đòi khai báo kiểu.
const { keyFor, settleKey, sendOnce, resetRequestKeys }: any = await import(new URL('../../trial-ui/request-keys.js', import.meta.url).href);

/** sessionStorage giả: lưu chuỗi như trình duyệt (tải lại trang = nạp lại từ đây). */
const fakeStorage = () => { const m = new Map<string, string>(); return () => ({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }); };

test('mạng rớt sau khi máy chủ đã lưu: mở lại nhập y hệt dùng lại mã cũ (cả khi tải lại trang); khác nội dung → mã mới', async () => {
  const storage = fakeStorage(), pay = { orderId: 'o1', amount: 500000, method: 'transfer', paidAt: '2026-10-29' };
  const sent: string[] = [];
  await assert.rejects(sendOnce('payment', pay, async (key: string) => { sent.push(key); throw new Error('mạng rớt'); }, storage));
  resetRequestKeys(); // tải lại trang
  await sendOnce('payment', { ...pay }, async (key: string) => { sent.push(key); return { id: 'p1' }; }, storage);
  assert.equal(sent[0], sent[1], 'gửi lại cùng mã → máy chủ trả phiếu đã lưu, không ghi thu lần hai');
  assert.notEqual(keyFor('payment', { ...pay, amount: 400000 }, storage), sent[0], 'số tiền khác → mã khác');
});

test('đã thành công thì lần nhập y hệt sau là phiếu mới (hai kỳ cùng số tiền vẫn ghi được)', async () => {
  const storage = fakeStorage(), pay = { orderId: 'o2', amount: 100 };
  const first = await sendOnce('payment', pay, async (key: string) => key, storage);
  const second = await sendOnce('payment', pay, async (key: string) => key, storage);
  assert.notEqual(first, second);
  const k = keyFor('cash-entry', { amount: 1 }, storage); settleKey('cash-entry', { amount: 1 }, storage);
  assert.notEqual(keyFor('cash-entry', { amount: 1 }, storage), k);
});
