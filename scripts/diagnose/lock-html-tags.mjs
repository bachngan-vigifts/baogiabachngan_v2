// CHẨN ĐOÁN CHỈ ĐỌC: liệt kê mã đo lường (GTM/GA4/Ads/Meta/TikTok...) và nguồn chèn trên trang chủ, sản phẩm, giỏ, thanh toán; các đoạn script inline đụng tới giỏ/mua ngay.
const SITE = 'https://locknlockonline.com';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
for (const path of ['/', '/san-pham/binh-giu-nhiet-locknlock-freeflow-lhc4466-lhc4467/', '/gio-hang/', '/thanh-toan/']) {
  const html = await (await fetch(SITE + path, { headers: { 'User-Agent': UA } })).text();
  const ids = {}; for (const re of [/GTM-[A-Z0-9]{4,10}/g, /\bG-[A-Z0-9]{6,12}\b/g, /\bAW-\d{6,12}\b/g, /\bGT-[A-Z0-9]{6,12}\b/g]) for (const m of html.match(re) || []) ids[m] = (ids[m] || 0) + 1;
  const fb = [...html.matchAll(/fbq\(\s*['"]init['"]\s*,\s*['"](\d{6,20})['"]/g)].map(m => m[1]);
  const tt = [...html.matchAll(/ttq\.load\(['"]([A-Z0-9]+)['"]/g)].map(m => m[1]);
  const srcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(m => m[1]).filter(u => /gtm|gtag|analytics|pixel|fbevents|facebook|tiktok|clarity|hotjar|zalo|tracking|pys|pixelyoursite|site-kit|google-listings|conversion|ads/i.test(u)).map(u => u.replace(SITE, '').replace(/\?.*/, ''));
  const inl = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)];
  const track = inl.filter(m => /gtag\(|dataLayer|fbq\(|ttq\.|_learnq|clarity\(|form_start|form_submit|add_to_cart|begin_checkout/.test(m[2])).map(m => `${(/id=["']([^"']+)/.exec(m[1]) || [, '(không id)'])[1]}: ${m[2].replace(/\s+/g, ' ').replace(/[?&](?:nonce|_wpnonce|security)=[^&"' ]+/gi, '=*').replace(/"(?:nonce|security|_wpnonce|[a-z_]*nonce)"\s*:\s*"[^"]*"/gi, '"nonce":"*"').slice(0, 150)}`);
  const cartJs = inl.filter(m => /ux-buy-now|single_add_to_cart|add-to-cart|added_to_cart|wc_fragment|lnl_|buy.?now/i.test(m[2])).map(m => `${(/id=["']([^"']+)/.exec(m[1]) || [, '(không id)'])[1]} ${m[2].length}B: ${m[2].replace(/\s+/g, ' ').replace(/"(?:nonce|security|_wpnonce|[a-z_]*nonce)"\s*:\s*"[^"]*"/gi, '"nonce":"*"').slice(0, 120)}`);
  console.log(`\n== ${path} (${Math.round(html.length / 1024)}KB HTML)`);
  console.log('   ID đo lường (số lần xuất hiện): ' + (Object.entries(ids).map(([k, v]) => `${k}×${v}`).join(', ') || 'không') + (fb.length ? ` | Meta Pixel init: ${fb.join(', ')}` : '') + (tt.length ? ` | TikTok: ${tt.join(', ')}` : ''));
  console.log('   Script ngoài/plugin đo lường: ' + ([...new Set(srcs)].join(', ') || 'không'));
  for (const l of track.slice(0, 15)) console.log('   inline đo lường ' + l);
  for (const l of cartJs.slice(0, 15)) console.log('   inline giỏ/mua ' + l);
}
