# Weekly report workspace v2

Reference: https://b-o-c-o-tu-n-ph-n-t-i-nh-p-b-n-3-17.vercel.app/

The employee weekly report now opens the full workspace from the menu. Its back
button returns to the existing monthly report list. Managers retain the review
matrix and open the same workspace in read-only mode. Month assignment follows
the existing deadline month (Monday after the reported week), including links
from report tasks. Monthly reporting and payroll/deadline calculations are unchanged.

## Included behavior

Six KPI cards, automatic CRM facts alongside the manual report, ten manual
sections, mobile tabs, completion tracking, automatic draft saves and official
submission. Manual sections cover previous promises, seven customer sectors,
quote feedback/probabilities, new opportunities, customer occasions, debt
promises, production notes, next-week targets/tasks, support and self-assessment.

Forecasts use server-owned open quote totals and selected probabilities; they do
not create sales orders or count as realized revenue. Weekly pre-VAT sales use
order subtotals and are labeled accordingly; existing payroll revenue sources
remain unchanged. Legacy read-only reports without probability data show an
unknown forecast rather than an invented zero.

Open quotes are owner-scoped, limited to 200 from the last 90 days and disclose
truncation. Current production and historical customer prompts are bounded to
50 each. Historical customer prompts use actual prior-year orders, not invented
anniversary dates. Customer-sector classification is advisory.

New opportunities and occasions are stored in report JSON. Official submission
creates follow-up tasks for them, dated plan tasks and internal debt promises.
Draft saving alone does not create tasks. Occasion tasks are due 45 calendar days
before the entered event; due reminders appear inside CRM on login, resume or
next-day check. This does not enable external/offline email, Zalo or push delivery.
Internal debt promises do not change contractual payment schedules. Existing
manual task completion is retained when the report is resubmitted. Removed open
entries cancel their corresponding follow-up tasks. Self-reported assessments of
last week's commitments do not automatically complete those tasks.

## Persistence and access

No migration is required: structured `workspaceVersion: 2` inputs, snapshots and
command fingerprints use existing report/draft/version JSON fields. Follow-ups
use the existing task table and unique auto key. Report and task changes share
one transaction. Failed task creation rolls back official submission and leaves
the draft available. Stable per-entry keys prevent duplicates on resubmit.

Draft writes use expected timestamps and employee locks. Official writes require
expected report version and draft timestamp. A command key and normalized input
fingerprint allow retries after a lost response, including historical retries
without reverting newer revisions. Old clients cannot overwrite v2 content with
legacy fields. The first official timestamp remains the scoring basis.

Employees can access their own report and actions; managers can inspect/review
reports of the existing eligible positions. Task titles are generic; report task
descriptions are redacted for peer viewers under the existing task visibility
rules. No changes to RLS, database configuration, financial or tax formulas.

## Verification

Use Node >=22.22 and installed repository dependencies:

```sh
npm run typecheck
npm run ui:build
node --import tsx --test src/modules/staff-reports/domain/workspace.test.ts tests/app/staff-weekly-workspace.test.ts
node --import tsx scripts/testing/weekly-report-workspace.mjs
```

The browser script uses Chromium/Playwright and the actual CRM/router with a
synthetic PGlite fixture. Set `PLAYWRIGHT_MODULE` to the installed Playwright
module if needed. No production sessions or customer records are used.

New domain/API tests: 7 passing. Existing report integration: 9 passing; existing
weekly rules: 6 passing; task regression: 9 passing; customer-care regression:
2 passing; report navigation: 7 passing; peer task access: passing. Browser assertions cover desktop/mobile, all ten sections, forecast,
opportunity/event task creation, serial autosaves, stale-tab conflicts, a 503
*after* successful commit followed by replay, resubmission without duplicate
tasks, Manager read-only/review, no horizontal overflow, and toolbar clearance
above the actual mobile dock. Task-insert failure rollback is tested explicitly.

Screenshots are produced under `/workspace/artifacts/weekly-report-redesign/`.
Synthetic local tests do not establish production load capacity or real-user
production deployment. Check the PR's CI and deployed CRM separately before
reporting the feature live.

PR #715 CI correction: the architecture test caught a forbidden report/task
module dependency. Task persistence/reminder reads now live in
`src/app/weekly-report-tasks.ts` and are injected by the application router.
The task reconciliation source reads its own table within the task module.
The architecture allow-list and cycle checks are unchanged.
