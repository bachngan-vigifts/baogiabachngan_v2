const required = ['CPANEL_BASE_URL', 'CPANEL_USERNAME', 'CPANEL_API_TOKEN', 'SEPAY_API_TOKEN'];
for (const name of required) if (!process.env[name]?.trim()) throw new Error(`Missing ${name}`);

const raw = process.env.CPANEL_BASE_URL.trim();
const cpanel = new URL(raw.includes('://') ? raw : `https://${raw}`);
if (cpanel.protocol !== 'https:') throw new Error('cPanel must use HTTPS');
if (!cpanel.port) cpanel.port = '2083';
const cpanelAuth = `cpanel ${process.env.CPANEL_USERNAME.trim()}:${process.env.CPANEL_API_TOKEN.trim()}`;

async function uapi(module, fn, params = {}) {
  const url = new URL(`/execute/${module}/${fn}`, cpanel);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { Authorization: cpanelAuth }, signal: AbortSignal.timeout(40_000) });
  const body = await response.json();
  if (!response.ok || !body.status) throw new Error(`${module}/${fn} failed`);
  return body.data;
}

function findDomainRoot(tree, domain) {
  let root = '';
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (value.domain === domain && typeof value.documentroot === 'string') root = value.documentroot;
    for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child);
  }
  walk(tree);
  const prefix = `/home/${process.env.CPANEL_USERNAME.trim()}/`;
  if (!root.startsWith(prefix) || root.includes('..')) throw new Error(`${domain} document root not verified`);
  return root;
}

const domains = await uapi('DomainInfo', 'domains_data', { format: 'hash' });
const roots = {
  minhlong: findDomainRoot(domains, 'minhlongonline.com'),
  lock: findDomainRoot(domains, 'locknlockonline.com'),
};

async function listNames(dir) {
  const rows = await uapi('Fileman', 'list_files', { dir });
  return rows.map((row) => row.file).filter(Boolean).sort();
}

async function readFile(dir, file) {
  const data = await uapi('Fileman', 'get_file_content', {
    dir, file, from_charset: 'utf-8', to_charset: 'utf-8', update_html_document_encoding: 0,
  });
  return String(data.content || '');
}

const production = {
  minhlongPlugins: await listNames(`${roots.minhlong}/wp-content/plugins`),
  minhlongMuPlugins: await listNames(`${roots.minhlong}/wp-content/mu-plugins`),
  lockPlugins: await listNames(`${roots.lock}/wp-content/plugins`),
  lockMuPlugins: await listNames(`${roots.lock}/wp-content/mu-plugins`),
};
const lockPaidNotifications = production.lockMuPlugins.includes('lock-sepay-paid-notifications.php')
  ? await readFile(`${roots.lock}/wp-content/mu-plugins`, 'lock-sepay-paid-notifications.php') : '';

const token = process.env.SEPAY_API_TOKEN.trim();
async function sepay(url) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  let body = {};
  try { body = await response.json(); } catch {}
  return { response, body };
}

const accounts = await sepay('https://my.sepay.vn/userapi/bankaccounts/list?limit=100');
if (!accounts.response.ok || Number(accounts.body.status) !== 200 || !Array.isArray(accounts.body.bankaccounts)) {
  throw new Error(`SePay bank-account read failed HTTP ${accounts.response.status}`);
}
const matches = accounts.body.bankaccounts.filter((row) => String(row.account_number || '').replace(/\s+/g, '') === '579268');
if (matches.length !== 1) throw new Error(`Expected one SePay account 579268, found ${matches.length}`);
const account = matches[0];
if (String(account.bank_short_name || '').toUpperCase() !== 'ACB' || String(account.active) !== '1') {
  throw new Error('SePay account 579268 is not an active ACB account');
}

const hooks = await sepay('https://my.sepay.vn/api/v1/webhooks?limit=100');
const webhookAccess = hooks.response.ok && hooks.body?.status === 'success' && Array.isArray(hooks.body.data);
const matchingHooks = webhookAccess ? hooks.body.data.filter((row) =>
  String(row.webhook_url || '').includes('minhlongonline.com') || String(row.name || '').toLowerCase().includes('minh long')) : [];

console.log(JSON.stringify({
  ok: true,
  production: {
    minhlongHasSepayPlugin: production.minhlongPlugins.includes('sepay-gateway'),
    lockHasSepayPlugin: production.lockPlugins.includes('sepay-gateway'),
    minhlongPluginNames: production.minhlongPlugins,
    minhlongMuPluginNames: production.minhlongMuPlugins,
    lockMuPluginNames: production.lockMuPlugins,
  },
  sepayAccount: {
    id: Number(account.id),
    bank: account.bank_short_name,
    accountNumber: String(account.account_number),
    accountHolderName: String(account.account_holder_name || ''),
    active: String(account.active) === '1',
  },
  webhookAccess,
  existingMinhlongWebhookCount: matchingHooks.length,
  lockPaidNotificationsSource: lockPaidNotifications,
}, null, 2));
