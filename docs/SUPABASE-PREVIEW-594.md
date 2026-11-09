# Supabase Preview: follow-up to PR #594

PR #594 was already merged when this repair was requested. Its source branch
`fix/sepay-day-range` is preserved, including work added after that PR. Latest
`main` was pulled with `git pull origin main --ff-only` in a clean worktree and
merged into the source branch. No repair is pushed directly to `main`; the
follow-up PR must remain unmerged.

## Confirmed root cause

The repository orders `20261019035500_web_store_orders.sql` before
`20261021035601_web_order_financial_snapshot.sql`. Supabase's bootstrap instead
replays the parent project's `supabase_migrations.schema_migrations` registry.
The registry contains `web_order_financial_snapshot` at version
`20261021041220`, but omits the table's CREATE. There is no
`supabase/migrations` directory/configuration for the custom Drizzle directory.
Renaming an old repository file or adding a late migration cannot repair a
bootstrap that fails before that file is reached.

All existing SQL files are unchanged. The already-reviewed maintenance file
`scripts/sql/repair-preview-missing-history.sql` restores four missing entries
with the original SQL verbatim, only after validating the existing columns,
indexes and RLS. It never executes the application DDL stored in its payloads,
overwrites an existing history row, or changes application rows. Conflicting
history/schema fails the whole transaction.

The parent preflight (the guard transaction followed by ROLLBACK) passed. The
actual INSERT was blocked by automatic approval review: production history
changes require explicit owner authorization. No parent history was changed.

## Forward repair and verification

`20261109132941_web_order_financial_snapshot_guard.sql` was generated with
Supabase CLI 2.120.0 and moved into this project's `migrations/postgres`
directory. It adds a missing column without changing existing snapshots and
is safe to run again. A missing table fails visibly; it is not skipped. It
does not replace the history repair required before Preview can bootstrap.

`scripts/sql/assert-web-order-replay-history.sql` verifies that the registry
contains CREATE before any web-order reference and that the resulting column
and RLS exist. This check is read-only.

The complete web-order chain audited is CREATE, direct-access revocation,
GHN fields, financial snapshot, GHN address, stock status/index/backfill, CRM
edit fields and the new forward guard. `web_order_stock` needs GHN columns
before its UPDATE; the missing history repair restores that dependency too.

## Tests

```sh
TEST_PG_URL=postgres://preview_test@127.0.0.1:55494/postgres \
  node --import tsx tests/db/web-order-preview-chain.test.ts
node --import tsx tests/db/web-order-preview-chain.test.ts
npm run typecheck
npm run ui:build
```

PostgreSQL 17.11 on an isolated localhost server: 5/5 pass. PGlite: 5/5 pass.
The tests replay every migration, including access migrations (148 SQL files),
without creating any application table from a schema model. Only the Supabase
platform roles/storage bucket table are supplied by the test environment.
They cover empty database replay, an existing table awaiting the old financial
migration, a recorded old migration whose column is missing, preservation of
nonempty snapshots, repeated guarded history repair, and visible failure when
CREATE is absent. The application schema and sentinel rows are compared
before/after repair. The ordinary migration journal skips recorded files and
rejects changed content rather than rerunning old non-idempotent CREATE/ALTER.

## Remaining hosted step (requires owner authorization)

1. Review `scripts/sql/repair-preview-missing-history.sql` (exactly four missing
   history rows, no business DDL/DML) and authorize it for parent project
   `taceqfnsorewelsbdckg`.
2. Run it and the existing `assert-preview-history-baseline.sql` plus the new
   `assert-web-order-replay-history.sql` on the parent. Compare the preflight
   fingerprint of old history rows and application columns afterwards.
3. Rebuild only the follow-up PR's disposable Preview, then watch the native
   Supabase Preview check. The old #594 Preview was removed after its merge.
   Never reset the parent project or manually mark the check successful.

The forward migration remains a reviewed code change until normal deployment;
it has not been applied to production as part of this repair.
