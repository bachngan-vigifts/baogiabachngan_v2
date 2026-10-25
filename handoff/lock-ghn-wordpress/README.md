# LocknLock GHN WordPress source handoff

This is the review copy of the OpenClaw source handoff and the proposed WordPress patch. Nothing in CRM loads or deploys these files automatically. The original exported contents remain in source commit `1b9d95d2b44547cd5e3ad811507bcfa21f881410` (imported as `35c0e7c` in this PR).

## Provenance

- `install_web_order_action_bridge.js`: copied from `/home/node/.openclaw/workspace/scripts/install_web_order_action_bridge.js`.
- `snippet-71-lnl-ghn-auto-create.php`: exported read-only from the live LocknLock WordPress Code Snippets REST API, snippet ID 71.
- `snippet-125-lnl-ghn-auto-create.php`: exported read-only from the live LocknLock WordPress Code Snippets REST API, snippet ID 125.
- At export time, both snippets were `active=false`, scope `global`, priority `10`.
- The handoff redacted literal tokens. The working snippets now read Token/ShopId from runtime configuration, with no embedded credential values. No cookies, credentials, customer data, order data, or database dumps are included.

## Dependency map

The original bridge's `confirm` action depended on the snippet runtime functions, especially:

- Handler availability: `lnl_ghn_create_order_from_wc_order()`.
- GHN configuration: `LNL_GHN_TOKEN`, `LNL_GHN_SHOP_ID`, and `lnl_ghn_api_request()`.
- Address helpers: `lnl_ghn_get_order_ghn_location()`, `lnl_ghn_map_address()`, province/district/ward lookups.
- Idempotency input: WooCommerce `_lnl_ghn_order_code` metadata and GHN `client_order_code`.
- Creation and response handling: `/v2/shipping-order/create`, GHN response `data.order_code`, `sort_code`, and `total_fee`.
- Existing status lookup: `/v2/shipping-order/detail` using the stored GHN `order_code`.
- Persistence: WooCommerce `update_meta_data()`, `save()`, and `get_meta()`.

The original handler used the Woo order number as `client_order_code`; that convention is retained. Its original payload/COD/item/package formulas were extracted into `ghn-provider.php`. The provider has no checkout/cron hooks and is embedded by the bridge alongside `ghn-service.php`, making REST independent of inactive snippets. No snippet is automatically activated. The two exported legacy entry functions now delegate to the same service and fail closed when it is missing.

The two snippets are preserved separately because their sanitized source hashes differ. Do not assume they are interchangeable.

## Confirmation and recovery

1. Reject same-request reentry and acquire the per-site/per-order MySQL advisory lock with `GET_LOCK(..., 0)`; release in `finally`. No transient TTL or new SQL table is used. Loss of connection/ownership is checked again before create.
2. Reload using WooCommerce's data store and force a metadata refresh. A valid saved code is returned unchanged. Invalid stored links require review.
3. Look up the original stable client code on GHN. Validate the returned client code, shop and carrier code. Only the documented HTTP 400 / code 400 / exact not-found message permits considering a create; all ambiguous/auth/transport results stop.
4. Validate province → district → ward using scoped master-data requests. Persist the selected shipping address, `_lnl_crm_ghn_client_order_code` and `_lnl_crm_ghn_create_attempted` through Woo CRUD. Reload/verify the intent and full payload before the single create call.
5. A timeout, empty response or uncertain create result triggers a lookup, never a second create. The durable intent survives worker death and metadata-write failure. If a later lookup still finds nothing, stop for manual reconciliation; the marker is **not** automatically cleared to allow another create. A definitive carrier rejection followed by verified absence permits correcting the request and trying again after another lookup.
6. Save the actual carrier code as `_lnl_ghn_order_code`, sort code, fee and status using Woo CRUD. Read back and compare before success. If save/readback fails, the next request only looks up and saves that existing shipment. WordPress status hooks run only after a verified save.
7. The customer order-details page and Woo admin shipping-address section display the saved tracking number. No tracking URL is guessed.

The two new metadata keys use existing WooCommerce storage; there is no schema migration. Named locks require a compatible MySQL/MariaDB connection. Unsupported locking stops creation. Constant `LNL_GHN_TOKEN` / `LNL_GHN_SHOP_ID`, or environment variables with those names, must be supplied by the website's existing runtime configuration. Missing/redacted configuration returns `ghn_handler_unavailable`; no credentials are copied from this handoff.

Error codes: `ghn_handler_unavailable`, `address_invalid`, `ghn_rejected`, `ghn_response_missing_order_code`, `ghn_reconcile_failed`, `ghn_metadata_persist_failed`. GHN errors preserve sanitized `code_message_value`/`message`. Logs contain only order ID, error code and handler-availability flags, never raw payloads or messages.

## Verified API contracts

- [GHN lookup by client code](https://developer.ghn.vn/vi/docs/order/info-by-client-code): GET with `client_order_code`, Token and ShopId.
- [GHN order details and not-found/error distinctions](https://developer.ghn.vn/vi/docs/order/info).
- [Districts](https://developer.ghn.vn/vi/docs/master-data/get-district) and [wards](https://developer.ghn.vn/vi/docs/master-data/get-ward): GET, scoped by the parent ID. Minimal responses need not repeat that parent ID; membership in the scoped response is checked, and any parent ID present must match.

Only public documentation was fetched. No authenticated carrier request was made in development.

## Validation and deployment boundary

`tests/app/web-order-wordpress-ghn.test.ts` extracts only the PHP template, checks its interpolation variables, and evaluates that template with PHP plus in-memory WordPress/Woo/GHN doubles. It never runs the JS installer. Local Docker tests use `--network=none`; CI uses PHP CLI. The tests cover both legacy source variants, REST without legacy functions, replay, lookup failures, concurrency, lost locks, delayed carrier visibility, empty/invalid responses, failed/dropped persistence and matching website/CRM codes. They also verify unchanged SKU, quantity, price, COD and package formulas.

The installer source retains its original CommonJS host context and must be kept with the two PHP files if copied back to OpenClaw after separate approval. Do not run it from the CRM ESM package. No installer, snippet activation, GHN staging/production create, real WordPress bootstrap, HPOS database integration or deployment was executed. Verify runtime configuration, MySQL lock support and Woo compatibility in an isolated staging environment before proposing a production deployment.

## Safety

Do not run the installer, activate either snippet, deploy to WordPress production, invoke the order-action confirm endpoint, or create/retry a GHN waybill as part of reviewing this handoff.
