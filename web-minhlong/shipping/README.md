# Minh Long approved items 1–5

Prepared: desktop category product thumbnails; shipping policy threshold 1,000,000 VND; invisible freeship hover/tap area aligned to the verified Minh Long frame; cached GHN checkout ETA; highlighted express-contact notice. Chatbot is excluded.

## Verified
- GitHub secrets GHN_ML_API_TOKEN and GHN_ML_SHOP_ID work with GHN.
- Minh Long shop origin: district 1572, ward 550110 (not Lock's ward).
- Read-only GHN leadtime succeeded for South, Central and North representative destinations.
- Checkout uses billing/shipping_ghn_province_id, ghn_district_id and ghn_ward_code.
- PHP and inline JavaScript draft syntax checks passed.
- Frame KHUNG-SAN-PHAM-WEB_MINH-LONG-ONLINE-thang-11-03.webp was visually inspected; freeship is at bottom x58–78%.
- No diagnostic PHP endpoint was installed. No real orders placed.

## Production deployment NOT RUN
Automatic approval review rejected creation of the automatic on-push deployment workflow, requiring explicit approval of the production mechanism.
deploy.mjs is prepared for review only and has no triggering deployment workflow in this branch.

Proposed mechanism: run GitHub Actions using existing cPanel and Minh Long GHN secrets; verify domain root; install only ml-home-category-icons.php and ml-shipping-information.php, provision GHN values server-side without committing them; verify exact readback; update the existing policy with backup; purge related LiteSpeed URLs; schedule cached-route refresh at 00:00 Asia/Ho_Chi_Minh; add a three-minute WordPress cron trigger only if an equivalent one is absent. Test desktop/mobile using an isolated cart without submitting an order. On verification failure disable the two new plugins; the corrected policy and its backup may remain.

Remaining: authorize the exact production deployment mechanism, run installation, confirm regional cache and cron, inspect screenshots and verify ordinary cached pages.
