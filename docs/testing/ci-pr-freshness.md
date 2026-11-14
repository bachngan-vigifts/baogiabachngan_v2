# PR freshness guard

Based on main 3d18892c62b5ba91a8a78378e6f011cbd7d3aeec, building on #662.
Open PRs #666–#676 were inspected: no open CI freshness change found.
The complete main tree has no AGENTS.md or .agents/skills; the local .agents directory is empty.

## Behavior

The prepare job checks freshness before npm installation and again after typecheck/smoke.
For ready PRs, read the live PR, pin current base SHA, compare base...event head, and
require base to be the merge base with zero behind commits. Inspect the immutable
github.sha merge commit: its parents must be exactly current base and event head.
Read PR and base again to detect races within the API sequence. Unknown, malformed,
missing or failed API responses fail closed. No mergeable_state heuristic, check
reuse, result cache, status writes, privileged pull_request_target or production secrets.

All jobs checkout github.sha explicitly with persist-credentials=false. Full test
globs, four shards, typecheck and smoke coverage remain. New dependency-free guard
tests run once in prepare. Only contents:read and pull-requests:read are granted;
shards narrow this to contents:read. github-script gets the ephemeral token only;
no token is exported to npm/test shell steps. No actions/checks/statuses write rights.

The aggregate runs with always(), rechecks freshness, and requires successful
prepare plus successful full matrix. Every PR instantiates the four unchanged names
test shard 1/4 through 4/4. When prepare fails or full mode is false, each immediately
fails before checkout/npm. This avoids ambiguous skipped matrix names/expected checks.
Drafts retain smoke feedback but all five required full-validation contexts fail
with an explicit Ready for review instruction. This is deliberate, not a test regression.
Ready/converted-to-draft/synchronize events cancel the previous PR run and start the
appropriate mode. Manual full/smoke remain separate concurrency groups and use
manual shard / manual validation names, so cannot satisfy PR requirements.

## Race boundaries and recovery

- Already stale: prepare fails with Update branch before installing dependencies.
- Main changes during prepare: second gate stops full tests.
- Main changes after prepare or while shards run: aggregate refuses green. Already
  started shard work is not automatically cancelled (no write token or polling job).
- Main changes after the final API read: only strict branch protection can atomically
  enforce merge eligibility. The workflow cannot lock main; keep strict protection.
- Head/base/state changes: reject the old event. A new synchronize/ready event runs
  against its own SHA. Failed-job reruns do not allow old merge parents or another head.
- Base retarget alone is not a trigger; push/update branch or toggle ready after
  retargeting. Do not treat the previous target's validation as current.
- API outage/rate limit: failure, never assumed fresh. Retry after recovery; if stale,
  Update branch first. An old merge SHA cannot be fixed by merely reusing old results.
- Cancellation, runner/billing outages, merge conflicts, disabled Actions or GitHub
  failures may prevent jobs starting/completing; no workflow can guarantee completion
  in those conditions. Missing/failed checks must remain merge-blocking.

## Cost and rollout

No push trigger, dispatch, polling, automatic branch update or mass rerun is added.
A fresh ready PR performs three bounded sequences of six reads, with retries disabled.
Drafts use only a PR read per gate. A stale PR still pays for prepare, four short
failure jobs and aggregate (runner startup/minimum billing); a draft similarly pays
for four extra short failure jobs to settle the exact required names. Savings are
the avoided full test runtimes, not zero Actions minutes. Existing queued/running
jobs and branches without this workflow are unaffected. Main changing alone does
not start fresh PR CI. No measured savings are claimed.

Branch API confirms protected=true and five GitHub Actions required checks (app 15368).
Detailed protection GET returned 403 Resource not accessible by integration, so strict
was not independently reverified. No protection settings were changed. Keep the draft
unmerged until a reviewer confirms strict and a ready full run passes on the current
revision. Publishing this draft can automatically run draft CI; no manual run was requested.

## Validation

148 local Node tests pass: fresh/stale/diverged/unknown ancestry, malformed responses,
HTTP 403/404/429/500 across all endpoints, timeout, head/base/state/draft races,
manual bypass, 100 real aggregate-shell combinations, 15 real shard-guard combinations,
and workflow invariants. YAML parses successfully. Live read-only PR #676 confirms
GitHub merge parent order is base then head. Local runtime is Node 24.22.1; CI remains
22.22.0. No app logic or dependency change; full application suite was not run locally.
Actionlint is unavailable; GitHub execution remains to validate runner integration.

GitHub references:
- https://docs.github.com/en/pull-requests/reference/status-checks (skipped is accepted;
  therefore do not use skip as evidence of full tests)
- https://docs.github.com/en/repositories/configuring-branches-and-merges/managing-protected-branches/about-protected-branches
- https://docs.github.com/rest/commits/commits#compare-two-commits

Rollback: revert this PR; do not relax required checks or strict protection.
