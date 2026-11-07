// CHẠY EDGE CÙNG VÙNG VỚI CSDL. Supabase chạy Edge Function ở vùng gần người dùng (Việt Nam → ap-southeast-1), nhưng CSDL có thể
// ở vùng khác: mỗi truy vấn phải đi xa (đo thật: ~150–200 ms/truy vấn, một trang 10–16 truy vấn ≈ 2–3 giây).
// Máy chủ báo vùng CSDL trong Server-Timing (`dbregion`); từ lượt gọi sau, giao diện thêm ?forceFunctionRegion=<vùng> để Edge
// chạy cạnh CSDL – chỉ một chặng trình duyệt → máy chủ đi xa thay cho mỗi truy vấn.
//  - Nhớ vùng trong localStorage (chỉ là tên vùng, vd. "us-east-1") để lần mở app sau dùng ngay.
//  - Lượt gọi có ép vùng mà không tới được máy chủ của mình (lỗi mạng / không có Server-Timing): bỏ ép vùng, lần sau đi như cũ.
const KEY = 'bn-api-region',
  VALID = /^[a-z]{2}-[a-z]+-\d$/;
const dbRegionOf = (header) =>
  /(?:^|,)\s*dbregion;desc="([^"]*)"/.exec(String(header || ''))?.[1] || '';

// TẠM TẮT (30/10/2026): nhân viên báo không truy cập được sau khi bật. Lượt ép vùng lỗi thì bỏ ép vùng, nhưng phản hồi
// kế tiếp lại có `dbregion` nên giao diện học lại và ép tiếp → cứ một lượt lại lỗi một lượt. Mặc định tắt và xoá vùng đã lưu;
// chỉ bật lại (enabled: true) sau khi kiểm chứng tham số chọn vùng với Supabase và chặn được việc học lại sau khi lỗi.
export const REGION_PINNING = false;
export function createApiRegion({
  storage = () => globalThis.localStorage,
  enabled = REGION_PINNING,
} = {}) {
  let region = '';
  if (!enabled) {
    try {
      storage()?.removeItem(KEY);
    } catch {
      /* bỏ qua */
    }
    return {
      url: (url) => ({ url, forced: '' }),
      observe() {},
      failed() {},
      current: () => '',
    };
  }
  try {
    region = storage()?.getItem(KEY) || '';
  } catch {
    /* chế độ riêng tư */
  }
  if (!VALID.test(region)) region = '';
  const save = (next) => {
    region = next;
    try {
      if (next) storage()?.setItem(KEY, next);
      else storage()?.removeItem(KEY);
    } catch {
      /* bỏ qua */
    }
  };
  return {
    /** URL có ép vùng (nếu đã biết vùng CSDL) + vùng đã dùng. */
    url(url) {
      return region
        ? {
            url:
              url +
              (url.includes('?') ? '&' : '?') +
              'forceFunctionRegion=' +
              region,
            forced: region,
          }
        : { url, forced: '' };
    },
    /** Sau mỗi phản hồi: học vùng CSDL; lượt ép vùng không tới máy chủ của mình → bỏ ép vùng. */
    observe(serverTiming, forced) {
      if (forced && !serverTiming) {
        if (region === forced) save('');
        return;
      }
      const next = dbRegionOf(serverTiming);
      if (VALID.test(next) && next !== region) save(next);
    },
    /** Lỗi mạng ở lượt có ép vùng: bỏ ép vùng (có thể vùng đó không chạy được Edge). */
    failed(forced) {
      if (forced && region === forced) save('');
    },
    current: () => region,
  };
}

