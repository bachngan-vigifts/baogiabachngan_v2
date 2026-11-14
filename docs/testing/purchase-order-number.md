# Minh Long supplier order number

Draft creation/edit accepts an optional `internalNo` (text, max 100 characters; leading zeros retained). Both purchase creation interfaces offer separate inputs for selected Minh Long suppliers; the restock page includes these values in its saved local draft.

Manager approval and staff confirmation-on-behalf require a nonblank number for a supplier whose normalized name contains the Minh Long name. The UI and API use the same generated pure policy. Checks run after permission/revision validation and before mutations inside the existing transaction. A number entered earlier is reused when omitted; an explicit blank cannot clear it at those approval steps. Switching supplier on a draft clears an omitted old number rather than carrying it to another supplier.

Other suppliers remain optional, even when their products are Minh Long. Save-draft, submit-for-review and save-prices remain allowed with no number. No schema migration or production data rewrite.

Validation: local typecheck, UI build, focused API/DOM-handler tests, purchasing workflow, product lookup/create/supplier search, architecture, restock parser/API, inventory and CRM audit regressions. Existing approval fixtures now supply a number for Minh Long. Test scenarios include whitespace/invalid values, multi-supplier batches, preserving leading zeros, edits, revision/permission denial, atomic rejection, legacy approved orders and both approval gates.

Browser limitation: this execution environment blocks Chromium startup (`socket() failed: Operation not permitted`, observed during the related UI task). Actual desktop/mobile rendering was not verified for this change. Form controls reuse existing responsive grid/input classes.

No merge, deployment, protection change, manual workflow dispatch or rerun.
