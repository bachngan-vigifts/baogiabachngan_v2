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

const { createRegionCanary }: any = await import(new URL('../../trial-ui/api-region.js', import.meta.url).href);
test('regional failures stay on fallback during the cooldown; a manager can enable immediately', () => {
  const store = memory(); let off = 0;
  const c = createRegionCanary({ storage: () => store, onDisabled: () => off++ });
  assert.deepEqual(c.headers(), { 'x-region': 'ap-northeast-2' }, 'mặc định gửi vùng của CSDL');
  assert.equal(c.byDefault(), true);
  assert.equal(store.getItem('bn-api-region-canary'), null, 'mặc định không lưu gì trên máy');
  c.observe('total;dur=1, region;desc="ap-northeast-2"', true); assert.equal(c.enabled(), true, 'phản hồi của máy chủ mình: giữ');
  c.observe(null, true); assert.equal(c.enabled(), false, 'thiếu Server-Timing: tắt'); assert.equal(off, 1);
  c.observe('total;dur=1, dbregion;desc="ap-northeast-2"', false); assert.equal(c.enabled(), false, 'không tự học / bật lại');
  assert.equal(createRegionCanary({ storage: () => store }).enabled(), false, 'mở app lần sau vẫn tắt trên máy này');
  c.enable(); assert.equal(c.enabled(), true, 'Manager bật lại');
  assert.equal(createRegionCanary({ storage: () => store }).enabled(), true, 'bật lại được nhớ');
  c.failed(true); assert.equal(c.enabled(), false); assert.equal(off, 2);
  assert.equal(createRegionCanary({ storage: () => store }).enabled(), false);
  c.enable('bad"value'); assert.equal(c.enabled(), false, 'vùng sai định dạng bị bỏ qua');
  c.failed(false); c.observe(null, false); assert.equal(off, 2, 'lượt không gửi header không tính');
});

test('legacy automatic off latch recovers, while new manual off survives reload and elapsed time', () => {
  const store = memory(); store.setItem('bn-api-region-off', '1');
  let clock = 100;
  const c = createRegionCanary({ storage: () => store, now: () => clock });
  assert.deepEqual(c.headers(), { 'x-region': 'ap-northeast-2' });
  c.disable(); clock += 86400000;
  assert.deepEqual(c.headers(), {});
  assert.deepEqual(createRegionCanary({ storage: () => store, now: () => clock }).headers(), {});
  c.enable(); assert.equal(store.getItem('bn-api-region-manual-off'), null);
  assert.deepEqual(c.headers(), { 'x-region': 'ap-northeast-2' });
});

test('only one GET probes after cooldown; writes and concurrent reads stay on fallback until verification', () => {
  const store = memory(); let clock = 100;
  let c = createRegionCanary({ storage: () => store, now: () => clock, retryMs: 1000 });
  c.failed('ap-northeast-2');
  clock = 1099; assert.deepEqual(c.headers(), {});
  c = createRegionCanary({ storage: () => store, now: () => clock, retryMs: 1000 });
  clock = 1100;
  assert.deepEqual(c.headers(false), {}, 'writes never probe');
  assert.deepEqual(c.headers(true), { 'x-region': 'ap-northeast-2' });
  assert.deepEqual(c.headers(true), {}, 'one outstanding probe');
  assert.deepEqual(c.headers(false), {});
  c.observe('total;dur=1, region;desc="ap-northeast-2"', 'ap-northeast-2');
  assert.deepEqual(c.headers(false), { 'x-region': 'ap-northeast-2' });
  assert.equal(store.getItem('bn-api-region-retry-at'), null);
  c.failed('ap-northeast-2'); clock += 1000;
  assert.deepEqual(c.headers(), { 'x-region': 'ap-northeast-2' });
  c.failed('ap-northeast-2');
  assert.deepEqual(c.headers(), {}, 'another failure starts another full cooldown');
  clock += 999; assert.deepEqual(c.headers(), {});
});

test('wrong-region responses do not validate a probe, and late responses cannot undo manual off', () => {
  let clock = 0;
  const c = createRegionCanary({ storage: () => memory(), now: () => clock, retryMs: 1000 });
  c.observe('total;dur=1, region;desc="ap-southeast-1"', 'ap-northeast-2');
  assert.equal(c.enabled(), false);
  clock = 1000; c.headers(); c.disable();
  c.observe('region;desc="ap-northeast-2"', 'ap-northeast-2');
  assert.equal(c.enabled(), false);
});

