"""Synthetic safety tests only. Never publish fixture results to GitHub."""
import copy
import importlib.util
import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).with_name('publish.py'))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='cloud-tester-publisher-')
        root = Path(self.tmp.name)
        job_id = 'a' * 32
        self.control = root / 'jobs' / job_id
        self.reports = root / 'artifacts' / job_id
        self.control.mkdir(parents=True)
        self.reports.mkdir(parents=True)
        self.manifest = {'kind': 'pr', 'repository': publisher.REPOSITORY, 'pr_number': 1,
                         'job_id': job_id, 'source_sha': '1' * 40, 'head_sha': '2' * 40,
                         'base_sha': '3' * 40, 'runner_sha256': 'a' * 64,
                         'started_at': '2026-01-01T00:00:00+00:00', 'reports_dir': str(self.reports)}
        self.process = {'exit_code': 0, 'phase': 'complete', 'cleanup_ok': True, 'runner_sha256_after': 'a' * 64}
        commands = [{'label': name, 'exitCode': 0, 'signal': None, 'timedOut': False}
                    for name in ['source-clean', 'pdf-runtime', 'typecheck', 'ui-build', 'quality-clean']]
        for index in range(1, 5):
            commands.extend([
                {'label': f'tests-{index}', 'exitCode': 0, 'signal': None, 'timedOut': False,
                 'args': ['--import', 'tsx', '--test', '--test-concurrency=2', f'--test-shard={index}/4',
                          '--test-reporter=spec', '--test-reporter-destination=stdout',
                          '--test-reporter=junit', f'--test-reporter-destination=/reports/junit-{index}.xml',
                          'tests/**/*.test.ts', 'src/**/*.test.ts']},
                {'label': f'clean-{index}', 'exitCode': 0, 'signal': None, 'timedOut': False}])
            (self.reports / f'junit-{index}.xml').write_text('<testsuites><testsuite tests="1" failures="0" errors="0"><testcase name="synthetic-safety-fixture"/></testsuite></testsuites>')
        quality = {
            'source-clean': ('git', ['diff', '--exit-code', 'HEAD', '--']),
            'quality-clean': ('git', ['diff', '--exit-code', 'HEAD', '--']),
            'typecheck': ('npm', ['run', 'typecheck']),
            'ui-build': ('npm', ['run', 'ui:build']),
            'pdf-runtime': ('/opt/node22/bin/node', ['--input-type=module', '-e', "const pdf=await import('pdfjs-dist/legacy/build/pdf.mjs'); console.log(pdf.version)"]),
        }
        for command in commands:
            if command['label'] in quality:
                command['binary'], command['args'] = quality[command['label']]
            elif command['label'].startswith('tests-'):
                command['binary'] = '/opt/node22/bin/node'
            elif command['label'].startswith('clean-'):
                command.update(binary='git', args=['diff', '--exit-code', 'HEAD', '--'])
        self.summary = {'status': 'passed', 'expectedSha': '1' * 40, 'node': 'v22.22.0', 'php': '8.3.36',
                        'python': '3.13.5', 'jq': 'jq-1.8.1', 'curl': 'curl 8.14.1', 'startedAt': '2026-01-01T00:00:01Z', 'commands': commands,
                        'shards': [{'index': i, 'total': 4, 'status': 'passed'} for i in range(1, 5)]}
        self.rule = {'required_status_checks': {'strict': True, 'checks': [{'context': publisher.CONTEXT, 'app_id': 1234}]},
                     'enforce_admins': {'enabled': True}, 'required_pull_request_reviews': {'required_approving_review_count': 0},
                     'allow_force_pushes': {'enabled': False}, 'allow_deletions': {'enabled': False}}
        self.pull = {'state': 'open', 'draft': False, 'base': {'ref': 'main'},
                     'head': {'sha': '2' * 40, 'repo': {'full_name': publisher.REPOSITORY}}, 'merge_commit_sha': '1' * 40}
        self.main = {'protected': True, 'commit': {'sha': '3' * 40}}
        self.merge = {'parents': [{'sha': '3' * 40}, {'sha': '2' * 40}]}
        self.flush()

    def tearDown(self):
        self.tmp.cleanup()

    def flush(self):
        (self.control / 'manifest.json').write_text(json.dumps(self.manifest))
        (self.control / 'process-result.json').write_text(json.dumps(self.process))
        (self.reports / 'summary.json').write_text(json.dumps(self.summary))

    def verdict(self):
        self.flush()
        return publisher.local_verdict(self.manifest, self.control)[0]

    def target(self):
        def fake_api(method, path, body=None, token=None):
            self.assertEqual(method, 'GET')
            if path.endswith('/protection'):
                return self.rule
            if '/pulls/' in path:
                return self.pull
            if path.endswith('/branches/main'):
                return self.main
            if '/git/commits/' in path:
                return self.merge
            raise AssertionError('Unexpected API path')
        with patch.object(publisher, 'api', fake_api), patch.dict(os.environ, {'CHATGPT_CI_APP_ID': '1234'}):
            return publisher.current_target(self.manifest)

    def test_complete_evidence_is_eligible_locally(self):
        self.assertEqual(self.verdict(), 'success')

    def test_false_command_exit_is_not_numeric_zero(self):
        self.summary['commands'][0]['exitCode'] = False
        self.assertEqual(self.verdict(), 'failure')

    def test_noop_typecheck_cannot_be_labelled_as_pass(self):
        next(c for c in self.summary['commands'] if c['label'] == 'typecheck')['args'] = ['run', 'unrelated']
        self.assertEqual(self.verdict(), 'failure')

    def test_boolean_shard_index_is_not_a_real_shard(self):
        self.summary['shards'][0]['index'] = True
        self.assertEqual(self.verdict(), 'failure')

    def test_optional_skips_remain_visible_in_check_summary(self):
        (self.reports / 'junit-1.xml').write_text('<testsuites><testsuite><testcase name="passed"/><testcase name="requires-isolated-postgres"><skipped/></testcase></testsuite></testsuites>')
        code, calls = self.invoke_main('finish')
        self.assertEqual(code, 0)
        self.assertIn('4 passed, 1 skipped', calls[0][2]['output']['summary'])

    def test_failed_process_cannot_become_success(self):
        self.process['exit_code'] = 1
        self.summary['status'] = 'failed'
        self.assertEqual(self.verdict(), 'failure')

    def test_cancelled_process_is_not_success(self):
        self.process['exit_code'] = 143
        self.summary['status'] = 'cancelled'
        self.assertEqual(self.verdict(), 'error')

    def test_unfinished_setup_is_not_success(self):
        self.process['phase'] = 'setup'
        self.assertEqual(self.verdict(), 'error')

    def test_failed_cleanup_is_not_success(self):
        self.process['cleanup_ok'] = False
        self.assertEqual(self.verdict(), 'error')

    def test_changed_runner_is_not_success(self):
        self.process['runner_sha256_after'] = 'b' * 64
        self.assertEqual(self.verdict(), 'error')

    def test_boolean_exit_code_is_rejected(self):
        self.process['exit_code'] = False
        self.assertEqual(self.verdict(), 'error')

    def test_wrong_source_sha_is_not_success(self):
        self.summary['expectedSha'] = '4' * 40
        self.assertEqual(self.verdict(), 'failure')

    def test_missing_or_duplicate_shards_are_not_success(self):
        self.summary['shards'] = [self.summary['shards'][0]] * 4
        self.assertEqual(self.verdict(), 'failure')

    def test_wrong_runtime_is_not_success(self):
        self.summary['node'] = 'v24.19.0'
        self.assertEqual(self.verdict(), 'error')

    def test_old_artifact_is_not_success(self):
        self.summary['startedAt'] = '2025-12-31T23:59:59Z'
        self.assertEqual(self.verdict(), 'error')

    def test_missing_shell_runtime_is_not_success(self):
        self.summary.pop('jq')
        self.assertEqual(self.verdict(), 'error')

    def test_missing_quality_step_is_not_success(self):
        self.summary['commands'] = [c for c in self.summary['commands'] if c['label'] != 'typecheck']
        self.assertEqual(self.verdict(), 'failure')

    def test_timed_out_command_is_not_success(self):
        self.summary['commands'][0]['timedOut'] = True
        self.assertEqual(self.verdict(), 'failure')

    def test_extra_test_filter_is_rejected(self):
        next(c for c in self.summary['commands'] if c['label'] == 'tests-1')['args'].append('--test-only')
        self.assertEqual(self.verdict(), 'failure')

    def test_missing_junit_is_not_success(self):
        (self.reports / 'junit-1.xml').unlink()
        self.assertEqual(self.verdict(), 'error')

    def test_junit_failure_is_not_success(self):
        (self.reports / 'junit-1.xml').write_text('<testsuite><testcase><failure>synthetic</failure></testcase></testsuite>')
        self.assertEqual(self.verdict(), 'failure')

    def test_all_skipped_junit_is_not_success(self):
        (self.reports / 'junit-1.xml').write_text('<testsuite><testcase><skipped/></testcase></testsuite>')
        self.assertEqual(self.verdict(), 'failure')

    def test_baseline_cannot_be_published(self):
        self.manifest['kind'] = 'baseline'
        self.flush()
        with self.assertRaises(ValueError):
            publisher.load_manifest(self.control)

    def test_manifest_without_digest_is_rejected(self):
        del self.manifest['runner_sha256']
        self.flush()
        with self.assertRaises(ValueError):
            publisher.load_manifest(self.control)

    def test_live_target_and_strict_app_source(self):
        self.assertEqual(self.target(), (True, True))

    def test_new_head_or_main_invalidates_target(self):
        self.pull['head']['sha'] = '4' * 40
        self.assertEqual(self.target()[0], False)
        self.pull['head']['sha'] = '2' * 40
        self.main['commit']['sha'] = '4' * 40
        self.assertEqual(self.target()[0], False)

    def test_wrong_merge_parents_invalidates_target(self):
        self.merge['parents'].reverse()
        self.assertFalse(self.target()[0])

    def test_strict_main_protection_is_required(self):
        self.rule['required_status_checks']['strict'] = False
        self.assertFalse(self.target()[1])

    def test_other_app_cannot_supply_required_check(self):
        self.rule['required_status_checks']['checks'][0]['app_id'] = 9999
        self.assertFalse(self.target()[1])

    def test_admin_bypass_is_not_accepted(self):
        self.rule['enforce_admins']['enabled'] = False
        self.assertFalse(self.target()[1])

    def test_force_push_is_not_accepted(self):
        self.rule['allow_force_pushes']['enabled'] = True
        self.assertFalse(self.target()[1])

    def test_fork_is_not_executed(self):
        self.pull['head']['repo']['full_name'] = 'other/fork'
        with self.assertRaises(ValueError):
            self.target()

    def test_missing_credentials_stop_before_network(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(publisher, '_token', None), patch.object(publisher.urllib.request, 'urlopen') as network:
            with self.assertRaises(RuntimeError):
                publisher.credentials()
            network.assert_not_called()

    def test_inline_or_relative_key_binding_never_reaches_openssl(self):
        for key in ('inline-key\nnot-a-path', 'relative-key.pem', '/' + 'x' * 4100):
            with self.subTest(key_type='invalid binding'), patch.dict(os.environ, {
                    'CHATGPT_CI_APP_ID': '1234', 'CHATGPT_CI_INSTALLATION_ID': '5678',
                    'CHATGPT_CI_APP_KEY_FILE': key}, clear=True), patch.object(publisher, '_token', None), patch.object(publisher.subprocess, 'run') as process, patch.object(publisher.urllib.request, 'urlopen') as network:
                with self.assertRaises(RuntimeError):
                    publisher.credentials()
                process.assert_not_called()
                network.assert_not_called()

    def invoke_main(self, mode, app_id=1234):
        calls = []
        if mode == 'finish':
            (self.control / 'github-check.json').write_text(json.dumps(
                {'id': 55, 'head_sha': self.manifest['head_sha'], 'job_id': self.manifest['job_id'], 'app_id': 1234}))
        def fake_api(method, path, body=None, token=None):
            if method in ('POST', 'PATCH'):
                calls.append((method, path, copy.deepcopy(body)))
                return {'id': 55, 'app': {'id': app_id}}
            if path.endswith('/protection'):
                return self.rule
            if '/pulls/' in path:
                return self.pull
            if path.endswith('/branches/main'):
                return self.main
            if '/git/commits/' in path:
                return self.merge
            raise AssertionError('Unexpected API call')
        code = 0
        with patch.object(publisher, 'api', fake_api), patch.dict(os.environ, {'CHATGPT_CI_APP_ID': '1234'}), patch.object(publisher.sys, 'argv', ['publish.py', mode, str(self.control)]), contextlib.redirect_stdout(io.StringIO()):
            try:
                publisher.main()
            except SystemExit as result:
                code = result.code
        return code, calls

    def test_start_only_creates_pending_check(self):
        self.main['protected'] = False
        code, calls = self.invoke_main('start')
        self.assertEqual(code, 0)
        self.assertEqual(calls[0][0], 'POST')
        self.assertEqual(calls[0][2]['status'], 'in_progress')
        self.assertNotIn('conclusion', calls[0][2])

    def test_finish_completes_only_valid_job_success(self):
        code, calls = self.invoke_main('finish')
        self.assertEqual(code, 0)
        self.assertEqual(calls[0][0], 'PATCH')
        self.assertEqual(calls[0][2]['conclusion'], 'success')
        self.assertIn(self.manifest['source_sha'], calls[0][2]['output']['summary'])

    def test_finish_missing_shard_is_failure_not_neutral(self):
        self.summary['shards'].pop()
        self.flush()
        code, calls = self.invoke_main('finish')
        self.assertEqual(code, 1)
        self.assertEqual(calls[0][2]['conclusion'], 'failure')

    def test_finish_new_commit_requires_action(self):
        self.pull['head']['sha'] = '4' * 40
        code, calls = self.invoke_main('finish')
        self.assertEqual(code, 1)
        self.assertEqual(calls[0][2]['conclusion'], 'action_required')

    def test_finish_unprotected_main_never_reports_success(self):
        self.main['protected'] = False
        code, calls = self.invoke_main('finish')
        self.assertEqual(code, 1)
        self.assertEqual(calls[0][2]['conclusion'], 'action_required')

    def test_wrong_app_source_cannot_register_as_trusted_check(self):
        with self.assertRaises(ValueError):
            self.invoke_main('start', app_id=9999)
        self.assertFalse((self.control / 'github-check.json').exists())

    def test_baseline_does_not_call_github_api(self):
        self.manifest['kind'] = 'baseline'
        self.flush()
        with patch.object(publisher, 'api') as network, patch.object(publisher.sys, 'argv', ['publish.py', 'start', str(self.control)]):
            with self.assertRaises(ValueError):
                publisher.main()
            network.assert_not_called()


if __name__ == '__main__':
    unittest.main()
