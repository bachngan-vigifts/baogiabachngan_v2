# Mobile product picker

The compact picker previously enforced a 760px minimum width on phones and hid quantity until details were expanded. This placed stock columns and add controls outside the viewport.

At widths up to 640px, each product now has one name line, a labeled stock summary (physical / held / available / incoming / supplier), and an always-visible quantity/add/details row. The summary can wrap on narrow screens or large numbers. Unknown stock remains unknown; reservation calculations, incoming-stock links, pricing and desktop columns are unchanged. At up to 360px the policy selector and scope checkbox use separate rows so the policy remains readable.

## Validation

- `node --import tsx --test tests/app/picker-stock-columns.test.ts tests/app/mobile-quote-capture.test.ts`: both test files passed.
- `npm run typecheck`: passed.
- `npm run ui:build`: passed.
- `PLAYWRIGHT_MODULE=<installed playwright module> node --import tsx scripts/testing/mobile-product-picker.mjs`: passed at 320, 390, 430 and 1440px, using the actual UI and an isolated PGlite API fixture. Checks no horizontal overflow on mobile, visible quantity/add controls, quantity retained across details toggles, and quantity 3 actually added to the quote. Also checks 520px viewport height to simulate reduced space with a keyboard; this is not a physical iOS keyboard test.
- Screenshots captured and reviewed in `/tmp/mobile-product-picker/`; results in `results.json`. No browser JavaScript errors.

No schema, authorization, production data or storage changes.

## Thumbnail follow-up

Mobile controls now reserve a 44×44 thumbnail slot on the left; quantity is immediately beside Add on the right. The existing `thumb(p)` helper preserves thumbnail URL handling, lazy loading, async decoding, dimensions and error/empty fallbacks. Desktop columns remain unchanged. At up to 360px the quantity label is shortened to SL, while the input retains its complete accessible label.

The browser fixture also checks successful image decoding, thumbnail placement before quantity, quantity aligned beside Add and the existing no-overflow/add-3 checks. Screenshots are under `/tmp/mobile-product-picker-thumbnail/`. Reduced viewport height simulates available keyboard space, not a real iOS keyboard.
