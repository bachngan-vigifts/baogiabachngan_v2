# POS payment QR printing

The VietQR popup now has a separate **In mã thanh toán** button, alongside Close and above the existing explicit received-money action. The new print action reuses the current request URL, exact amount and transfer content. It neither creates a new payment request nor confirms money, calls checkout, alters inventory or changes the receipt flow.

The DOM-only renderer prints a K80 sheet with the register, amount, QR image and transfer content. All text uses textContent. It waits for image decoding (15-second timeout) and checks the current user, QR request, cart validity and expiry before opening the printer. Existing modal locking prevents duplicate print clicks or simultaneous manual confirmation while preparing the print. Frames are cleaned after printing or errors, with a fallback cleanup timer.

Validation:

- `node --import tsx --test tests/app/pos-payment-qr-print.test.ts tests/app/pos-ui.test.ts`: passed. Renderer/print coverage includes exact URL/amount/content, untrusted text, invalid data, deferred image decoding, broken images, invalidated requests, printer errors and frame cleanup.
- `npm run typecheck`: passed.
- `npm run ui:build`: passed.
- `PLAYWRIGHT_MODULE=<installed playwright module> node scripts/testing/pos-payment-qr-print.mjs`: passed at 320/390/430/1280px using the real POS UI and fixture APIs/images. Confirms visible footer controls, no horizontal overflow, one print invocation, decoded image, exact content/amount, no extra write request, no checkout and no transfer checkbox confirmation.
- Screenshots reviewed under `/tmp/pos-payment-qr-print/`; K80 PDF generated and checked with pdftotext. QR artwork is a non-payable fixture, not production banking information. Native printer dialogs are stubbed during browser tests; physical printing/scanning and iOS AirPrint still require device testing.

No database, payment API, bank configuration or authorization changes.
