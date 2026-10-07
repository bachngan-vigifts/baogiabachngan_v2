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
