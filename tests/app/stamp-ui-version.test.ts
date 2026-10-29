import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampVersion } from '../../scripts/stamp-ui-version.ts';

test('gắn phiên bản vào JS / CSS của giao diện: import giữa các module, thẻ script / link; bỏ qua link ngoài', () => {
  assert.equal(stampVersion(`import { a } from './alert.js';\nimport { b } from "./avatars.js";\nconst m = await import('./chat.js');`, 'abc1234', 'js'),
    `import { a } from './alert.js?v=abc1234';\nimport { b } from "./avatars.js?v=abc1234";\nconst m = await import('./chat.js?v=abc1234');`);
  assert.equal(stampVersion(`navigator.serviceWorker.register('push-sw.js'); const from = 'x.js';`, 'abc1234', 'js'), `navigator.serviceWorker.register('push-sw.js'); const from = 'x.js';`, 'không đổi chuỗi thường / service worker');
  assert.equal(stampVersion(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X">\n<link rel="stylesheet" href="style.css">\n<script src="excel-export.js" defer></script>\n<script type="module" src="app.js"></script>`, 'abc1234', 'html'),
    `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X">\n<link rel="stylesheet" href="style.css?v=abc1234">\n<script src="excel-export.js?v=abc1234" defer></script>\n<script type="module" src="app.js?v=abc1234"></script>`);
  assert.throws(() => stampVersion('', 'a"b', 'js'));
});

test('lazy contract scripts receive the same release version as their UI module', () => {
  assert.equal(stampVersion(`await script('fflate.min.js'); await script('contract-word-edit.js', true); await script('contract-document.js'); await script('jszip.min.js'); await script('docx-preview.min.js');`, 'release42', 'js'),
    `await script('fflate.min.js?v=release42'); await script('contract-word-edit.js?v=release42', true); await script('contract-document.js?v=release42'); await script('jszip.min.js?v=release42'); await script('docx-preview.min.js?v=release42');`);
  assert.equal(stampVersion(`script('https://cdn.test/lib.js'); script('x.js?v=old'); script(src);`, 'release42', 'js'),
    `script('https://cdn.test/lib.js'); script('x.js?v=old'); script(src);`);
});

test('nạp script động (PDF / Excel / quét mã) cũng được gắn phiên bản; chuỗi thường và service worker giữ nguyên', () => {
  assert.equal(stampVersion(`s.src = 'exceljs.min.js'; el.src='xlsx.full.min.js'; Object.assign(x, { src: 'exceljs.min.js' }); new URL('./vendor/z/zx.min.js', import.meta.url); loadScript('./pdf-lib.min.js', ok); scriptAsset('hrc-pdf.js');`, 'r1', 'js'),
    `s.src = 'exceljs.min.js?v=r1'; el.src='xlsx.full.min.js?v=r1'; Object.assign(x, { src: 'exceljs.min.js?v=r1' }); new URL('./vendor/z/zx.min.js?v=r1', import.meta.url); loadScript('./pdf-lib.min.js?v=r1', ok); scriptAsset('hrc-pdf.js?v=r1');`);
  assert.equal(stampVersion(`new URL('./fonts/' + f, import.meta.url); s.src = 'https://cdn.test/a.js'; s.src = src;`, 'r1', 'js'), `new URL('./fonts/' + f, import.meta.url); s.src = 'https://cdn.test/a.js'; s.src = src;`);
});

// _headers cho trình duyệt giữ *.js / *.css một năm (immutable). Chỉ an toàn khi MỌI chỗ tham chiếu JS / CSS của giao diện
// đều có ?v=<phiên bản> sau bước triển khai – file nào lọt (vd. nạp động kiểu mới) sẽ kẹt bản cũ trên máy người dùng.
test('sau khi gắn phiên bản, không còn tham chiếu JS / CSS nội bộ nào thiếu ?v= (trừ service worker)', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('../../trial-ui/', import.meta.url), leftovers: string[] = [];
  for (const f of readdirSync(dir)) {
    const kind = f.endsWith('.html') ? 'html' : f.endsWith('.js') && !f.endsWith('.min.js') ? 'js' : null;
    if (!kind) continue;
    const stamped = stampVersion(readFileSync(new URL(f, dir), 'utf8'), 'r1', kind);
    for (const m of stamped.matchAll(/(['"])((?:\.\/)?(?:[\w-]+\/)*[\w.-]+\.(?:js|css))(\?[^'"]*)?\1/g))
      if (m[3] !== '?v=r1' && m[2] !== 'push-sw.js') leftovers.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(leftovers, []);
});
