"""Exercise launch rejection paths before Docker, networking or secret mounts."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

LAUNCH = Path(__file__).with_name('launch.sh')
REPO = 'https://github.com/bachngan-vigifts/baogiabachngan_v2.git'


class LaunchGuards(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.repo = root / 'checkout'
        self.repo.mkdir()
        self.state = root / 'state'
        self.git('init', '-q')
        self.git('config', 'user.name', 'Synthetic guard test')
        self.git('config', 'user.email', 'guard@example.invalid')
        self.git('remote', 'add', 'origin', REPO)
        (self.repo / '.gitignore').write_text('.env\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'Synthetic launcher guard fixture')
        self.sha = self.git('rev-parse', 'HEAD').strip()

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], text=True, stderr=subprocess.DEVNULL)

    def reject(self, expected=None, sha=None, state=None, extra_env=None):
        env = dict(os.environ)
        env.pop('CHATGPT_CI_APP_KEY_FILE', None)
        env.update(extra_env or {})
        result = subprocess.run(['bash', str(LAUNCH), str(self.repo), sha or self.sha, str(state or self.state)],
                                env=env, capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        if expected:
            self.assertIn(expected, result.stdout + result.stderr)
        self.assertFalse(self.state.exists(), 'Guard must reject before creating state or starting a worker')
        self.assertNotIn('SYNTHETIC_KEY_MUST_NOT_PRINT', result.stdout + result.stderr)

    def test_wrong_sha_rejected_before_worker(self):
        self.reject(sha='0' * 40)

    def test_ignored_secret_file_rejected_before_mount(self):
        (self.repo / '.env').write_text('SYNTHETIC_KEY_MUST_NOT_PRINT')
        self.reject('Fresh checkout required')

    def test_state_inside_checkout_rejected_before_worker(self):
        self.reject('State and trusted controller must be outside', state=self.repo / 'state')

    def test_secret_binding_inside_checkout_rejected_before_mount(self):
        self.reject('Credential binding must be outside', extra_env={
            'CHATGPT_CI_APP_KEY_FILE': str(self.repo / '.git' / 'synthetic-key.pem')})

    def test_local_credential_header_rejected_without_logging_value(self):
        self.git('config', 'http.https://github.com/.extraheader', 'SYNTHETIC_KEY_MUST_NOT_PRINT')
        self.reject('Refusing checkout with local credential configuration')


if __name__ == '__main__':
    unittest.main()
