import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ui = join(import.meta.dirname, '../../trial-ui');
const read = (name: string) => readFileSync(join(ui, name), 'utf8');

test('gentle breathing presents Madam Sen with accessible branding', () => {
  const source = read('breathing-gentle.js');
  assert.match(source, /cùng Madam Sen/);
  assert.match(source, /breathing-assets\/madam-sen-meditating\.png/);
  assert.match(source, /alt="Madam Sen ngồi thiền trên đài sen, áo xanh có logo BN vàng đồng ở ngực trái"/);
  assert.doesNotMatch(source, /gấu mint|bear\.svg/);
});

test('Madam Sen image is transparent and retains gentle motion accessibility', () => {
  const png = readFileSync(join(ui, 'breathing-assets/madam-sen-meditating.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png[25], 6, 'RGBA PNG');
  const css = read('breathing-content.css');
  assert.match(css, /\.gentle-mascot img\{[^}]*object-fit:contain/);
  assert.match(css, /\[data-direction=in\] \.gentle-mascot/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.gentle-mascot/);
});
