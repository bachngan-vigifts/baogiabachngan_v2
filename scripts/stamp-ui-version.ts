/**
 * Gắn phiên bản vào đường dẫn JS / CSS của giao diện lúc triển khai (`app.js` → `app.js?v=<phiên bản>`),
 * kể cả các `import './x.js'` giữa các module. Mỗi bản mới có URL mới nên trình duyệt / app trên điện thoại
 * không thể dùng lẫn index.html mới với app.js cũ còn trong bộ nhớ đệm.
 *
 * PHIÊN BẢN THEO NỘI DUNG (07/11/2026): trước đây mọi file mang số commit → mỗi lần triển khai (~20 lần / ngày) mọi máy tải lại
 * toàn bộ ~150 file / 2,2 MB dù chỉ sửa một file. Nay `?v=` là mã băm nội dung của chính file + phiên bản các file nó tham chiếu
 * (import, script nạp động…): file không đổi giữ nguyên URL, trình duyệt dùng lại bản đã lưu; sửa một file thì chỉ file đó và các
 * file import nó (theo chuỗi tới app.js) đổi URL. Các file import vòng tròn dùng chung một mã. File tham chiếu không có trên đĩa
 * thì dùng số phiên bản bản phát hành (đối số dòng lệnh) như cũ.
 * Chạy (trong GitHub Actions): `node --experimental-strip-types scripts/stamp-ui-version.ts <phiên-bản-bản-phát-hành>`.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, normalize } from 'node:path';

const LOCAL = String.raw`(?:\.\/)?[\w.-]+\.(?:js|css)`;
/** Đường dẫn trong thư mục con, kể cả thư mục phiên bản (./vendor/ocr-6.0.1/x.min.js). */
const LOCAL_NESTED = String.raw`(?:\.\/)?(?:[\w-][\w.-]*\/)*[\w.-]+\.(?:js|css)`;
/** Chỉ đụng tới file cùng thư mục (./x.js, x.css); bỏ qua link ngoài và đường đã có `?`. */
export function stampVersion(text: string, v: string | ((ref: string) => string), kind: 'html' | 'js'): string {
  const version = (ref: string) => { const out = typeof v === 'function' ? v(ref) : v; if (!/^[\w.-]{1,40}$/.test(out)) throw new Error('Phiên bản không hợp lệ.'); return out; };
  if (typeof v === 'string') version(v);
  // Classic scripts loaded by contract-ui's script() helper must follow the same
  // release as ES modules; otherwise a new UI may call methods missing in cache.
  // Nạp script động (thư viện PDF / Excel / quét mã vạch): `el.src = 'x.js'`, `{ src: 'x.js' }`, `new URL('./x.js', import.meta.url)`,
  // `loadScript('./x.js')`, `scriptAsset('x.js')`. Nhờ vậy MỌI file JS / CSS đều có URL theo phiên bản → _headers cho trình duyệt
  // giữ JS / CSS lâu dài (không phải hỏi lại máy chủ từng file mỗi lần mở app). push-sw.js giữ nguyên (service worker).
  if (kind === 'js') return text
    .replace(new RegExp(String.raw`((?:\bfrom|\bimport\(|\bscript\()\s*)(['"])(${LOCAL})\2`, 'g'), (_m, a, q, ref) => `${a}${q}${ref}?v=${version(ref)}${q}`)
    .replace(new RegExp(String.raw`((?:\.src\s*=|\bsrc:|\bnew URL\(|\bloadScript\(|\bscriptAsset\()\s*)(['"])(${LOCAL_NESTED})\2`, 'g'), (_m, a, q, ref) => `${a}${q}${ref}?v=${version(ref)}${q}`);
  return text.replace(new RegExp(String.raw`(<(?:script|link)\b[^>]*\b(?:src|href)=")(${LOCAL})"`, 'g'), (_m, a, ref) => `${a}${ref}?v=${version(ref)}"`);
}


/**
 * LỐI THOÁT BỘ ĐỆM HỎNG: tăng số này rồi triển khai lại → MỌI đường dẫn JS / CSS đổi mã (như cách cũ theo commit).
 * Dùng khi một file bị lưu đệm sai (vd. sự cố 05/11/2026: trang HTML bị lưu 1 năm thay cho file JS – file không đổi nội dung thì
 * giữ URL cũ nên không tự thoát được ở lần triển khai sau).
 */
