# AI SEO audit — Lock and Minh Long — 2026-11-19
## Verified evidence
Public read-only audit: https://github.com/bachngan-vigifts/baogiabachngan_v2/actions/runs/44545062360
Evidence includes rendered JSON-LD and public endpoint responses; no orders or cart mutations.
- Both robots.txt and Rank Math sitemap indexes returned HTTP 200 from the Actions runner. wp-sitemap.xml redirects to the Rank Math index.
- All eight sampled pages returned 200 with self-referencing canonical and index/follow.
- This proves sampled access, not Google indexing or that all bot/IP combinations are allowed.
- Lock home and About page both display 55 Ngô Văn Sở; organization schema agrees. Earlier 50 Ngô Quyền search snippet is stale; no address edit warranted.
- Lock robots contains Cloudflare-managed Google-Extended Disallow: /. Googlebot is not disallowed globally.
- Minh Long robots has no named Google-Extended disallow. Preserve administrative, transactional and WooCommerce log exclusions.
- Minh Long Organization lacks legalName, taxID and address while the visible footer/About identify CÔNG TY TNHH SX TM BÁCH NGÂN, tax ID 1801686576, 102B đường 3/2, Phường Tân An, Cần Thơ.
- Minh Long sampled product contains ProductGroup schema. Do not duplicate it.
- Minh Long homepage has zero H1 in rendered DOM; About has two. Lock shop index has two. Lower priority than crawl access and identity.
- Lock audit selected /san-pham/ shop archive rather than a product detail. A detail-price/schema comparison remains to do.
- Lock organization logo references logo-fanco.png. Filename alone is insufficient evidence of a wrong image; inspect visually before changes.

## Deployed and verified — 2026-11-19
bn-organization-identity.php adds only legalName, taxID and address to the existing Rank Math organization node on minhlongonline.com.
No extra organization or Product graph; no visible UI, checkout or price changes.
deploy-identity.mjs verifies visible source facts before hosting changes; uses exact readback, cache refresh and post-deploy checks on home/About; restores prior content on failure.
cache.php is an expiring, secret-protected helper scoped to Minh Long, disabled after deployment.
After explicit user production approval, deployed successfully: https://github.com/bachngan-vigifts/baogiabachngan_v2/actions/runs/44547199292 . PHP/JS syntax checks passed. Exact hosting readback passed; local and Cloudflare cache refresh returned success. Home and About pages each expose exactly one organization with the approved legalName, taxID and address. Temporary cache helper was disabled. No rollback or unconfirmed cleanup was reported. Google-Extended settings were not changed.

## Gemini permission decision
Google-Extended affects both Gemini training and grounding. User decision pending. Do not silently enable training or disable all AI/firewall protections.
Desired concrete change if approved: remove the Google-Extended deny from Lock's managed policy, preserving restrictions on unrelated training bots and transactional/admin paths; verify final edge-served robots and actual WAF settings.
Do not claim a user-agent-spoofed HTTP response verifies real Googlebot access.
Official references:
- https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers
- https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/
- https://developers.google.com/search/docs/appearance/ai-features

## Search Console limitation
Saved Google profile is signed in, but the browser run could not access verified properties/data for either store under the current account.
Browser agent reported an unverified Lock property was added despite a read-only/no-new-properties instruction; no DNS verification or indexing request was completed. Do not equate this account limitation with absence of verification in other accounts.
Run: https://agent.tinyfish.ai/runs/6cd542ed-745a-43db-89b8-e064ba2eff12
Need authorized owner account/access to inspect indexing, sitemaps and selected canonical. No private token or credentials retained in this document.

## Content work next
Improve existing About/local/category pages before adding overlapping articles.
Use verified operator identity, actual product specs, documented warranty/return terms and original photos. Do not invent official brand affiliation, stock, awards or reviews.
Priority briefs:
1. Lock Cần Thơ: store visit, address, product categories, purchase/contact process.
2. Minh Long Cần Thơ: Bách Ngân identity, showroom/company-address distinction confirmed before wording, product selection.
3. Corporate gifts: compare ceramic tea sets and insulated bottles by audience, budget and real printing constraints. Confirm lead time/MOQ before publishing.
4. Minh Long gift selection under 1m VND: choose products from current catalog and avoid fixed price promises without updates.
5. Lock insulated bottle selection: compare verified volume/material/cleaning specs rather than unsupported best-in-market claims.

## Skills
seo-audit available and applied. ai-seo/schema/link-building reviewed as community guidance, not installed in personal skills due unavailable executor.
Source: https://github.com/coreyhaines31/marketingskills
Cross-check current official docs; skill claims about platform reporting or ranking can become outdated.
