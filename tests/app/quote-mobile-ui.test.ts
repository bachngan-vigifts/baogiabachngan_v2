import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../trial-ui/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../trial-ui/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../trial-ui/style.css', import.meta.url), 'utf8');

test('soạn báo giá mobile có ba bước, dock tổng tiền và giữ nguyên các nút nghiệp vụ', () => {
  for (const step of ['info', 'products', 'review']) {
    assert.match(html, new RegExp(`data-quote-step="${step}"`));
    assert.match(html, new RegExp(`data-quote-panel="${step}"`));
  }
  for (const id of ['quote-stock', 'quote-hold', 'quote-purchase', 'quote-make', 'quote-download', 'save-quote', 'approve-quote', 'reject-quote', 'delete-quote']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="m-total"/);
  assert.match(html, /id="m-line-count"/);
  assert.match(html, /id="save-quote-m"[^>]*>Lưu báo giá/);
});

test('điều hướng mobile chỉ đổi panel giao diện, không thay hàm lưu báo giá', () => {
  assert.match(app, /const MOBILE_QUOTE_STEPS = \['info', 'products', 'review'\]/);
  assert.match(app, /qf\.dataset\.mobileStep = step/);
  assert.match(app, /\$\('#save-quote-m'\)\.addEventListener\('click',[\s\S]*?saveQuote\(\)/);
  assert.match(app, /\$\('#m-line-count'\)\.textContent = `\$\{editor\.rows\.length\} sản phẩm`/);
});

test('CSS chỉ chuyển bố cục báo giá ở màn hình tối đa 850px và dùng bản điều khiển gọn', () => {
  const mobile = css.slice(css.indexOf('/* Soạn báo giá trên điện thoại'));
  assert.match(mobile, /@media \(max-width: 850px\)/);
  assert.match(mobile, /#quote-form\[data-mobile-step='info'\]/);
  assert.match(mobile, /#view-editor #line-table \{[\s\S]*?min-width: 0 !important/);
  assert.match(css, /Bản gọn cho trình soạn báo giá trên điện thoại/);
  assert.match(css, /#view-editor \.mobile-savebar \.btn \{ min-width: 72px; min-height: 40px/);
  assert.match(css, /font-size: 13px !important/);
  assert.doesNotMatch(css.slice(0, css.indexOf('/* Soạn báo giá trên điện thoại')), /quote-mobile-panel:not/);
});

test('dòng trống mobile là một hàng phụ phí gọn và không lặp nút thêm sản phẩm', () => {
  assert.match(app, /const manual = !r\.sku && !r\.image/);
  assert.match(app, /class="\$\{manual \? 'manual-line' : ''\}"/);
  assert.match(app, /Tên phụ phí \/ nội dung thêm/);
  assert.match(css, /#view-editor \[data-quote-panel='products'\] > \.card-title-row #pick-products \{ display: none; \}/);
  assert.match(css, /#view-editor #line-list tr\.manual-line \{ grid-template-columns: minmax\(0, 1fr\) 110px 34px/);
  assert.match(css, /tr\.manual-line \.col-img,[\s\S]*?tr\.manual-line \.col-cost \{ display: none; \}/);
});

test('hộp tìm sản phẩm báo giá mobile ẩn bộ lọc, xếp phạm vi cùng chính sách và cuộn từng 20 mã', () => {
  assert.match(html, /id="picker-filter-toggle"[^>]*aria-expanded="false"[^>]*>Xem bộ lọc/);
  assert.match(html, /class="catalog-filters" id="picker-filters" hidden/);
  assert.match(app, /limit: '20'/);
  assert.match(app, /let pickerShown = 20/);
  assert.match(app, /pickerShown = more \? pickerShown \+ 20 : 20/);
  assert.match(app, /#picker-list'\)\.addEventListener\('scroll'/);
  assert.match(css, /\.catalog-options \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(css, /#picker-dialog \.picker-list \{ max-height: 58dvh; overflow-y: auto/);
});
