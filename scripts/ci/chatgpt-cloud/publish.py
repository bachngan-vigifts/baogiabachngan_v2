"""Validate evidence before publishing a status. No caller-selected success state."""
import base64
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

REPOSITORY = 'bachngan-vigifts/baogiabachngan_v2'
CONTEXT = 'chatgpt-cloud/test'


def api(method, path, body=None, token=None):
    token = token or credentials()
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request('https://api.github.com' + path, data=data, method=method,
        headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'GitHub {method} request denied/failed: HTTP {error.code}') from None


_token = None


def credentials():
    global _token
    if _token:
        return _token
    names = ('CHATGPT_CI_APP_ID', 'CHATGPT_CI_INSTALLATION_ID', 'CHATGPT_CI_APP_KEY_FILE')
    if not all(os.environ.get(name) for name in names):
        raise RuntimeError('Missing dedicated GitHub status credential. Use cloud secret bindings; never paste secrets in chat.')
    if not re.fullmatch(r'\d+', os.environ[names[0]]) or not re.fullmatch(r'\d+', os.environ[names[1]]):
        raise RuntimeError('Invalid GitHub App identifiers')
    def b64(value):
        return base64.urlsafe_b64encode(value).rstrip(b'=')
    now = int(time.time())
    data = b64(json.dumps({'alg': 'RS256', 'typ': 'JWT'}).encode()) + b'.' + b64(json.dumps(
        {'iat': now - 30, 'exp': now + 540, 'iss': os.environ[names[0]]}).encode())
    signature = subprocess.run(['openssl', 'dgst', '-sha256', '-sign', os.environ[names[2]]],
                               input=data, capture_output=True, check=False)
    if signature.returncode:
        raise RuntimeError('Cannot sign GitHub App token; check secret-file binding')
    jwt = (data + b'.' + b64(signature.stdout)).decode()
    result = api('POST', '/app/installations/' + os.environ[names[1]] + '/access_tokens',
                 {'repositories': ['baogiabachngan_v2'],
                  'permissions': {'contents': 'read', 'pull_requests': 'read', 'checks': 'write',
                                  'administration': 'read'}}, token=jwt)
    _token = result['token']
    return _token


def load_manifest(control):
    manifest = json.loads((control / 'manifest.json').read_text())
    if manifest.get('repository') != REPOSITORY or manifest.get('kind') != 'pr':
        raise ValueError('Only a real PR job can publish; baseline and fixture runs are not publishable')
    if type(manifest.get('pr_number')) is not int or manifest['pr_number'] < 1:
        raise ValueError('Invalid PR number')
    if not re.fullmatch(r'[a-f0-9]{32}', manifest.get('job_id', '')):
        raise ValueError('Invalid job identifier')
    for name in ('source_sha', 'head_sha', 'base_sha'):
        if not re.fullmatch(r'[a-f0-9]{40}', manifest.get(name, '')):
            raise ValueError('Invalid ' + name)
    if not re.fullmatch(r'[a-f0-9]{64}', manifest.get('runner_sha256', '')):
        raise ValueError('Missing trusted runner digest')
    reports = Path(manifest['reports_dir']).resolve()
    if control.resolve().is_relative_to(reports) or reports.name != manifest['job_id']:
        raise ValueError('Control record must be outside container-writable artifacts')
    return manifest