// MÁY CHỦ CẠNH CSDL (header `x-region: <vùng>` để Supabase chạy Edge ở vùng của CSDL).
// Thử trên một máy (30/10/2026): trung vị 2,8 s → 0,83 s, máy chủ 2 s → 0,19 s, không lượt nào lỗi → BẬT MẶC ĐỊNH CHO MỌI MÁY.
// Đường dự phòng (máy chủ mặc định, CSDL ở xa) chậm hơn nhiều (log 07/11: ~4,3 s so với ~0,75 s), nên phải QUAY LẠI SỚM:
//  - Chỉ coi là lỗi vùng khi không tới được máy chủ của mình (lỗi mạng / quá giờ / 502–504 của cổng, không có Server-Timing).
//    Máy chủ của mình trả 5xx (vd. 503 CSDL đang bận – Server-Timing có đúng vùng): vẫn ở vùng này, đọc thử lại một lần tại chỗ.
//  - Thời gian chờ trước khi thử lại tăng dần theo số lần lỗi liên tiếp: 30 s → 1 → 2 → 4 → tối đa 5 phút; một lượt thành công là về 0.
//  - Mạng có lại / quay lại tab (wake): thử lại ngay ở lượt đọc kế tiếp, không chờ hết thời gian.
//  - Một lượt GET dò trước; lệnh ghi không bao giờ dò hay gửi lại. Manager tắt tay thì giữ tắt.
//  - CÔNG TẮC TẮT CHO TẤT CẢ: đổi REGION_DEFAULT_ON thành false rồi deploy. Khi tắt, mọi máy về máy chủ mặc định và vùng / cờ
//    đã lưu bị xoá; Manager vẫn bật thử được trên máy mình đến lần mở app sau.
const CANARY_KEY = 'bn-api-region-canary',
  OFF_KEY = 'bn-api-region-off';
const RETRY_KEY = 'bn-api-region-retry-at',
  MANUAL_KEY = 'bn-api-region-manual-off',
  STREAK_KEY = 'bn-api-region-fail-streak';
export const CANARY_REGION = 'ap-northeast-2';
export const REGION_DEFAULT_ON = true;
const regionOf = (serverTiming) => /(?:^|,)\s*region;desc="([^"]*)"/.exec(String(serverTiming || ''))?.[1] || '';
export function createRegionCanary({
  storage = () => globalThis.localStorage,
  onDisabled = () => {},
  defaultOn = REGION_DEFAULT_ON,
  now = () => Date.now(),
  retryMs = 30000,
  maxRetryMs = 300000,
} = {}) {
  let region = '',
    manual = false,
    retryAt = 0,
    streak = 0,
    probing = false;
  const store = (key, value) => {
    try {
      if (value) storage()?.setItem(key, value);
      else storage()?.removeItem(key);
    } catch {
      /* bỏ qua */
    }
  };
  if (defaultOn) {
    try {
      region = storage()?.getItem(CANARY_KEY) || '';
      manual = storage()?.getItem(MANUAL_KEY) === '1';
      const savedStreak = Number(storage()?.getItem(STREAK_KEY));
      streak = Number.isInteger(savedStreak) && savedStreak > 0 ? Math.min(savedStreak, 20) : 0;
      const savedRetry = Number(storage()?.getItem(RETRY_KEY));
      retryAt =
        Number.isFinite(savedRetry) && savedRetry > 0
          ? Math.min(savedRetry, now() + maxRetryMs)
          : 0;
      if (savedRetry !== retryAt)
        store(RETRY_KEY, retryAt ? String(retryAt) : '');
    } catch {
      /* chế độ riêng tư */
    }
    if (!VALID.test(region)) region = '';
    if (!region) region = CANARY_REGION;
    // The old unqualified off=1 latch could strand a browser in Singapore forever.
    // New explicit manual choices are separate; network failures carry a bounded retry time.
    if (manual || retryAt) region = '';
    else store(OFF_KEY, '');
  } else {
    store(CANARY_KEY, '');
    store(OFF_KEY, '');
    store(RETRY_KEY, '');
    store(MANUAL_KEY, '');
    store(STREAK_KEY, '');
  }
  const recovered = () => {
    probing = false;
    retryAt = 0;
    streak = 0;
    store(RETRY_KEY, '');
    store(OFF_KEY, '');
    store(STREAK_KEY, '');
  };
  const turnOff = () => {
    const first = streak === 0;
    region = '';
    probing = false;
    streak = Math.min(streak + 1, 20);
    retryAt = now() + Math.min(maxRetryMs, retryMs * 2 ** (streak - 1));
    store(CANARY_KEY, '');
    store(OFF_KEY, '1');
    store(RETRY_KEY, String(retryAt));
    store(STREAK_KEY, String(streak));
    // Chỉ báo một lần cho mỗi đợt lỗi (lượt dò lại thất bại không báo lại).
    if (first) onDisabled();
  };
  const relevant = (sent) =>
    !!sent && !!region && (typeof sent !== 'string' || sent === region);
  return {
    /** Header thêm vào lời gọi API (rỗng khi tắt). */
    headers(read = true) {
      if (
        !region &&
        defaultOn &&
        !manual &&
        retryAt &&
        now() >= retryAt &&
        read
      ) {
        region = CANARY_REGION;
        probing = true;
        return { 'x-region': region };
      }
      return region && !probing ? { 'x-region': region } : {};
    },
    enabled: () => !!region,
    current: () => region,
    /** Đang bật mặc định cho mọi máy (công tắc trong code). */
    byDefault: () => defaultOn,
    /** Số lần lỗi liên tiếp và thời điểm thử lại (trang Đo tốc độ). */
    status: () => ({ streak, retryAt, manual }),
    /** Mạng có lại / quay lại tab: cho lượt đọc kế tiếp dò lại ngay (không áp dụng khi Manager tắt tay). */
    wake() {
      if (!defaultOn || manual || region || !retryAt || now() >= retryAt) return;
      retryAt = now();
      store(RETRY_KEY, String(retryAt));
    },
    enable(next = CANARY_REGION) {
      if (!VALID.test(next)) return;
      region = next;
      manual = false;
      recovered();
      store(MANUAL_KEY, '');
      store(CANARY_KEY, next);
    },
    disable() {
      region = '';
      probing = false;
      retryAt = 0;
      streak = 0;
      manual = true;
      store(CANARY_KEY, '');
      store(OFF_KEY, '1');
      store(RETRY_KEY, '');
      store(STREAK_KEY, '');
      store(MANUAL_KEY, '1');
    },
    /** A probe succeeds only when the response reaches our application in the requested region. */
    observe(serverTiming, sent) {
      if (!relevant(sent)) return;
      if (!serverTiming) {
        turnOff();
        return;
      }
      const actual = regionOf(serverTiming);
      if (actual && actual !== region) {
        turnOff();
        return;
      }
      recovered();
    },
    /** Lỗi mạng ở lượt có header → tắt tạm, thử lại sau thời gian chờ tăng dần. */
    failed(sent) {
      if (relevant(sent)) turnOff();
    },
  };
}

