// Báo vi phạm Content-Security-Policy (CSP đang ở chế độ CHỈ BÁO CÁO – trial-ui/_headers): trang không bị chặn gì,
// chỉ gửi về máy chủ (POST /csp-report → log Edge Function) để biết asset / API nào sẽ bị chặn trước khi bật thật.
// Gửi qua API có phiên đăng nhập (`send`); chưa đăng nhập thì giữ lại, gửi ở lần sau. Mỗi trang gửi tối đa 20 báo cáo khác nhau.
export function watchCsp(send) {
  const seen = new Set(), pending = [];
  const flush = () => { while (pending.length) { const r = pending[0]; if (!send(r)) return; pending.shift(); } };
  document.addEventListener('securitypolicyviolation', e => {
    const r = { directive: e.effectiveDirective || e.violatedDirective, blocked: String(e.blockedURI || '').slice(0, 300), page: location.pathname,
      source: String(e.sourceFile || '').slice(0, 300), line: e.lineNumber || 0 };
    const key = r.directive + '|' + r.blocked + '|' + r.source;
    if (seen.has(key) || seen.size >= 20) return;
    seen.add(key); pending.push(r); flush();
  });
  setInterval(flush, 60_000);
}