test('invalid or distant retry timestamps cannot strand a browser on fallback forever', () => {
  const store = memory(); let clock = 100;
  store.setItem('bn-api-region-retry-at', 'Infinity');
  assert.deepEqual(createRegionCanary({ storage: () => store }).headers(), { 'x-region': 'ap-northeast-2' });
  store.setItem('bn-api-region-retry-at', '9999999999999');
  const c = createRegionCanary({ storage: () => store, now: () => clock, retryMs: 1000, maxRetryMs: 1000 });
  assert.deepEqual(c.headers(), {}); clock = 1100;
  assert.deepEqual(c.headers(), { 'x-region': 'ap-northeast-2' });
});

test('công tắc tắt cho tất cả (REGION_DEFAULT_ON = false): mọi máy về máy chủ mặc định, xoá vùng / cờ đã lưu', () => {
  const store = memory(); store.setItem('bn-api-region-canary', 'ap-northeast-2'); store.setItem('bn-api-region-off', '1');
  const c = createRegionCanary({ storage: () => store, defaultOn: false });
  assert.deepEqual(c.headers(), {}); assert.equal(store.getItem('bn-api-region-canary'), null); assert.equal(store.getItem('bn-api-region-off'), null);
  c.enable(); assert.deepEqual(c.headers(), { 'x-region': 'ap-northeast-2' }, 'Manager vẫn bật thử được trên máy mình');
  assert.equal(createRegionCanary({ storage: () => store, defaultOn: false }).enabled(), false, 'đến lần mở app sau');
  assert.doesNotThrow(() => createRegionCanary({ storage: () => { throw Error('blocked'); } }).failed(true));
});

test('thời gian chờ tăng dần theo số lần lỗi liên tiếp (30 s → 5 phút), thành công là về 0; chỉ báo một lần mỗi đợt lỗi', () => {
  const store = memory(); let clock = 0, off = 0;
  const c = createRegionCanary({ storage: () => store, now: () => clock, onDisabled: () => off++ });
  const failAndWait = () => { c.failed('ap-northeast-2'); const { retryAt } = c.status(); const wait = retryAt - clock; clock = retryAt; assert.deepEqual(c.headers(), { 'x-region': 'ap-northeast-2' }, 'hết thời gian chờ thì dò lại'); return wait; };
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(failAndWait), [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
  assert.equal(off, 1, 'lượt dò thất bại không báo lại');
  c.observe('total;dur=1, region;desc="ap-northeast-2"', 'ap-northeast-2');
  assert.deepEqual(c.status(), { streak: 0, retryAt: 0, manual: false });
  assert.equal(store.getItem('bn-api-region-fail-streak'), null);
  c.failed('ap-northeast-2'); assert.equal(c.status().retryAt - clock, 30_000, 'đợt lỗi mới bắt đầu lại từ 30 s'); assert.equal(off, 2);
  assert.equal(createRegionCanary({ storage: () => store, now: () => clock }).status().streak, 1, 'số lần lỗi được nhớ qua lần mở app');
});

test('mạng có lại / quay lại tab: lượt đọc kế tiếp dò lại ngay; Manager tắt tay thì không', () => {
  const store = memory(); let clock = 0;
  const c = createRegionCanary({ storage: () => store, now: () => clock });
  c.failed('ap-northeast-2'); clock = 1000;
  assert.deepEqual(c.headers(), {}, 'đang chờ');
  c.wake();
  assert.deepEqual(c.headers(false), {}, 'lệnh ghi không dò');
  assert.deepEqual(c.headers(), { 'x-region': 'ap-northeast-2' }, 'dò lại ngay');
  const m = createRegionCanary({ storage: () => memory(), now: () => clock });
  m.disable(); m.wake(); assert.deepEqual(m.headers(), {}, 'tắt tay giữ tắt');
  const on = createRegionCanary({ storage: () => memory(), now: () => clock });
  on.wake(); assert.deepEqual(on.headers(), { 'x-region': 'ap-northeast-2' }, 'đang bật: không đổi gì');
});
