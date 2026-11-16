// CHỈ ĐỌC: xem script cart-fragments nằm ở đâu trong HTML trang sản phẩm (đầu/cuối trang, có bị LiteSpeed gộp/hoãn không).
const SITE = 'https://locknlockonline.com', UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const j = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=simple&per_page=5&stock_status=instock`)).json();
for (const url of [j.find(x => x.permalink).permalink, SITE + '/']) {
  const r = await fetch(url + '?lnlfrag=' + Date.now(), { headers: { 'User-Agent': UA } }); const h = await r.text();
  const head = h.indexOf('</head>'), body = h.length;
  const find = s => { const i = h.indexOf(s); return i < 0 ? 'không có' : `vị trí ${i} (${i < head ? 'trong <head>' : 'trong <body>'})`; };
  console.log(`\n== ${url.replace(SITE, '')} (${Math.round(body / 1024)}KB, </head> ở ${head})`);
  for (const s of ['wc-cart-fragments-js-extra', 'wc-cart-fragments-js-before', 'cart-fragments.min.js', 'cart-fragments.js', 'wc_cart_fragments_params', 'lnl-live-search-lite', '/litespeed/js/', 'data-no-optimize', 'litespeed_js_delay', 'type="litespeed/javascript"', 'data-src=']) console.log(`  ${s}: ${find(s)}`);
  const m = h.match(/<script[^>]*wc-cart-fragments[^>]*>/g) || []; for (const t of m.slice(0, 4)) console.log('  thẻ: ' + t.slice(0, 200));
  const ls = (h.match(/<script[^>]+src="[^"]*\/litespeed\/js\/[^"]+"[^>]*>/g) || []).slice(0, 3); for (const t of ls) console.log('  LS: ' + t.slice(0, 200));
  console.log('  số thẻ type=litespeed/javascript: ' + (h.match(/type="litespeed\/javascript"/g) || []).length);
}
