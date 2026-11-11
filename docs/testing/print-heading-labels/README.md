# Print heading and transfer signatures

Removed the duplicate company/department block beside the title in the shared order, packing, delivery and transfer print templates, order Excel export and supplier purchase PDF. Existing banner images and buyer/customer information remain unchanged.

Transfer signatures now show Người nhận hàng (confirmed receiver) and Người phê duyệt (approver), with names mapped to their actual roles.

Validation on 2026-11-11:

- 30 focused tests passed: order-print, order-print-form, transfer-print, printed-line-order, supplier-order-export.
- Typecheck and UI build passed.
- Chromium checked the real print dialog functions and shared modules using synthetic fixtures served only on localhost. Eight document/brand/state combinations produced 14 portrait/landscape PDF cases, with no page errors. The duplicate heading was absent and titles remained centered. This does not test production data or API authorization.
- Transfer preview attached. No database migrations or production changes required.