def local_verdict(manifest, control):
    process = json.loads((control / 'process-result.json').read_text())
    reports = Path(manifest['reports_dir'])
    if type(process.get('exit_code')) is not int or process.get('phase') != 'complete' or process.get('cleanup_ok') is not True:
        return 'error', 'Test process did not complete successfully'
    if process.get('runner_sha256_after') != manifest.get('runner_sha256'):
        return 'error', 'Trusted runner changed during execution'
    summary = json.loads((reports / 'summary.json').read_text())
    if process['exit_code'] != 0:
        is_test_failure = summary.get('status') == 'failed' and summary.get('expectedSha') == manifest['source_sha']
        return ('failure', 'Test suite failed') if is_test_failure else ('error', 'Runner interrupted or failed readiness checks')
    if summary.get('status') != 'passed' or summary.get('expectedSha') != manifest['source_sha']:
        return 'failure', 'Test summary failed or source SHA differs'
    if summary.get('node') != 'v22.22.0' or not str(summary.get('php', '')).startswith('8.3.'):
        return 'error', 'Runtime versions differ'
    python = tuple(map(int, str(summary.get('python', '')).split('.')[:2]))
    if python < (3, 11):
        return 'error', 'Python/tomllib runtime missing'
    if not str(summary.get('jq', '')).startswith('jq-') or not str(summary.get('curl', '')).startswith('curl '):
        return 'error', 'Required shell tools are missing'
    if dt.datetime.fromisoformat(summary['startedAt'].replace('Z', '+00:00')) < dt.datetime.fromisoformat(manifest['started_at']):
        return 'error', 'Stale test artifact'
    shards = summary.get('shards', [])
    if len(shards) != 4 or {s.get('index') for s in shards} != {1, 2, 3, 4} or not all(
            s.get('total') == 4 and s.get('status') == 'passed' for s in shards):
        return 'failure', 'All four disjoint shards are required'
    commands = summary.get('commands', [])
    labels = [entry.get('label') for entry in commands]
    required = ['source-clean', 'pdf-runtime', 'typecheck', 'ui-build', 'quality-clean']
    required += [f'{prefix}-{index}' for index in range(1, 5) for prefix in ('tests', 'clean')]
    if any(labels.count(name) != 1 for name in required):
        return 'failure', 'Required commands are missing or duplicated'
    if any(entry.get('exitCode') != 0 or entry.get('signal') or entry.get('timedOut') for entry in commands):
        return 'failure', 'A command failed, timed out, or was cancelled'
    for index in range(1, 5):
        entry = next(item for item in commands if item['label'] == f'tests-{index}')
        args = entry.get('args', [])
        expected_args = ['--import', 'tsx', '--test', '--test-concurrency=2', f'--test-shard={index}/4',
                         '--test-reporter=spec', '--test-reporter-destination=stdout',
                         '--test-reporter=junit', f'--test-reporter-destination=/reports/junit-{index}.xml',
                         'tests/**/*.test.ts', 'src/**/*.test.ts']
        if args != expected_args:
            return 'failure', 'Test command does not cover the full declared suite'
        result_file = reports / f'junit-{index}.xml'
        if not result_file.is_file() or result_file.stat().st_size > 25 * 1024**2:
            return 'error', 'JUnit result missing or oversized'
        root = ET.parse(result_file).getroot()
        cases = list(root.iter('testcase'))
        counters_failed = any(int(suite.get('failures', '0')) or int(suite.get('errors', '0'))
                              for suite in root.iter('testsuite'))
        if not cases or all(case.find('skipped') is not None for case in cases) or list(root.iter('failure')) or list(root.iter('error')) or counters_failed:
            return 'failure', 'JUnit result is empty or contains failures'
    return 'success', 'All four shards, typecheck and UI build passed'


