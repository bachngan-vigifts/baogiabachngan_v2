import { test } from 'node:test';
import assert from 'node:assert/strict';
// Module trình duyệt (JS thuần) – nạp qua URL để TypeScript không đòi khai báo kiểu.
const { createApiRegion }: any = await import(new URL('../../trial-ui/api-region.js', import.meta.url).href);

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k), m }; };
const API = 'https://ref.supabase.co/functions/v1/baogia-v2-api/api/staff';

test('học vùng CSDL từ Server-Timing rồi ép Edge chạy cùng vùng ở các lượt sau; nhớ qua lần mở app', () => {
  const store = memory(), r = createApiRegion({ storage: () => store, enabled: true });
  assert.deepEqual(r.url(API + '/orders?q=a'), { url: API + '/orders?q=a', forced: '' }, 'chưa biết vùng: đi như cũ');
  r.observe('db;dur=850, app;dur=900;desc="9 queries", total;dur=1800, region;desc="ap-southeast-1", dbregion;desc="us-east-1"', '');
  assert.deepEqual(r.url(API + '/orders?q=a'), { url: API + '/orders?q=a&forceFunctionRegion=us-east-1', forced: 'us-east-1' });
  assert.equal(r.url(API + '/me').url, API + '/me?forceFunctionRegion=us-east-1');
  assert.equal(createApiRegion({ storage: () => store, enabled: true }).current(), 'us-east-1', 'mở app lần sau dùng ngay');
});

test('không tin giá trị lạ; lượt ép vùng không tới máy chủ của mình (lỗi mạng / thiếu Server-Timing) thì bỏ ép vùng', () => {
  const store = memory();
  store.setItem('bn-api-region', 'us-east-1"><x');
  const r = createApiRegion({ storage: () => store, enabled: true });
  assert.equal(r.current(), '', 'giá trị lưu sai định dạng bị bỏ');
  r.observe('total;dur=1, dbregion;desc="../evil"', ''); assert.equal(r.current(), '');
  r.observe('total;dur=1, dbregion;desc="eu-central-1"', ''); assert.equal(r.current(), 'eu-central-1');
  r.observe(null, 'eu-central-1'); assert.equal(r.current(), '', 'phản hồi không có Server-Timing khi ép vùng');
  r.observe('total;dur=1, dbregion;desc="eu-central-1"', ''); r.failed('eu-central-1');
  assert.equal(r.current(), ''); assert.equal(store.getItem('bn-api-region'), null);
  assert.doesNotThrow(() => createApiRegion({ storage: () => { throw Error('blocked'); }, enabled: true }).observe('dbregion;desc="us-east-1"', ''));
});

test('mặc định TẮT ép vùng (sự cố 30/10): không thêm tham số, xoá vùng đã lưu trên máy', () => {
  const store = memory(); store.setItem('bn-api-region', 'us-east-1');
  const r = createApiRegion({ storage: () => store });
  assert.deepEqual(r.url(API + '/me'), { url: API + '/me', forced: '' });
  r.observe('total;dur=1, dbregion;desc="us-east-1"', '');
  assert.deepEqual(r.url(API + '/me'), { url: API + '/me', forced: '' });
  assert.equal(store.getItem('bn-api-region'), null);
});
