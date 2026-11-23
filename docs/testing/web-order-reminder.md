# Untouched website orders after 30 minutes

On the visible **Bán hàng nhanh** page, the selected store gets a warning banner and a reminder dialog for website orders that have waited at least 30 minutes without operational handling. The check is independent of the board's search, date/payment filters and pagination. It is scoped by the existing POS register permissions on the server.

The clock uses `web_store_orders.ordered_at`, not `updated_at`; ordinary website refreshes or payment synchronization do not count as employee handling. Woo GMT/CRM timestamps without a timezone are interpreted as UTC, and explicit offsets are respected. Missing, invalid, date-only and future timestamps do not generate a 30-minute claim. If the source omitted a creation timestamp, the existing importer may have used its first observed time; this patch does not rewrite historical dates.

Handled orders are excluded: terminal/packing/shipping states, stock already issued/returned or blocked for reconciliation, any GHN code/status, saved cart edits, recorded GHN confirmation attempts (including uncertain attempts), and durable successful contact/edit/confirm/cancel audit events. Payment alone is not handling: a paid website order can still require contacting the customer and shipping.

## Actions

- **Đã liên hệ** records the staff member/time in the existing private `audit_logs` (`sales`, `web-order-contacted`, `web-store-order`). It does not call the customer, complete the order, change payment, issue stock, or create GHN. The acknowledgement is shared across staff/devices and survives refresh/source synchronization. The server locks the order, rechecks store access and eligibility, and returns the prior marker on retries. Failed persistence leaves the reminder eligible.
- **Hủy đơn** re-fetches the current document and opens the existing cancellation form, which still requires a reason and retains all server/carrier checks. Merely opening the form never cancels an order.
- **Xử lý giao GHN** re-fetches the current document and opens the existing address/review/confirmation workflow. Merely opening it never creates a shipment. Missing configuration and carrier errors remain in the existing flow; no fallback auto-submission is introduced.
- **Nhắc lại sau 5 phút** or Escape snoozes the popup for that account/store in the current page instance, including navigating away and back. Refreshing the browser starts a new local reminder instance. Contact acknowledgement remains server-persistent.

The dialog shows the oldest 50 reminders with the full eligible count. Finishing those rows closes the current batch and refreshes the server list; the banner can open the next batch. The body scrolls while its dismiss control stays reachable. A cart in progress or another open dialog suppresses automatic interruption; the banner remains available for an explicit user choice. Leaving POS, hiding the browser tab, changing store/account, or losing authorization clears/isolates the local dialog. Late replies cannot populate another scope.

## Load and persistence

No migration, table, RLS change, dependency update, pool or compute change. The existing register and audit entity indexes support the filter/handling lookup. A single read selects only pending website-order metadata/operational flags for the authorized store, not cart images or original snapshots. Ordinary board reloads share an in-flight request and a 60-second client cache. Explicit contact acknowledgement, retry or closing a handling form can refresh immediately. Hidden/inactive POS pages do not poll. Network errors retain the previous warning with a retry action; authorization errors clear it. No customer details are persisted in browser storage by this feature.

## Checks

```sh
npm run typecheck
npm run ui:build
node --import tsx tests/app/web-order-attention.test.ts
node --import tsx tests/app/web-order-reminder-ui.test.ts
node --import tsx --test --test-concurrency=2 src/modules/sales/domain/web-order-attention.test.ts tests/app/web-order-attention.test.ts tests/app/web-order-reminder-ui.test.ts tests/app/pos-ui.test.ts tests/app/pos-order-board.test.ts tests/app/web-order-ghn-address.test.ts tests/app/web-order-bridge-errors.test.ts tests/app/web-order-customer-cancel.test.ts tests/app/web-order-documents.test.ts tests/app/trial-ui.test.ts
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx scripts/testing/web-order-reminder.mjs
```

New checks cover the 30-minute boundary/timezones, invalid dates, handled-state exclusions, recent source updates, independence from filters/pagination, 105 eligible rows with a 50-row response, cross-store/anonymous/supplier restrictions, duplicate contact markers across users, no financial/stock mutation, stale operations and transactional persistence failure. Controller tests cover coalescing/minute caching, late cross-store/account replies, leaving POS, retained warnings on network failure and clearing on permission loss.

The browser script uses the actual local CRM/router with synthetic PGlite data at 1440px and 430px. It checks automatic display, one dialog, readable actions/no horizontal overflow, double-click suppression, contact surviving reload, opening the existing cancellation/GHN forms without sending their actions, and navigation closing the popup. Screenshots default to `/workspace/artifacts/web-order-reminder`. It never touches production or sends a request to website/GHN providers. PGlite is not a live PostgreSQL concurrency/load benchmark.