/** Phản hồi do chính máy chủ của mình trả ở đúng vùng đã yêu cầu (có Server-Timing `region` khớp). */
const fromOurRegion = (response, sent) => !!sent && regionOf(response.headers?.get('server-timing')) === sent;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Regional reads get one bounded attempt before the ordinary fallback. Writes are never resent.
 * Our own 5xx from the requested region (e.g. 503 DB busy) is not a routing failure: reads retry once in the same region.
 */
export async function requestWithRegion(canary, send, { read = true, delay = wait } = {}) {
  const headers = canary.headers(read),
    sent = headers['x-region'] || '';
  const policy = sent && read ? { readRetries: 0, timeoutMs: 8000 } : undefined;
  let response;
  try {
    response = await send(headers, policy);
  } catch (error) {
    canary.failed(sent);
    if (!sent || !read) throw error;
    return send({});
  }
  if (sent && [502, 503, 504].includes(response.status)) {
    if (fromOurRegion(response, sent)) {
      canary.observe(response.headers.get('server-timing'), sent);
      if (!read) return response;
      const after = Number(response.headers.get('retry-after')) || 0;
      await response.body?.cancel().catch(() => {});
      await delay(Math.min(2000, Math.max(500, after * 1000)));
      let again;
      try {
        again = await send(headers, policy);
      } catch {
        canary.failed(sent);
        return send({});
      }
      if (!fromOurRegion(again, sent) && [502, 503, 504].includes(again.status)) {
        canary.failed(sent);
        await again.body?.cancel().catch(() => {});
        return send({});
      }
      canary.observe(again.headers?.get('server-timing'), sent);
      return again;
    }
    canary.failed(sent);
    if (read) {
      await response.body?.cancel().catch(() => {});
      return send({});
    }
  }
  canary.observe(response.headers?.get('server-timing'), sent);
  return response;
}