// 09/11/2026: khôi phục tab đã nhận HTML mới nhưng giữ module Sản phẩm theo đơn cũ trong cache.
export const CACHE_EPOCH = 2;
const kindOf = (f: string) => f.endsWith('.html') ? 'html' as const : f.endsWith('.js') && !f.endsWith('.min.js') ? 'js' as const : null;
/** Tên file trong thư mục giao diện mà một tham chiếu trỏ tới ('./x.js', 'x.js', './vendor/a/b.min.js' → 'x.js' / 'vendor/a/b.min.js'). */
const targetOf = (ref: string) => normalize(ref.replace(/^\.\//, '')).replace(/\\/g, '/');

/**
 * Phiên bản theo nội dung cho mọi file trong `dir` (file .html / .js được gắn phiên bản + mọi file chúng tham chiếu).
 * Mã = sha256(nội dung gốc của các file cùng vòng import + phiên bản các file ngoài vòng mà chúng tham chiếu), 10 ký tự đầu.
 * Trả về nội dung đã gắn phiên bản của từng file .html / .js và phiên bản của từng file.
 */
export function contentVersions(dir: string, release: string, {
  list = () => readdirSync(dir), read = (f: string) => readFileSync(join(dir, f), 'utf8'),
  bytes = (f: string): Uint8Array | null => existsSync(join(dir, f)) ? readFileSync(join(dir, f)) : null,
  epoch = CACHE_EPOCH,
}: { list?: () => string[]; read?: (f: string) => string; bytes?: (f: string) => Uint8Array | string | null; epoch?: number } = {}) {
  if (!/^[\w.-]{1,40}$/.test(release)) throw new Error('Phiên bản không hợp lệ.');
  const sources = new Map<string, { kind: 'html' | 'js'; text: string }>();
  for (const f of list()) { const kind = kindOf(f); if (kind) sources.set(f, { kind, text: read(f) }); }
  const deps = new Map<string, string[]>();
  const nodes = new Set<string>(sources.keys());
  for (const [f, { kind, text }] of sources) {
    const refs: string[] = [];
    stampVersion(text, ref => { refs.push(targetOf(ref)); return release; }, kind);
    deps.set(f, [...new Set(refs)]);
    for (const r of refs) nodes.add(r);
  }
  // Tarjan: nhóm các file import vòng tròn (một nhóm = một mã).
  const index = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], on = new Set<string>(), comp = new Map<string, number>(), comps: string[][] = [];
  let i = 0;
  const visit = (v: string) => {
    index.set(v, i); low.set(v, i); i++; stack.push(v); on.add(v);
    for (const w of deps.get(v) ?? []) {
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const members: string[] = []; let w: string;
      do { w = stack.pop()!; on.delete(w); comp.set(w, comps.length); members.push(w); } while (w !== v);
      comps.push(members.sort());
    }
  };
  for (const v of [...nodes].sort()) if (!index.has(v)) visit(v);
  // Tarjan đánh số nhóm theo thứ tự hoàn thành: nhóm phụ thuộc luôn xong trước nhóm tham chiếu nó.
  const versions = new Map<string, string>(), compVersion: string[] = [];
  comps.forEach((members, c) => {
    const h = createHash('sha256').update('epoch=' + epoch + '\0');
    let missing = false;
    for (const m of members) {
      const src = sources.get(m);
      const raw = src ? null : bytes(m);
      if (src) h.update(m + '\0' + src.text + '\0');
      else if (raw !== null) h.update(m + '\0').update(raw).update('\0');
      else missing = true;
      for (const d of deps.get(m) ?? []) if (comp.get(d) !== c) h.update(d + '=' + compVersion[comp.get(d)!] + '\0');
    }
    compVersion[c] = missing ? release : h.digest('hex').slice(0, 10);
    for (const m of members) versions.set(m, compVersion[c]);
  });
  const stamped = new Map<string, string>();
  for (const [f, { kind, text }] of sources) stamped.set(f, stampVersion(text, ref => versions.get(targetOf(ref)) ?? release, kind));
  return { versions, stamped };
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const release = process.argv[2] ?? '', dir = join(import.meta.dirname, '..', 'trial-ui');
  const { stamped } = contentVersions(dir, release);
  let changed = 0;
  for (const [f, after] of stamped) if (after !== readFileSync(join(dir, f), 'utf8')) { writeFileSync(join(dir, f), after); changed++; }
  console.log(`Gắn phiên bản theo nội dung cho ${changed} file (bản phát hành ${release}).`);
}