def current_target(manifest):
    pull = api('GET', f'/repos/{REPOSITORY}/pulls/{manifest["pr_number"]}')
    main = api('GET', f'/repos/{REPOSITORY}/branches/main')
    merge = api('GET', f'/repos/{REPOSITORY}/git/commits/{manifest["source_sha"]}')
    if pull['state'] != 'open' or pull.get('draft') or pull['base']['ref'] != 'main':
        raise ValueError('PR is closed, draft, or targets another branch')
    if pull['head']['repo']['full_name'] != REPOSITORY:
        raise ValueError('Fork execution is not authorized by this tester profile')
    valid = pull['head']['sha'] == manifest['head_sha'] and main['commit']['sha'] == manifest['base_sha']
    valid = valid and pull.get('merge_commit_sha') == manifest['source_sha']
    valid = valid and [parent['sha'] for parent in merge['parents']] == [manifest['base_sha'], manifest['head_sha']]
    protected = False
    if main.get('protected') is True:
        try:
            rule = api('GET', f'/repos/{REPOSITORY}/branches/main/protection')
            checks = rule.get('required_status_checks') or {}
            expected_app = int(os.environ.get('CHATGPT_CI_APP_ID', '0'))
            protected = expected_app > 0 and checks.get('strict') is True
            protected = protected and any(check.get('context') == CONTEXT and check.get('app_id') == expected_app
                                           for check in checks.get('checks', []))
            protected = protected and (rule.get('enforce_admins') or {}).get('enabled') is True
            protected = protected and rule.get('required_pull_request_reviews') is not None
            protected = protected and not (rule.get('allow_force_pushes') or {}).get('enabled', False)
            protected = protected and not (rule.get('allow_deletions') or {}).get('enabled', False)
        except (RuntimeError, ValueError):
            protected = False
    return valid, protected


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ('start', 'finish'):
        raise ValueError('Usage: publish.py start|finish CONTROL_DIRECTORY')
    mode, control = sys.argv[1], Path(sys.argv[2]).resolve()
    manifest = load_manifest(control)
    valid, protected = current_target(manifest)
    if not valid:
        state, description = 'error', 'PR head, main, or merge candidate changed; rerun required'
    elif mode == 'start':
        state, description = 'pending', 'Cloud tester running against current PR merge candidate'
    else:
        try:
            state, description = local_verdict(manifest, control)
        except (ValueError, KeyError, OSError, ET.ParseError):
            state, description = 'error', 'Invalid, missing, or incomplete test evidence'
        if state == 'success' and not protected:
            state, description = 'error', 'Tests passed but strict App-scoped main protection is not verified'
    record = control / 'github-check.json'
    if mode == 'start':
        body = {'name': CONTEXT, 'head_sha': manifest['head_sha'], 'external_id': manifest['job_id'],
                'status': 'in_progress' if state == 'pending' else 'completed',
                'output': {'title': description[:140], 'summary': 'Tester runs in ChatGPT cloud; this check does not run GitHub Actions.'}}
        if state != 'pending':
            body['conclusion'] = 'action_required'
        created = api('POST', f'/repos/{REPOSITORY}/check-runs', body)
        if created.get('app', {}).get('id') != int(os.environ['CHATGPT_CI_APP_ID']):
            raise ValueError('Check source differs from dedicated tester App')
        record.write_text(json.dumps({'id': created['id'], 'head_sha': manifest['head_sha'],
                                      'job_id': manifest['job_id'], 'app_id': created['app']['id']}))
    else:
        check = json.loads(record.read_text())
        if check.get('head_sha') != manifest['head_sha'] or check.get('job_id') != manifest['job_id'] or check.get('app_id') != int(os.environ['CHATGPT_CI_APP_ID']):
            raise ValueError('Check does not belong to this job')
        details = '\n'.join([
            'Compute: ChatGPT cloud; no GitHub Actions runner.',
            f'Job: `{manifest["job_id"]}`',
            f'PR head: `{manifest["head_sha"]}`',
            f'Base main: `{manifest["base_sha"]}`',
            f'Tested merge candidate: `{manifest["source_sha"]}`',
            f'Trusted runner SHA-256: `{manifest["runner_sha256"]}`',
            description,
            'Full logs and JUnit are retained in the cloud task artifacts. This is not a claim of 24/7 availability.'
        ])
        api('PATCH', f'/repos/{REPOSITORY}/check-runs/{check["id"]}',
            {'status': 'completed', 'conclusion': {'success': 'success', 'failure': 'failure', 'error': 'action_required'}[state],
             'output': {'title': description[:140], 'summary': details}})
    print(json.dumps({'state': state, 'context': CONTEXT, 'head_sha': manifest['head_sha']}))
    if state not in ('pending', 'success'):
        sys.exit(1)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Publishing blocked: ' + str(error), file=sys.stderr)
        sys.exit(2)
