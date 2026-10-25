# LocknLock GHN WordPress source handoff

This directory is a read-only source handoff for the CRM/GHN bridge investigation. Nothing here is an installer or deployment artifact.

## Provenance

- `install_web_order_action_bridge.js`: copied from `/home/node/.openclaw/workspace/scripts/install_web_order_action_bridge.js`.
- `snippet-71-lnl-ghn-auto-create.php`: exported read-only from the live LocknLock WordPress Code Snippets REST API, snippet ID 71.
- `snippet-125-lnl-ghn-auto-create.php`: exported read-only from the live LocknLock WordPress Code Snippets REST API, snippet ID 125.
- At export time, both snippets were `active=false`, scope `global`, priority `10`.
- Literal `LNL_GHN_TOKEN` values were replaced with `REDACTED_RUNTIME_SECRET`. No cookies, credentials, customer data, order data, or database dumps are included.

## Dependency map

The bridge's `confirm` action depends on the snippet runtime functions, especially:

- Handler availability: `lnl_ghn_create_order_from_wc_order()`.
- GHN configuration: `LNL_GHN_TOKEN`, `LNL_GHN_SHOP_ID`, and `lnl_ghn_api_request()`.
- Address helpers: `lnl_ghn_get_order_ghn_location()`, `lnl_ghn_map_address()`, province/district/ward lookups.
- Idempotency input: WooCommerce `_lnl_ghn_order_code` metadata and GHN `client_order_code`.
- Creation and response handling: `/v2/shipping-order/create`, GHN response `data.order_code`, `sort_code`, and `total_fee`.
- Existing status lookup: `/v2/shipping-order/detail` using the stored GHN `order_code`.
- Persistence: WooCommerce `update_meta_data()`, `save()`, and `get_meta()`.

The exported source sets `client_order_code` when creating a waybill, but it does **not** implement a GHN search/reconciliation lookup by `client_order_code`. That lookup is a missing dependency/behavior for Codex to add; it has not been reconstructed or guessed in this handoff.

The two snippets are preserved separately because their sanitized source hashes differ. Do not assume they are interchangeable.

## Safety

Do not run the installer, activate either snippet, deploy to WordPress production, invoke the order-action confirm endpoint, or create/retry a GHN waybill as part of reviewing this handoff.
