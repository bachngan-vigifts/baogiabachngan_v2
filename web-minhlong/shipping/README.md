# Minh Long: approved items 1–5

User approved items 1–5 on 17 November 2026. Item 6 (chatbot) is excluded.

## Prepared changes
- Desktop homepage category thumbnails use Minh Long category slugs and published product images, cached for a day.
- Existing shipping policy is backed up before changing its 200,000 VND threshold to 1,000,000 VND. Changes are guarded by exact expected content and the Minh Long policy slug.
- Invisible shipping badge hotspot supports mouse, keyboard and touch. Requires explicit data-ml-freeship-badge="1" on verified product image boxes; unverified images are not made interactive.
- Checkout GHN leadtime is cached per route/service/day. Requires verified site-specific ML_SHIPPING_GHN_TOKEN and ML_SHIPPING_GHN_SHOP_ID; no Lock credential fallback.
- Express contact panel highlights Mr Thai, 0939 961 966, and exclusion of existing promotions.
- No diagnostic/admin HTTP endpoints are included.

## Deployment gates — NOT DEPLOYED
The read-only cPanel preflight verified the Minh Long domain and existing MU plugin names.
The runtime diagnostic helper was blocked by automatic approval review; it was not installed.
Before deployment: verify existing GHN checkout field IDs, Minh Long GHN shop origin, available badge imagery, policy markup match, PHP/JS syntax, desktop/mobile fixtures, existing cron and appropriate cache purge.
Provision verified credentials server-side; never commit credentials.
Seed regional estimates locally on the server after setup. Verify daily 00:00 Asia/Ho_Chi_Minh schedule and actual cron execution.
Existing product images must be visually verified before adding badge hotspot markers.
No production deployment workflow is included pending these checks.
