import { AppError } from '../errors.ts';

/**
 * Tải nội dung từ website NGOÀI theo link người dùng dán (tạo nhanh sản phẩm / tra MST) – chống SSRF:
 *  - chỉ HTTPS, không user:pass, không cổng riêng, không IP / localhost / tên nội bộ;
 *  - tên miền phải phân giải ra IP công khai (DNS-over-HTTPS Cloudflare), kiểm lại sau MỖI lần chuyển hướng (tối đa 3);
 *  - giới hạn thời gian và dung lượng; không gửi cookie / token của CRM.
 * Vẫn còn rủi ro DNS đổi giữa lúc kiểm và lúc tải (rebinding) – chấp nhận vì Edge Function không nằm trong mạng nội bộ.
 */
export type Fetcher = typeof fetch;
const dnsCache = new Map<string, number>();

export function publicHttpsUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(String(raw).trim()); } catch { throw new AppError(400, 'Link chưa đúng. Dán link đầy đủ bắt đầu bằng https://', 'LINK_INVALID'); }
  if (u.protocol !== 'https:') throw new AppError(400, 'Chỉ hỗ trợ link https://', 'LINK_INVALID');
  if (u.username || u.password || u.port || u.href.length > 2500) throw new AppError(400, 'Link không được chứa mật khẩu, cổng riêng hoặc quá dài.', 'LINK_INVALID');
  const host = u.hostname.toLowerCase();
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) || /^\d+(?:\.\d+){3}$/.test(host) || /(?:^|\.)(localhost|local|internal|intranet|lan|home|invalid|test|example|onion)$/.test(host))
    throw new AppError(400, 'Không hỗ trợ địa chỉ nội bộ hoặc địa chỉ IP.', 'LINK_INVALID');
  u.hash = '';
  return u;
}

export function isPublicIp(ip: string): boolean {
  if (ip.includes(':')) return /^[23][0-9a-f]{0,3}:/i.test(ip) && !/^2001:db8:/i.test(ip);
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = p as [number, number, number, number];
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2)
    || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
}

async function assertPublicHost(host: string, fetcher: Fetcher) {
  const at = dnsCache.get(host);
  if (at && Date.now() - at < 60_000) return;
  const answers = await Promise.all(['A', 'AAAA'].map(async type => {
    const u = new URL('https://cloudflare-dns.com/dns-query'); u.searchParams.set('name', host); u.searchParams.set('type', type);
    const r = await fetcher(u.href, { headers: { Accept: 'application/dns-json' }, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new AppError(502, 'Chưa xác minh được website (DNS). Thử lại sau.', 'LINK_DNS');
    const data = await r.json() as { Answer?: { type: number; data: string }[] };
    return (data.Answer || []).filter(x => x.type === 1 || x.type === 28).map(x => x.data);
  }));
  const ips = answers.flat();
  if (!ips.length) throw new AppError(400, 'Không tìm thấy website này.', 'LINK_DNS');
  if (!ips.every(isPublicIp)) throw new AppError(400, 'Website trỏ về địa chỉ nội bộ – không hỗ trợ.', 'LINK_INVALID');
  dnsCache.set(host, Date.now());
}

async function readCapped(response: Response, max: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new AppError(413, 'Dữ liệu website quá lớn.', 'LINK_TOO_LARGE'); }
    chunks.push(value);
  }
  const out = new Uint8Array(size); let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

/** GET một link công khai; trả URL cuối (sau chuyển hướng), header và bytes (đã giới hạn). */
export async function safeFetch(raw: string, o: { accept: string; max: number; fetcher?: Fetcher; timeoutMs?: number }) {
  const fetcher = o.fetcher ?? fetch;
  let url = publicHttpsUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicHost(url.hostname, fetcher);
    let response: Response;
    try {
      response = await fetcher(url.href, { headers: { Accept: o.accept, 'User-Agent': 'Mozilla/5.0 (compatible; VIGIFTS-CRM/1.0)' }, redirect: 'manual', signal: AbortSignal.timeout(o.timeoutMs ?? 12_000) });
    } catch (e) {
      throw new AppError(504, (e as Error)?.name === 'TimeoutError' ? 'Website phản hồi chậm. Thử lại sau.' : 'Chưa kết nối được website.', 'LINK_FETCH');
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => {});
      if (!location || hop === 3) throw new AppError(502, 'Website chuyển hướng quá nhiều lần.', 'LINK_FETCH');
      url = publicHttpsUrl(new URL(location, url).href);
      continue;
    }
    if (response.status === 403 || response.status === 429 || response.status === 503)
      { await response.body?.cancel().catch(() => {}); throw new AppError(502, 'Website chặn đọc tự động (chống bot) hoặc đang bận. Nhập tay hoặc thử link khác.', 'LINK_BLOCKED'); }
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new AppError(502, `Website phản hồi lỗi ${response.status}.`, 'LINK_FETCH'); }
    return { url, response, bytes: await readCapped(response, o.max) };
  }
  throw new AppError(502, 'Website chuyển hướng quá nhiều lần.', 'LINK_FETCH');
}
