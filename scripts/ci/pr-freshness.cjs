'use strict';

// Read-only, fail-closed check of THIS run's immutable merge SHA and event head.
// Never inspect prior check runs or publish a status for another SHA.
module.exports = async function freshness({ github, context }) {
  if (context.eventName !== 'pull_request') return;
  const event = context.payload.pull_request;
  const repo = context.repo;
  const fail = message => { throw new Error(message); };
  const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
  if (!event || !sha(event.head?.sha) || !sha(context.sha) ||
      !event.base?.ref || typeof event.draft !== 'boolean') fail('Invalid PR event; refusing full validation.');
  const readPR = async () => (await github.rest.pulls.get({ ...repo, pull_number: event.number })).data;
  const validatePR = pr => {
    if (pr.state !== 'open' || pr.head?.sha !== event.head.sha ||
        pr.base?.ref !== event.base.ref || pr.base?.repo?.full_name !== event.base.repo.full_name ||
        pr.draft !== event.draft) fail('PR head/base/state changed during CI. Use the latest PR run; do not reuse this result.');
  };
  const readBase = async () => {
    const ref = (await github.rest.git.getRef({ ...repo, ref: 'heads/' + event.base.ref })).data;
    if (!sha(ref.object?.sha)) fail('Invalid base API response; refusing full validation.');
    return ref.object.sha;
  };
  validatePR(await readPR());
  // Drafts keep fast feedback; the required aggregate never claims full validation.
  if (event.draft) return;
  const base = await readBase();
  const comparison = (await github.rest.repos.compareCommitsWithBasehead({
    ...repo, basehead: base + '...' + event.head.sha, per_page: 1
  })).data;
  if (!['ahead', 'identical'].includes(comparison.status) ||
      comparison.merge_base_commit?.sha !== base || comparison.behind_by !== 0) {
    fail('Update branch: PR does not contain the latest ' + event.base.ref + '. Update branch, then wait for a new full CI run.');
  }
  const commit = (await github.rest.repos.getCommit({ ...repo, ref: context.sha })).data;
  if (commit.sha !== context.sha || commit.parents?.length !== 2 ||
      commit.parents[0].sha !== base || commit.parents[1].sha !== event.head.sha) {
    fail('Update branch: this run tests an outdated merge commit. Use a fresh PR run for the latest base and head.');
  }
  validatePR(await readPR());
  if (await readBase() !== base) fail('Update branch: base changed while CI checked freshness. Update branch and run full CI again.');
};
