/**
 * Đóng gói `quotes/domain/quote-math.ts` thành `trial-ui/quote-math.js` để giao diện dùng thử
 * tính tiền bằng ĐÚNG hàm của máy chủ (không viết lại công thức ở frontend).
 * Chạy: `npm run ui:build`. `tests/app/trial-ui.test.ts` báo lỗi nếu file sinh ra bị cũ.
 */
import { buildSync } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
export const QUOTE_MATH_OUT = join(root, 'trial-ui', 'quote-math.js');

export function bundleQuoteMath(): string {
  const result = buildSync({
    entryPoints: [join(root, 'src/modules/quotes/domain/quote-math.ts')],
    bundle: true, format: 'esm', target: 'es2020', write: false, legalComments: 'none',
  });
  return '// TỰ SINH bởi `npm run ui:build` từ src/modules/quotes/domain/quote-math.ts – không sửa tay.\n' + result.outputFiles[0]!.text;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const code = bundleQuoteMath();
  if (readFileSync(QUOTE_MATH_OUT, { encoding: 'utf8', flag: 'a+' }) !== code) writeFileSync(QUOTE_MATH_OUT, code);
  console.log('Đã ghi', QUOTE_MATH_OUT);
}
