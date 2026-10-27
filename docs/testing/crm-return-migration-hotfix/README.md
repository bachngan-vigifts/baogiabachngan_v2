# Orders/contracts production schema mismatch

## Evidence

On 2026-10-27 the production Postgres logs repeatedly reported `column pos_returns.source does not exist`. An information_schema inspection confirmed the source column was absent and the old NOT NULL constraints were still present. The CRM return API from merged PR #335 had deployed without its migration: deploy-api.yml explicitly concatenated selected migration files and omitted 20261027040000_crm_returns.sql.

Both list/detail flows read the shared return ledger through returnAdjustments(), whose select-all includes source. The absent column therefore fails even for an order with no return rows.

## Fix

Include the CRM return migration in the existing pre-Edge-deployment SQL step. Make the migration safely repeatable: ADD COLUMN IF NOT EXISTS and relation-scoped checks before adding the two constraints. This retains the original POS/CRM source and cash refund constraints; no financial/stock data migration is added.

## Verification

- Typecheck passes.
- New real-router/PGlite regression reproduces 500 for `/orders?flow=order`, `/contracts`, `/orders/regular`, `/orders/contract` on a legacy schema. Applying migration twice restores 200 for all four.
- Legacy POS return history (all original columns), stock_moves and RLS are unchanged. The legacy row becomes source=pos. Invalid sources and POS rows without a register remain rejected.
- Workflow check ensures this migration is included before the Edge Function deployment command.
- Related CRM/POS return tests also pass: 4 CRM return tests and 9 POS return tests. Together with the 2 new regressions: 15 passing tests. The full suite runs on PR CI.

## Production operation status

Preflight: one return, zero refunds, 3,042 stock moves, total movement quantity 309,157. No business records were changed by investigation.

Automatic approval review rejected applying the live migration because earlier schema/API approval covered PR implementation, not execution of production DDL. An explicit production approval has been requested. This PR alone does not claim the live database has been repaired.
