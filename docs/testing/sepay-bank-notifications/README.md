# SePay bank movement notifications

New bank transactions committed through the webhook or daily API pull notify active Managers and employees whose actual position is Accounting and who retain `page.sepay`. Both incoming and outgoing evidence are supported; outgoing import retains its existing rollout flag. A delegated SePay viewer, Sale Admin, warehouse, customer or supplier is not a recipient. Notification reads recheck current role/permissions, including previously persisted notes.

Each notification shows direction, amount, trusted company classification, last four account characters, bank timestamp and description, and links to the SePay list filtered by company/date/direction. A bank movement notification does not assert that a CRM receipt has been posted. Reconciliation and duplicate imports do not create additional movement events. No historical notification backfill runs.

Delivery reuses CRM bell + Web Push. Notification IDs are deterministic per event type, provider ID and recipient; the primary key provides atomic deduplication before push. Existing callers without a deduplication key keep their current behavior. Banking import commits before notifications are sent; rolled-back imports emit none. Notification failures are logged and do not roll back banking transactions; Web Push is best effort, as in existing CRM notifications. No exactly-once delivery guarantee across process failure is claimed.

No migration or new credential is required. No production transaction or notification was generated during testing. New tests cover overlapping/concurrent imports, recipient/device isolation, permission and role revocation, deduplication of bell/push attempts and rollback safety. Existing notification and SePay tests are also run before review.
