// @ts-nocheck
/** Website giả cho tạo nhanh từ link / tra MST (test + kiểm thử trình duyệt): không gọi mạng thật. */
export const PNG_1PX=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
export function fakeWeb() {
  const calls: string[] = [];
  const fetcher = async (raw: string, init: any = {}) => {
    const u = new URL(raw); calls.push(u.hostname + u.pathname);
    if (u.hostname === 'cloudflare-dns.com') { const name = u.searchParams.get('name')!; return Response.json({ Answer: [{ type: 1, data: name.includes('private') ? '10.0.0.5' : '104.21.1.2' }] }); }
    if (u.hostname === 'api.vietqr.io') {
      const mst = decodeURIComponent(u.pathname.split('/').at(-1)!);
      if (mst === '0100109106') return new Response('Too many requests', { status: 429 });
      if (mst === '0302712571') return Response.json({ code: '52', desc: 'Không tìm thấy', data: null });
      if (mst === '0304475742') throw new TypeError('network down');
      const inactive = mst === '0101248141';
      return Response.json({ code: '00', desc: 'Success', data: { id: mst, name: inactive ? 'CÔNG TY TNHH NGỪNG' : 'CÔNG TY CỔ PHẦN MẪU', internationalName: 'SAMPLE JSC', shortName: 'SAMPLE', address: 'Số 1 Duy Tân, Cầu Giấy, Hà Nội', status: inactive ? 'NNT ngừng hoạt động và đã đóng MST' : 'NNT đang hoạt động' }, metadata: { updatedAt: '2026-10-07T00:09:06.000Z' } });
    }
    const html = (body: string, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers: { 'content-type': 'text/html', ...headers } });
    switch (u.hostname + u.pathname) {
      case 'ld.example.vn/sp/binh-1.html': return html(`<meta property="og:site_name" content="Shop LD"><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: 'BÌNH GIỮ NHIỆT 500ML SHOP KS-1', sku: 'KS-1', image: '/pic/1.png', brand: { '@type': 'Brand', name: 'Shop' }, offers: { '@type': 'Offer', price: '450000', priceCurrency: 'VND' } })}</script>`);
      case 'ld.example.vn/sp/usd.html': return html(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Mug', sku: 'MUG-1', offers: { price: 20, priceCurrency: 'USD' } })}</script>`);
      case 'ld.example.vn/sp/dup.html': return html(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Trùng mã', sku: 'DUP-1', offers: { price: 100000, priceCurrency: 'VND' } })}</script>`);
      case 'og.example.vn/binh.html': return html(`<meta property="og:title" content="Bình hoa sứ"><meta property="og:image" content="https://og.example.vn/a.jpg"><div>Mã: BH-09</div>`);
      case 'og.example.vn/empty.html': return html('<html><body>Không có gì</body></html>');
      case 'sapo.example.vn/am-tra-a': return html(`<script>Bizweb.template='product';</script><meta property="og:title" content="Ấm trà A">`);
      case 'sapo.example.vn/products/am-tra-a.js': return Response.json({ name: 'Ấm trà A', variants: [{ sku: 'AT-A', price: 300000, compare_at_price: 350000, available: true }], images: ['//cdn.example.vn/at.jpg'] });
      case 'hrv.example.vn/products/coc-b': return html(`<script src="https://hstatic.net/x.js"></script>`);
      case 'hrv.example.vn/products/coc-b.json': return Response.json({ product: { title: 'Cốc B', vendor: 'HRV', variants: [{ sku: 'CB-1', price: '120000', available: true }], images: [{ src: 'https://cdn.example.vn/b.jpg' }] } });
      case 'woo.example.vn/san-pham/dia-c': return html(`<link rel="https://api.w.org/" href="/wp-json/"><body class="woocommerce">`);
      case 'woo.example.vn/wp-json/wc/store/v1/products': return Response.json([{ slug: 'dia-c', name: 'Đĩa C', sku: 'DC-1', prices: { regular_price: '9900000', currency_minor_unit: 2, currency_code: 'VND' }, images: [{ src: 'https://woo.example.vn/c.png' }] }]);
      case 'bot.example.vn/x.html': return html('<title>Just a moment...</title>', 403);
      case 'redir.example.vn/x.html': return new Response('', { status: 302, headers: { location: 'https://private.example.vn/admin' } });
      case 'big.example.vn/x.html': return html('x'.repeat(2_600_000));
      case 'ld.example.vn/pic/1.png': return new Response(PNG_1PX, { headers: { 'content-type': 'image/png' } });
      case 'img.example.vn/ok.png': return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), { headers: { 'content-type': 'image/png' } });
      case 'img.example.vn/fake.png': return html('<html>not an image</html>');
    }
    return html('not found', 404);
  };
  return { fetcher, calls };
}

