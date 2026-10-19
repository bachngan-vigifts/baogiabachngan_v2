# ZXing browser fallback

Vendored official @zxing/browser 0.1.5 UMD release, fetched from the npm registry. Loads on demand from the CRM origin; camera frames are decoded locally. No CDN dependency.

- File: zxing-browser-0.1.5.min.js
- SHA-256: b5ad3df920738ca7adcb74508d7e6b6a5b9024993fb9a0c702da1ad8964eca07
- Upstream: https://github.com/zxing-js/browser
- Browser package license: LICENSE (MIT).
- Bundled @zxing/library license: LICENSE-library (Apache-2.0).

Use native BarcodeDetector when available; this bundle supports browsers such as iOS Safari that lack it. Dependencies are bundled in the official UMD file. No project npm dependency or lockfile change.
