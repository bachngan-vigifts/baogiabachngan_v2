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
/** Bộ lọc "Tìm nhanh sản phẩm" chạy trên trình duyệt – cùng quy tắc với máy chủ. */
export const ORDER_NOTES_OUT = join(root, 'trial-ui', 'order-notes.js');
export const bundleOrderNotes = () => bundle('src/modules/sales/domain/order-notes.ts');
export const PRODUCT_SEARCH_OUT = join(root, 'trial-ui', 'product-search.js');

function bundle(entry: string): string {
  const result = buildSync({
    entryPoints: [join(root, entry)],
    bundle: true, format: 'esm', target: 'es2020', write: false, legalComments: 'none',
  });
  return `// TỰ SINH bởi \`npm run ui:build\` từ ${entry} – không sửa tay.\n` + result.outputFiles[0]!.text;
}
export const bundleQuoteMath = () => bundle('src/modules/quotes/domain/quote-math.ts');
export const bundleProductSearch = () => bundle('src/modules/catalog/domain/product-search.ts');

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  for (const [out, code] of [[QUOTE_MATH_OUT, bundleQuoteMath()], [PRODUCT_SEARCH_OUT, bundleProductSearch()], [ORDER_NOTES_OUT, bundleOrderNotes()]] as const) {
    if (readFileSync(out, { encoding: 'utf8', flag: 'a+' }) !== code) writeFileSync(out, code);
    console.log('Đã ghi', out);
  }
}
