/**
 * Gắn số phiên bản vào đường dẫn JS / CSS của giao diện lúc triển khai (`app.js` → `app.js?v=<commit>`),
 * kể cả các `import './x.js'` giữa các module. Mỗi bản mới có URL mới nên trình duyệt / app trên điện thoại
 * không thể dùng lẫn index.html mới với app.js cũ còn trong bộ nhớ đệm.
 * Chạy (trong GitHub Actions): `node --experimental-strip-types scripts/stamp-ui-version.ts <phiên-bản>`.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCAL = String.raw`(?:\.\/)?[\w-]+\.(?:js|css)`;
/** Chỉ đụng tới file cùng thư mục (./x.js, x.css); bỏ qua link ngoài và đường đã có `?`. */
export function stampVersion(text: string, v: string, kind: 'html' | 'js'): string {
  if (!/^[\w.-]{1,40}$/.test(v)) throw new Error('Phiên bản không hợp lệ.');
  if (kind === 'js') return text.replace(new RegExp(String.raw`((?:\bfrom|\bimport\()\s*)(['"])(${LOCAL})\2`, 'g'), `$1$2$3?v=${v}$2`);
  return text.replace(new RegExp(String.raw`(<(?:script|link)\b[^>]*\b(?:src|href)=")(${LOCAL})"`, 'g'), `$1$2?v=${v}"`);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const v = process.argv[2] ?? '', dir = join(import.meta.dirname, '..', 'trial-ui');
  for (const f of readdirSync(dir)) {
    const kind = f.endsWith('.html') ? 'html' : f.endsWith('.js') && !f.endsWith('.min.js') ? 'js' : null;
    if (!kind) continue;
    const path = join(dir, f), before = readFileSync(path, 'utf8'), after = stampVersion(before, v, kind);
    if (after !== before) { writeFileSync(path, after); console.log('Gắn phiên bản', v, '→', f); }
  }
}
