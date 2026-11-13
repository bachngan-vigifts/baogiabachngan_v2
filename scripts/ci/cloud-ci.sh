#!/usr/bin/env bash
# CHẠY ĐỦ BỘ KIỂM TRA NGOÀI GITHUB ACTIONS (cloud Claude hoặc máy bất kỳ).
# Cùng nội dung với .github/workflows/ci.yml: npm ci → typecheck → toàn bộ test chia 4 phần (chạy song song trên một máy).
# Chỉ đọc mã trong thư mục hiện tại; test dùng PostgreSQL giả lập (PGlite) nên không cần và không chạm production.
#
#   bash scripts/ci/cloud-ci.sh            # chạy đủ
#   CLOUD_CI_SHARDS=2 bash scripts/ci/cloud-ci.sh   # máy ít nhân
#
# Kết quả: thư mục .cloud-ci/ (không commit) gồm log từng bước và summary.md; mã thoát 0 = đạt, 1 = có lỗi.
set -u
cd "$(git rev-parse --show-toplevel)"
OUT=${CLOUD_CI_OUT:-.cloud-ci}
SHARDS=${CLOUD_CI_SHARDS:-4}
SHARD_TIMEOUT=${CLOUD_CI_SHARD_TIMEOUT:-5400}   # 90 phút mỗi phần (máy 4 nhân chạy đủ bộ khoảng 60 phút), quá giờ coi là lỗi
rm -rf "$OUT"; mkdir -p "$OUT"
SHA=$(git rev-parse HEAD); BRANCH=$(git rev-parse --abbrev-ref HEAD); STARTED=$(date +%s)
step() { printf '[cloud-ci %s] %s\n' "$(date +%H:%M:%S)" "$*"; }

step "commit $SHA ($BRANCH) · node $(node --version) · $(nproc) nhân"
step "npm ci"
if ! npm ci >"$OUT/npm-ci.log" 2>&1; then INSTALL=fail; else INSTALL=ok; fi

TYPECHECK=skip
if [ "$INSTALL" = ok ]; then
  step "typecheck"
  if npm run typecheck >"$OUT/typecheck.log" 2>&1; then TYPECHECK=ok; else TYPECHECK=fail; fi
fi

if [ "$INSTALL" = ok ]; then
  step "test: $SHARDS phần song song"
  pids=()
  for i in $(seq 1 "$SHARDS"); do
    ( timeout "$SHARD_TIMEOUT" node --import tsx --test --test-reporter=tap --test-concurrency=2 --test-shard="$i/$SHARDS" \
        "tests/**/*.test.ts" "src/**/*.test.ts" >"$OUT/shard-$i.log" 2>&1; echo $? >"$OUT/shard-$i.exit" ) &
    pids+=($!)
  done
  for pid in "${pids[@]}"; do wait "$pid"; done
fi

# ---- tổng hợp ----
total=0; pass=0; fail=0; skipped=0; bad=0
count() { grep -E "^# $1 " "$2" 2>/dev/null | tail -1 | awk '{print $3}'; }
{
  echo "<!-- cloud-ci -->"
  echo "## Kiểm tra trên cloud Claude"
  echo
  echo "Commit \`${SHA:0:8}\` · nhánh \`$BRANCH\` · $(TZ=Asia/Ho_Chi_Minh date '+%d/%m/%Y %H:%M') (giờ VN)"
  echo
  echo "| Bước | Kết quả | Chi tiết |"
  echo "|---|---|---|"
  echo "| npm ci | $([ "$INSTALL" = ok ] && echo '✅' || echo '❌') | |"
  echo "| typecheck | $([ "$TYPECHECK" = ok ] && echo '✅' || { [ "$TYPECHECK" = skip ] && echo '⏭️' || echo '❌'; }) | |"
  if [ "$INSTALL" = ok ]; then
    for i in $(seq 1 "$SHARDS"); do
      log="$OUT/shard-$i.log"; code=$(cat "$OUT/shard-$i.exit" 2>/dev/null || echo 1)
      t=$(count tests "$log"); p=$(count pass "$log"); f=$(count fail "$log"); s=$(count skipped "$log")
      total=$((total + ${t:-0})); pass=$((pass + ${p:-0})); fail=$((fail + ${f:-0})); skipped=$((skipped + ${s:-0}))
      if [ "$code" = 0 ] && [ "${f:-1}" = 0 ]; then mark='✅'; else mark='❌'; bad=1; fi
      note="${t:-?} test · ${p:-?} đạt · ${f:-?} lỗi · ${s:-0} bỏ qua"
      [ "$code" = 124 ] && note="quá $((SHARD_TIMEOUT / 60)) phút, bị dừng"
      echo "| test phần $i/$SHARDS | $mark | $note |"
    done
  fi
  echo
  if [ "$TYPECHECK" = fail ]; then
    echo "### Lỗi typecheck"; echo; echo '```'; grep -E "error TS" "$OUT/typecheck.log" | head -30; echo '```'; echo
  fi
  if [ "$INSTALL" != ok ]; then
    echo "### Lỗi cài thư viện"; echo; echo '```'; tail -20 "$OUT/npm-ci.log"; echo '```'; echo
  fi
  if [ "$bad" = 1 ]; then
    echo "### Test lỗi"; echo
    # Tên test lỗi (bỏ dòng tổng của file để khỏi lặp), tối đa 40 dòng.
    grep -hE "^\s*not ok [0-9]+ - " "$OUT"/shard-*.log | sed -E 's/^\s*not ok [0-9]+ - /- /' | grep -vE "^- (tests|src)/.*\.test\.ts$" | sort -u | head -40
    echo
    echo "Log đầy đủ: thư mục \`$OUT/\` trong phiên chạy."
  fi
  echo
  echo "Tổng: **$total test · $pass đạt · $fail lỗi · $skipped bỏ qua** · $(( ($(date +%s) - STARTED) / 60 )) phút."
} >"$OUT/summary.md"

if [ "$INSTALL" = ok ] && [ "$TYPECHECK" = ok ] && [ "$bad" = 0 ] && [ "$total" -gt 0 ]; then
  sed -i '3i **Kết quả: ✅ ĐẠT**\n' "$OUT/summary.md"; step "ĐẠT · $total test"; cat "$OUT/summary.md"; exit 0
fi
sed -i '3i **Kết quả: ❌ CÓ LỖI**\n' "$OUT/summary.md"; step "CÓ LỖI"; cat "$OUT/summary.md"; exit 1
