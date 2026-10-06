// Đóng gói demo thành MỘT file HTML tự chứa: esbuild gói app.ts cùng các hàm nghiệp vụ thật (đã kiểm thử) thành IIFE rồi nhúng vào template.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const r = await build({ entryPoints: ['demo/src/app.ts'], bundle: true, write: false, format: 'iife', target: 'es2020', minify: true, legalComments: 'none', platform: 'browser' });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
mkdirSync('demo/dist', { recursive: true });
const html = readFileSync('demo/template.html', 'utf8').replace('/*__BUNDLE__*/', () => js);
writeFileSync('demo/dist/demo.html', html);
console.log(`demo/dist/demo.html  ${(html.length / 1024).toFixed(0)} KB (script ${(js.length / 1024).toFixed(0)} KB)`);
