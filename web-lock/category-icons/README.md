# Homepage category product icons

Replace only desktop hero menu arrows with 25px product thumbnails. Product choices are cached for one day; images fail back to existing arrows. Mobile drawer remains unchanged.

Deployment rejects existing target files, verifies exact bytes, checks all menu images load, and disables the isolated MU file on failure. Roll back by disabling only `lnl-home-category-icons.php`; no existing snippet is modified. Workflow preserves before-existing theme behavior and stores desktop/mobile screenshots.

Shipping tooltip is pending confirmation of conflicting public free-shipping thresholds (200,000 vs 1,000,000 VND) and dispatch warehouse; it is not included in this release.
