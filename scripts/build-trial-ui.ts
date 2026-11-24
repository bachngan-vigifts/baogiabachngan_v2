/**
 * Đóng gói `quotes/domain/quote-math.ts` thành `trial-ui/quote-math.js` để giao diện dùng thử
 * tính tiền bằng ĐÚNG hàm của máy chủ (không viết lại công thức ở frontend).
 * Chạy: `npm run ui:build`. `tests/app/trial-ui.test.ts` báo lỗi nếu file sinh ra bị cũ.
 */
import { buildSync } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
export const CONTRACT_SOURCE_POLICY_OUT=join(root,'trial-ui','contract-source-policy.js');
export const bundleContractSourcePolicy=()=>bundle('src/core/contracts/contract-template-source.ts');
export const CONTRACT_SOURCE_FILE_OUT=join(root,'trial-ui','contract-source-file.js');
export const bundleContractSourceFile=()=>bundle('src/modules/sales/domain/contract-source-file.ts');
export const CUSTOMER_PROVINCE_OUT=join(root,'trial-ui','customer-province.js');
export const bundleCustomerProvince=()=>bundle('src/modules/customers/domain/province.ts');
export const CUSTODY_CONTRACT_OUT=join(root,'trial-ui','product-custody-contract.js');
export const bundleProductCustody=()=>bundle('src/modules/product-custody/domain/custody.ts');
export const CUSTOMER_ANNIVERSARY_OUT = join(root, 'trial-ui', 'customer-anniversary.js');
export const bundleCustomerAnniversary = () => bundle('src/modules/customers/domain/anniversary.ts');
export const DOCUMENT_NUMBER_OUT = join(root, 'trial-ui', 'document-number.js');
export const bundleDocumentNumber = () => bundle('src/core/document-number.ts');
export const SUBMISSION_REVIEW_OUT=join(root,'trial-ui','submission-review-domain.js');
export const bundleSubmissionReview=()=>bundle('src/modules/sales/domain/submission-review.ts');
export const QUOTE_MATH_OUT = join(root, 'trial-ui', 'quote-math.js');
/** Bộ lọc "Tìm nhanh sản phẩm" chạy trên trình duyệt – cùng quy tắc với máy chủ. */
export const ORDER_NOTES_OUT = join(root, 'trial-ui', 'order-notes.js');
export const bundleOrderNotes = () => bundle('src/modules/sales/domain/order-notes.ts');
export const POS_CATALOG_BRAND_OUT = join(root, 'trial-ui', 'pos-catalog-brand.js');
export const bundlePosCatalogBrand = () => bundle('src/modules/sales/domain/pos-catalog-brand.ts');
export const POS_CUSTOMER_OUT = join(root, 'trial-ui', 'pos-customer.js');
export const bundlePosCustomer = () => bundle('src/modules/sales/domain/pos-customer.ts');
export const PRODUCT_SEARCH_OUT = join(root, 'trial-ui', 'product-search.js');
export const EARLY_ORDER_SOURCES_OUT = join(root, 'trial-ui', 'early-order-sources.js');
export const bundleEarlyOrderSources = () => bundle('src/modules/suppliers/domain/early-order-sources.ts');

export const SUPPLIER_ORDER_NUMBER_OUT = join(root, 'trial-ui', 'supplier-order-number.js');
export const bundleSupplierOrderNumber = () => bundle('src/modules/suppliers/domain/order-number.ts');

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
  for (const [out, code] of [[CONTRACT_SOURCE_POLICY_OUT,bundleContractSourcePolicy()],[CONTRACT_SOURCE_FILE_OUT,bundleContractSourceFile()],[CUSTOMER_PROVINCE_OUT,bundleCustomerProvince()],[SUBMISSION_REVIEW_OUT,bundleSubmissionReview()],[SUPPLIER_ORDER_NUMBER_OUT,bundleSupplierOrderNumber()], [CUSTODY_CONTRACT_OUT,bundleProductCustody()], [CUSTOMER_ANNIVERSARY_OUT,bundleCustomerAnniversary()], [POS_CATALOG_BRAND_OUT,bundlePosCatalogBrand()], [DOCUMENT_NUMBER_OUT, bundleDocumentNumber()], [QUOTE_MATH_OUT, bundleQuoteMath()], [PRODUCT_SEARCH_OUT, bundleProductSearch()], [ORDER_NOTES_OUT, bundleOrderNotes()], [POS_CUSTOMER_OUT, bundlePosCustomer()], [EARLY_ORDER_SOURCES_OUT,bundleEarlyOrderSources()]] as const) {
    if (readFileSync(out, { encoding: 'utf8', flag: 'a+' }) !== code) writeFileSync(out, code);
    console.log('Đã ghi', out);
  }
}
