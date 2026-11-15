// CHẨN ĐOÁN CHỈ ĐỌC (lượt 2): cấu hình Woo Discount Rules trên trang, nội dung phản hồi bảng giảm giá, số vùng hiển thị; Jetpack còn chạy không; tham số cart-fragments; nguyên văn các đoạn script inline liên quan giỏ (đã che nonce).
const SITE = 'https://locknlockonline.com', P = '/san-pham/binh-giu-nhiet-locknlock-freeflow-lhc4466-lhc4467/';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const red = s => String(s).replace(/("(?:nonce|security|awdr_nonce|_wpnonce|[a-z_]*nonce)"\s*:\s*")[^"]*"/gi, '$1*"').replace(/((?:nonce|security)=)[^&"' ]+/gi, '$1*');
const html = await (await fetch(SITE + P, { headers: { 'User-Agent': UA } })).text();
const awdr = /var awdr_params = (\{[\s\S]*?\});/.exec(html);
console.log('awdr_params: ' + (awdr ? red(awdr[1]).slice(0, 900) : 'không thấy'));
console.log('Số .single_variation_wrap: ' + (html.match(/class="[^"]*single_variation_wrap/g) || []).length + '; số form.variations_form: ' + (html.match(/<form[^>]+variations_form/g) || []).length + '; số vùng .awdr-bulk-customizable-table: ' + (html.match(/awdr-bulk-customizable-table/g) || []).length + '; số .awdr_dynamic_bulk_table / awdr-bulk: ' + (html.match(/awdr[-_][a-z_-]*bulk[a-z_-]*/gi) || []).slice(0, 8).join(','));
const frag = /var wc_cart_fragments_params = (\{[^;]*\});/.exec(html); console.log('wc_cart_fragments_params: ' + (frag ? red(frag[1]).replace(/"cart_hash_key":"[^"]*"/, '"cart_hash_key":"*"').replace(/"fragment_name":"[^"]*"/, '"fragment_name":"*"') : 'không thấy'));
// Gửi đúng 1 lệnh bảng giảm giá như trình duyệt (nonce lấy từ trang, không in) để xem nội dung phản hồi
if (awdr) { try { const n = /"nonce":"([^"]+)"/.exec(awdr[1]); for (const pid of ['21592', '21599']) { const t0 = Date.now(); const r = await fetch(SITE + '/wp-admin/admin-ajax.php', { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }, body: `action=wdr_ajax&method=get_variable_product_bulk_table&product_id=${pid}&awdr_nonce=${n ? n[1] : ''}` }); const t = await r.text(); console.log(`Phản hồi bảng giảm giá product_id=${pid}: HTTP ${r.status}, ${Date.now() - t0}ms, ${t.length}B, nội dung: ${red(t).slice(0, 200)}`); } } catch (e) { console.log('lỗi ' + e.message); } }
// Jetpack / Query Monitor còn chạy? (REST index công khai + trang giỏ không cache)
const idx = await (await fetch(SITE + '/wp-json/', { headers: { 'User-Agent': UA } })).json().catch(() => ({}));
const ns = idx.namespaces || []; console.log(`REST namespaces (${ns.length}): jetpack=${ns.filter(x => /jetpack|wpcom|my-jetpack/i.test(x)).join(',') || 'không'}; query-monitor=${ns.filter(x => /query-monitor|qm/i.test(x)).join(',') || 'không'}; wdr=${ns.filter(x => /wdr|discount/i.test(x)).join(',') || 'không'}`);
console.log('Tất cả namespace: ' + ns.join(', '));
const cart = await (await fetch(SITE + '/gio-hang/?diag=' + Date.now(), { headers: { 'User-Agent': UA } })).text();
console.log('Trang giỏ (không cache) nạp file Jetpack: ' + (cart.match(/\/wp-content\/plugins\/jetpack\/[^"' ?]+/g) || []).slice(0, 6).join(', '));
// Nguyên văn các đoạn inline liên quan giỏ/biến thể không có id (khả năng là Code Snippets)
const inl = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)].filter(m => !/id=/.test(m[1]) && /ajaxComplete|Check_Variation|added_to_cart|single_add_to_cart|ux-buy-now|wc_fragment|update_checkout/i.test(m[2]));
for (const m of inl) console.log(`\n--- inline không id ${m[2].length}B ---\n${red(m[2].trim()).slice(0, 1800)}`);
const cartInl = [...cart.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)].filter(m => /ajaxComplete\.lnlCartSync|update_checkout|wc_fragment_refresh/i.test(m[2]) && m[2].length < 3000);
for (const m of cartInl) console.log(`\n--- (giỏ) inline ${(/id=["']([^"']+)/.exec(m[1]) || [, 'không id'])[1]} ${m[2].length}B ---\n${red(m[2].trim()).slice(0, 1500)}`);
