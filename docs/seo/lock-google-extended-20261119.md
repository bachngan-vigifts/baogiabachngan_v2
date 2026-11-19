# Lock Google-Extended permission — 2026-11-19

User explicitly approved allowing Google-Extended after disclosure that this covers both Gemini grounding and future model training.

## Implementation
Lock-only MU plugin lnl-google-extended.php appends a Google-Extended group to WordPress robots.txt.
Cloudflare's managed deny remains in the combined document. Google's documented interpretation merges equally specific groups and prefers Allow when identical-length rules conflict. Thus Allow: / permits public content, while longer Disallow paths retain private/transactional exclusions.
The group explicitly expresses Google's ai-input/ai-train permission; unrelated bots retain their previous policy.
Wildcard path restrictions are copied into the specific group because Google does not inherit wildcard groups once an exact agent group exists.
A globally private WordPress site is not made public by the plugin.
No firewall/WAF settings were changed. This is an effective robots permission, not evidence that Gemini has visited, indexed, cited, or recommended the site.

## Verification
Run: https://github.com/bachngan-vigifts/baogiabachngan_v2/actions/runs/44554973511
- PHP syntax and JavaScript syntax checks passed.
- Before: Google-Extended / permission false.
- Hosting exact readback passed.
- Local and Cloudflare cache refresh returned success.
- Final publicly served robots.txt contains the permission block.
- Removing the new block exactly reproduces the prior robots content.
- Six public path samples allowed; fifteen administrative/transactional/log samples denied for Google-Extended.
- Sampled decisions for Googlebot, GPTBot, ClaudeBot, OAI-SearchBot, PerplexityBot and wildcard unchanged.
- Home and About fetches returned HTTP 200.
- Temporary refresh helper disabled; no rollback or unconfirmed cleanup reported.
Artifacts: robots-before.txt, robots-after.txt, rollback.json and result.json retained 7 days.

## Rollback
Disable only wp-content/mu-plugins/lnl-google-extended.php (retain a backup), refresh site/CDN cache, and confirm the edge-served robots file matches robots-before.txt. Do not disable unrelated plugins or edit Cloudflare's broad training policies.
Deployment stops if the existing permission block is detected; repeated runs require explicit current-state inspection.

## Sources
https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec
https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers
https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/
