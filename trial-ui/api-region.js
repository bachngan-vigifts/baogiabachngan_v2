// CHẠY EDGE CÙNG VÙNG VỚI CSDL. Supabase chạy Edge Function ở vùng gần người dùng (Việt Nam → ap-southeast-1), nhưng CSDL có thể
// ở vùng khác: mỗi truy vấn phải đi xa (đo thật: ~150–200 ms/truy vấn, một trang 10–16 truy vấn ≈ 2–3 giây).
// Máy chủ báo vùng CSDL trong Server-Timing (`dbregion`); từ lượt gọi sau, giao diện thêm ?forceFunctionRegion=<vùng> để Edge
// chạy cạnh CSDL – chỉ một chặng trình duyệt → máy chủ đi xa thay cho mỗi truy vấn.
//  - Nhớ vùng trong localStorage (chỉ là tên vùng, vd. "us-east-1") để lần mở app sau dùng ngay.
//  - Lượt gọi có ép vùng mà không tới được máy chủ của mình (lỗi mạng / không có Server-Timing): bỏ ép vùng, lần sau đi như cũ.
const KEY = 'bn-api-region', VALID = /^[a-z]{2}-[a-z]+-\d$/;
const dbRegionOf = header => /(?:^|,)\s*dbregion;desc="([^"]*)"/.exec(String(header || ''))?.[1] || '';

// TẠM TẮT (30/10/2026): nhân viên báo không truy cập được sau khi bật. Lượt ép vùng lỗi thì bỏ ép vùng, nhưng phản hồi
// kế tiếp lại có `dbregion` nên giao diện học lại và ép tiếp → cứ một lượt lại lỗi một lượt. Mặc định tắt và xoá vùng đã lưu;
// chỉ bật lại (enabled: true) sau khi kiểm chứng tham số chọn vùng với Supabase và chặn được việc học lại sau khi lỗi.
export const REGION_PINNING = false;
export function createApiRegion({ storage = () => globalThis.localStorage, enabled = REGION_PINNING } = {}) {
  let region = '';
  if (!enabled) {
    try { storage()?.removeItem(KEY); } catch { /* bỏ qua */ }
    return { url: url => ({ url, forced: '' }), observe() {}, failed() {}, current: () => '' };
  }
  try { region = storage()?.getItem(KEY) || ''; } catch { /* chế độ riêng tư */ }
  if (!VALID.test(region)) region = '';
  const save = next => { region = next; try { if (next) storage()?.setItem(KEY, next); else storage()?.removeItem(KEY); } catch { /* bỏ qua */ } };
  return {
    /** URL có ép vùng (nếu đã biết vùng CSDL) + vùng đã dùng. */
    url(url) { return region ? { url: url + (url.includes('?') ? '&' : '?') + 'forceFunctionRegion=' + region, forced: region } : { url, forced: '' }; },
    /** Sau mỗi phản hồi: học vùng CSDL; lượt ép vùng không tới máy chủ của mình → bỏ ép vùng. */
    observe(serverTiming, forced) {
      if (forced && !serverTiming) { if (region === forced) save(''); return; }
      const next = dbRegionOf(serverTiming);
      if (VALID.test(next) && next !== region) save(next);
    },
    /** Lỗi mạng ở lượt có ép vùng: bỏ ép vùng (có thể vùng đó không chạy được Edge). */
    failed(forced) { if (forced && region === forced) save(''); },
    current: () => region,
  };
}
