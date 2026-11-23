# Lock store AI bridge

Replaces only the existing public chat API callback, retaining the storefront widget. Uses published, purchasable, visible, in-stock WooCommerce products and server-side Gemini. No order/customer changes. Queries return up to six product cards; variable prices are starting prices and final cart pricing remains authoritative.

Deploy from the dedicated workflow: verify syntax and product constraints, upload inactive bridge, privately test product grounding and greeting, enable only after tests, test existing live endpoint. API errors use a product-search fallback. Limits: 20 messages/IP/hour and 100 total/hour; no chat logs. No browser-side secrets.

Credentials are written at deployment to a guarded PHP file outside the web document root, never committed or included in artifacts. Existing theme code is retained. Deployment refuses to overwrite an existing bridge/config without review. If activation verification fails, configuration is reset to inactive.

Rollback: set LNL_GEMINI_ACTIVE to false in the private configuration under the cPanel account home. Alternatively disable the single mu-plugin lnl-store-ai-bridge.php through File Manager. The previous theme callback resumes on the next request. Do not remove or change other mu-plugins.
