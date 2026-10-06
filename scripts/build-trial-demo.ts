/**
 * Đóng gói giao diện dùng thử thành MỘT file HTML chạy độc lập với máy chủ giả lập trong trình duyệt
 * (dùng để xem thử trong Claude Artifact – nơi không gọi được Supabase và không mở được hộp thoại in).
 * Chạy: `npm run ui:demo -- <đường-dẫn-ra.html>` (mặc định dist/trial-demo.html).
 */
import { buildSync } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = join(import.meta.dirname, '..'), ui = join(root, 'trial-ui');
const out = resolve(process.argv[2] || join(root, 'dist', 'trial-demo.html'));

const entry = "import './demo-boot.js';\nimport './app.js';\n";
const js = buildSync({ stdin: { contents: entry, resolveDir: ui, sourcefile: 'demo-entry.js' }, bundle: true, format: 'esm', target: 'es2020', minify: true, write: false, legalComments: 'none' }).outputFiles[0]!.text;
const css = readFileSync(join(ui, 'style.css'), 'utf8');
const html = readFileSync(join(ui, 'index.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script type="module" src="app\.js"><\/script>/, '');
const page = `<title>Bách Ngân Báo Giá</title>
<meta name="description" content="Bản demo giao diện báo giá Bách Ngân với dữ liệu mẫu.">
<style>${css}</style>
${body.trim()}
<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log('Đã ghi', out, Math.round(page.length / 1024) + ' KB');
