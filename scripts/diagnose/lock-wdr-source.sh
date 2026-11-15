#!/usr/bin/env bash
# CHẨN ĐOÁN CHỈ ĐỌC: lấy mã nguồn Woo Discount Rules đúng phiên bản đang chạy (từ wordpress.org) để tìm nơi gọi và xử lý wdr_ajax:get_variable_product_bulk_table. Không đụng máy chủ ngoài 2 file công khai.
set -u
SITE=https://locknlockonline.com
UA='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'
ver=$(curl -s -A "$UA" "$SITE/wp-content/plugins/woo-discount-rules/readme.txt" | grep -i -m1 '^Stable tag' | awk '{print $3}' | tr -d '\r')
echo "Phiên bản Woo Discount Rules trên web (readme): ${ver:-?}"
html=$(curl -s -A "$UA" "$SITE/san-pham/binh-giu-nhiet-locknlock-freeflow-lhc4466-lhc4467/")
echo "$html" | grep -o 'woo-discount-rules[^"'"'"' ]*\.js[^"'"'"' ]*' | sort -u | sed 's/^/Script WDR trên trang: /'
mkdir -p /tmp/wdr && cd /tmp/wdr
curl -s -L -o wdr.zip "https://downloads.wordpress.org/plugin/woo-discount-rules.${ver}.zip" && unzip -q -o wdr.zip || { echo "Không tải được bản ${ver}"; exit 0; }
P=/tmp/wdr/woo-discount-rules
echo; echo "== Nơi đăng ký wdr_ajax (PHP)"; grep -rn "wp_ajax_nopriv_wdr_ajax\|wp_ajax_wdr_ajax\|'wdr_ajax'" "$P" --include=*.php | sed "s#$P/##" | head
echo; echo "== Hàm xử lý get_variable_product_bulk_table (PHP)"; grep -rn "get_variable_product_bulk_table" "$P" --include=*.php | sed "s#$P/##" | head
f=$(grep -rln "function getVariableProductBulkTable\|function get_variable_product_bulk_table\|function wdr_ajax_get_variable_product_bulk_table" "$P" --include=*.php | head -1)
if [ -n "$f" ]; then n=$(grep -n "function getVariableProductBulkTable\|function get_variable_product_bulk_table\|function wdr_ajax_get_variable_product_bulk_table" "$f" | head -1 | cut -d: -f1); echo "--- ${f#$P/}:$n"; sed -n "$((n-2)),$((n+45))p" "$f"; fi
r=$(grep -rln "function wdr_ajax\b\|function wdrAjax\|function wdr_ajax(" "$P" --include=*.php | head -1); if [ -n "$r" ]; then n=$(grep -n "function wdr_ajax\|function wdrAjax" "$r" | head -1 | cut -d: -f1); echo "--- bộ định tuyến ${r#$P/}:$n"; sed -n "$n,$((n+40))p" "$r"; fi
echo; echo "== Nơi gọi (JS)"; for js in $(grep -rln "get_variable_product_bulk_table" "$P" --include=*.js | grep -v '\.min\.js$'); do echo "--- ${js#$P/}"; grep -n "get_variable_product_bulk_table\|found_variation\|show_variation\|woocommerce_variation_has_changed\|reset_data\|\.on(\|ajax(" "$js" | head -30; n=$(grep -n "get_variable_product_bulk_table" "$js" | head -1 | cut -d: -f1); sed -n "$((n-30)),$((n+25))p" "$js"; done
echo; echo "== So khớp JS đang chạy trên web với bản gốc"; for u in $(echo "$html" | grep -o "$SITE/wp-content/plugins/woo-discount-rules/[^\"' ]*\.js" | sed 's/?.*//' | sort -u); do rel=${u#$SITE/wp-content/plugins/}; a=$(curl -s -A "$UA" "$u" | sha256sum | cut -c1-12); b=$(sha256sum "/tmp/wdr/$rel" 2>/dev/null | cut -c1-12); echo "$rel: web=$a gốc=${b:-không có} $([ "$a" = "$b" ] && echo KHỚP || echo KHÁC)"; done
