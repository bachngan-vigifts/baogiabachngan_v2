import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]||'chatbox');
const file=resolve(root,'src/shared/defaults.ts');
let text=readFileSync(file,'utf8');
if(!text.includes('return createDefaultSettings()'))throw Error('Unexpected upstream defaults');
text=text.replace('return createDefaultSettings()',`return {
    ...createDefaultSettings(),
    providers: { [ModelProviderEnum.Gemini]: {apiHost: window.location.origin + '/api', apiKey: 'server-managed', models: [{modelId: 'gemini-flash-lite-latest', capabilities: []}]} },
    allowReportingAndTracking: false,
    autoGenerateTitle: false,
    autoCompaction: false,
    defaultPrompt: 'Bạn là trợ lý thử nghiệm của LocknLockOnline. Trả lời tiếng Việt. Chưa có dữ liệu giá, tồn kho hay đơn hàng trực tiếp.',
  }`);
text=text.replace("provider: ModelProviderEnum.ChatboxAI,\n    modelId: 'chatboxai-4',", "provider: ModelProviderEnum.Gemini,\n    modelId: 'gemini-flash-lite-latest',");
text=text.replace('maxContextMessageCount: Number.MAX_SAFE_INTEGER','maxContextMessageCount: 10');
writeFileSync(file,text);
const config=resolve(root,'vite.config.web.ts');writeFileSync(config,readFileSync(config,'utf8').replace("postcss: './postcss.config.cjs'","postcss: './postcss.config.js'"));
const html=resolve(root,'src/renderer/index.html');
let h=readFileSync(html,'utf8');
h=h.replace(/<script\b[^>]*\bsrc="https:\/\/(?:www\.googletagmanager\.com|plausible\.midway\.run)[^\"]*"[^>]*>\s*<\/script>/g,'');
h=h.replace('<link rel="apple-touch-icon" href="/logo192.png" />','');
writeFileSync(html,h);
console.log('Chatbox configured for same-origin Gemini bridge; no API key in frontend.');
