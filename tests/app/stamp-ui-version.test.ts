import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CACHE_EPOCH, contentVersions, stampVersion } from '../../scripts/stamp-ui-version.ts';

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

// Phiên bản theo nội dung: deploy chỉ đổi URL của file đã sửa và các file import nó (theo chuỗi tới trang), file khác giữ URL
// → trình duyệt dùng lại bản đã lưu (trước đây mọi file mang số commit nên mỗi lần deploy tải lại toàn bộ ~150 file).
const fakeUi = (files: Record<string, string>) => ({
  list: () => Object.keys(files), read: (f: string) => files[f]!, bytes: (f: string) => f in files ? files[f]! : null,
});
const site = {
  'index.html': '<link rel="stylesheet" href="style.css"><script type="module" src="app.js"></script>',
  'app.js': "import { a } from './a.js'; import { b } from './b.js';",
  'a.js': "import { leaf } from './leaf.js'; export const a = 1;",
  'b.js': "export const b = 2; const s = document.createElement('script'); s.src = 'lib.min.js';",
  'leaf.js': 'export const leaf = 1;',
  'lib.min.js': 'var lib=1;',
  'style.css': 'body{}',
  'x.js': "import { y } from './y.js'; export const x = 1;",
  'y.js': "import { x } from './x.js'; export const y = 1;",
};
test('phiên bản theo nội dung: không đổi gì → giữ nguyên URL dù bản phát hành khác', () => {
  const one = contentVersions('/ui', 'rel1', fakeUi(site)), two = contentVersions('/ui', 'rel2', fakeUi(site));
  assert.deepEqual([...one.versions], [...two.versions]);
  assert.deepEqual([...one.stamped], [...two.stamped]);
  assert.match(one.stamped.get('index.html')!, /href="style\.css\?v=[0-9a-f]{10}"/);
  assert.match(one.stamped.get('b.js')!, /s\.src = 'lib\.min\.js\?v=[0-9a-f]{10}'/, 'thư viện nạp động cũng theo nội dung');
});
test('sửa một file: đổi URL của file đó và các file import nó, file khác giữ nguyên', () => {
  const before = contentVersions('/ui', 'rel1', fakeUi(site)).versions;
  const after = contentVersions('/ui', 'rel2', fakeUi({ ...site, 'leaf.js': 'export const leaf = 2;' })).versions;
  const changed = [...after.keys()].filter(f => after.get(f) !== before.get(f)).sort();
  assert.deepEqual(changed, ['a.js', 'app.js', 'index.html', 'leaf.js'], 'leaf → a → app → trang');
  const css = contentVersions('/ui', 'rel3', fakeUi({ ...site, 'style.css': 'body{color:red}' })).versions;
  assert.deepEqual([...css.keys()].filter(f => css.get(f) !== before.get(f)).sort(), ['index.html', 'style.css']);
});
test('import vòng tròn dùng chung một mã; file tham chiếu không có trên đĩa dùng số bản phát hành', () => {
  const { versions, stamped } = contentVersions('/ui', 'rel9', fakeUi({ ...site, 'c.js': "import { z } from './missing.js';" }));
  assert.equal(versions.get('x.js'), versions.get('y.js'));
  assert.equal(versions.get('missing.js'), 'rel9');
  assert.match(stamped.get('c.js')!, /missing\.js\?v=rel9/);
  assert.throws(() => contentVersions('/ui', 'a"b', fakeUi(site)));
});
test('tăng CACHE_EPOCH: mọi file đổi mã (lối thoát khi một file bị lưu đệm sai)', () => {
  const a = contentVersions('/ui', 'r', fakeUi(site)).versions, b = contentVersions('/ui', 'r', { ...fakeUi(site), epoch: CACHE_EPOCH + 1 }).versions;
  assert.deepEqual([...a.keys()].filter(f => a.get(f) === b.get(f)), []);
});
test('giao diện thật: mọi file có phiên bản theo nội dung, không còn tham chiếu thiếu ?v=, không file nào rơi về số bản phát hành', () => {
  const dir = new URL('../../trial-ui/', import.meta.url).pathname;
  const { versions, stamped } = contentVersions(dir, 'r1');
  assert.deepEqual([...versions].filter(([, v]) => v === 'r1').map(([f]) => f), []);
  const leftovers: string[] = [];
  for (const [f, text] of stamped)
    for (const m of text.matchAll(/(['"])((?:\.\/)?(?:[\w-]+\/)*[\w.-]+\.(?:js|css))(\?[^'"]*)?\1/g))
      if (!/^\?v=[0-9a-f]{10}$/.test(m[3] ?? '') && m[2] !== 'push-sw.js') leftovers.push(`${f}: ${m[0]}`);
  assert.deepEqual(leftovers, []);
});
