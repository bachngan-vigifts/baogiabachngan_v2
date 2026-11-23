# Product creation-date replay prerequisite

The production deployment previously applied `20261023120000_product_created_at.sql` without recording it in `supabase_migrations.schema_migrations`. Production had the column and valid indexes, but schema replay reached the newest-products index before `products.created_at` existed.

Manual metadata repair: `scripts/sql/repair-preview-product-created-at-history.sql`. It verifies the existing prerequisite column/index, stores the exact original migration text under version `20261023120000`, and rejects conflicting history. It does not execute its stored DDL or update business data. Do not add this maintenance script to automatic migrations/deployment.

Applied to production on 2026-11-19. Verified the history row exists, precedes `products_newest_index`, and the live newest index remains valid. No production index was rebuilt and no branch was created/reset for this repair.

`tests/db/product-created-at-history.test.ts` reproduces the missing-column failure on a fresh PostgreSQL WASM database, verifies repair guards/idempotence/business-row preservation, then replays the recorded source followed by the newest index successfully. `scripts/sql/assert-product-created-at-history.sql` provides a read-only operational check.
