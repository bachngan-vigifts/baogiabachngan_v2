const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (n) => n === null || !Number.isFinite(n) ? "C\u1EA7n \u0111\u1ED1i chi\u1EBFu" : new Intl.NumberFormat("vi-VN").format(n) + " \u20AB";
const differenceText = (expected, amount) => !expected || expected===amount ? "" : `Chênh ${amount>expected?'dư':'thiếu'} ${money(Math.abs(amount-expected))}`;
const fee = l => Number(l.ghnFee || 0);
const settled = l => Number(l.amount || 0) + fee(l);
const ghnReceipt = l => !!l.existingPaymentId && l.existingPayments?.find((p) => p.id === l.existingPaymentId)?.source === "ghn_cod";
const balanceAfter = l => l.outstanding===null ? null : l.outstanding+(l.existingPaymentId?l.cap:0)-settled(l);
const balanceLabel = n => n===null ? money(null) : n<0 ? `Khách trả dư ${money(-n)}` : `Còn nợ ${money(n)}`;
function allocationTotals(summary, lines) {
  const amount = lines.reduce((n, l) => n + Number(l.amount || 0), 0);
  return { amount, remaining: summary.remaining - amount, valid: lines.length > 0 && lines.length <= 100 && amount <= summary.remaining && lines.every((l) => Number.isSafeInteger(l.amount) && l.amount > 0 && l.amount<=1e12 && Number.isSafeInteger(fee(l)) && fee(l) >= 0 && (!fee(l) || l.ghnCode && fee(l) < settled(l) && settled(l) <= (l.expectedAmount || l.cap)) && (!l.expectedAmount || l.expectedAmount<=l.cap) && (settled(l) <= l.cap || l.expectedAmount>0 && l.expectedAmount<=l.cap) && (!l.existingPaymentId || settled(l) === l.cap || !ghnReceipt(l) && !fee(l) && l.expectedAmount === l.cap && summary.canReplaceReceipt) && (!l.paymentReviewRequired || l.paymentReviewed)) };
}
function initSepayAllocations({ api, root, go, canOpenOrders = () => true }) {
  if (!document.getElementById("sepay-allocation-style")) {
    const l = document.createElement("link");
    l.id = "sepay-allocation-style";
    l.rel = "stylesheet";
    l.href = new URL("./sepay-allocations.css", import.meta.url).href;
    document.head.append(l);
  }
  let alive = true, sequence = 0, id = "", path = "", storageKey = "", summary = null, event = null, lines = [], candidates = [], filters = { q: "", source: "all", from: "", to: "", offset: 0 }, hasMore = false, pending = null, voidPending = null, busy = false, review = false, stale = false, notice = "", storageWarning = "";
  const $ = (s) => root.querySelector(s), save = () => {
    try {
      if (storageKey) sessionStorage.setItem(storageKey, JSON.stringify({ lines, pending, voidPending }));
    } catch {
      storageWarning = "Kh\xF4ng l\u01B0u \u0111\u01B0\u1EE3c nh\xE1p tr\xEAn m\xE1y n\xE0y. Gi\u1EEF trang m\u1EDF khi ch\u01B0a x\xE1c nh\u1EADn xong.";
    }
  };
  function close() {
    alive = false;
    sequence++;
    window.removeEventListener("beforeunload", beforeUnload);
    root.removeEventListener("click", click);
    root.removeEventListener("submit", submit);
    root.removeEventListener("input", input);
    root.removeEventListener("change", change);
  }
  function beforeUnload(e) {
    if (lines.length || pending || voidPending) {
      e.preventDefault();
      e.returnValue = "";
    }
  }
  function error(e) {
    notice = e.message || "Kh\xF4ng t\u1EA3i \u0111\u01B0\u1EE3c d\u1EEF li\u1EC7u.";
    if ([401, 403, 404].includes(e.status)) {
      summary = null;
      event = null;
      candidates = [];
      lines = [];
      pending = null;
      voidPending = null;
      stale = true;
    }
  }
  function totals() {
    return summary ? allocationTotals(summary, lines) : { amount: 0, remaining: 0, valid: false };
  }
  function footer() {
    const t = totals();
    return `<div class="sa-totals"><span>Giao d\u1ECBch <b>${money(summary.amount)}</b></span><span>\u0110\xE3 ph\xE2n b\u1ED5 <b>${money(summary.allocated)}</b></span><span>\u0110ang ch\u1ECDn <b data-total-selected>${money(t.amount)}</b></span><span>Còn chưa phân bổ (+ dư / − thiếu) <b data-total-remaining>${money(t.remaining)}</b></span></div><button class="btn navy" data-review ${!t.valid || stale || summary.needsReview || pending || voidPending || busy ? "disabled" : ""}>Ki\u1EC3m tra ph\xE2n b\u1ED5</button>`;
  }
  function row(l) {
    return `<article class="sa-line" data-line="${esc(l.targetId)}"><div><b>${esc(l.orderNo)}</b><small>${esc(l.customerName)}</small><small>T\u1ED5ng ${money(l.total)} \xB7 \u0110\xE3 thu ${money(l.paid)} \xB7 C\xF2n n\u1EE3 ${money(l.outstanding)}</small></div><div class="sa-entry"><label>Nh\u1EADn l\u1EA7n n\xE0y (\u20AB)<input data-amount data-money="1" type="number" inputmode="numeric" min="1" max="1000000000000" step="1" value="${l.amount || ""}" ${pending || busy ? "disabled" : ""} ></label><label>% c\xF2n n\u1EE3<input data-percent data-money="0" type="number" min="0" max="100" step="1" placeholder="30" ${pending || l.existingPaymentId || busy ? "disabled" : ""}></label><button class="btn secondary" data-full ${pending || busy ? "disabled" : ""}>\u0110\u1EE7 100%</button><button class="btn secondary" data-bank-remaining ${pending || busy ? "disabled" : ""}>Dùng tiền còn lại</button><button class="btn ghost" data-remove ${pending || busy ? "disabled" : ""}>B\u1ECF</button></div>${l.existingPayments?.length ? `<label>Ch\u1EE9ng t\u1EEB thu<select data-receipt ${pending || busy ? "disabled" : ""}><option value="">T\u1EA1o phi\u1EBFu m\u1EDBi theo c\xF4ng n\u1EE3</option>${l.existingPayments.map((p) => `<option value="${esc(p.id)}" ${p.id === l.existingPaymentId ? "selected" : ""}>${p.source === "ghn_cod" ? "GHN đã thu COD " : "G\u1EAFn phi\u1EBFu "}${esc(p.reference || p.id)} \xB7 ${money(p.amount)}</option>`).join("")}</select></label>` : ""}${l.paymentReviewRequired ? `<label class="sp-check"><input type="checkbox" data-payment-reviewed ${l.paymentReviewed ? "checked" : ""} ${pending || busy ? "disabled" : ""}>\u0110\xE3 \u0111\u1ED1i chi\u1EBFu thanh to\xE1n website, x\xE1c nh\u1EADn s\u1ED1 ti\u1EC1n th\u1EF1c c\xF2n n\u1EE3.</label>` : ""}${l.ghnCode ? `<label>Phí GHN đã trừ (₫)<input data-ghn-fee type="number" inputmode="numeric" min="0" max="1000000000000" step="1" value="${fee(l) || ""}" ${pending || busy ? "disabled" : ""}></label><small>Vận đơn GHN ${esc(l.ghnCode)}${l.ghnFeeHint ? ` · Phí theo vận đơn ${money(l.ghnFeeHint)}` : ""} · Tiền NH nhận + phí GHN = số được tính là khách đã trả.</small>` : ""}<small data-line-difference>${differenceText(l.expectedAmount,settled(l))}${l.existingPaymentId && settled(l)!==l.cap ? ` · Huỷ phiếu cũ và tạo phiếu đúng số thực nhận; giữ lịch sử.${!summary.canReplaceReceipt?" Cần quyền Huỷ phiếu thu hoặc Sửa phiếu thu lệch khi đối soát SePay.":""}` : ""}</small><small>Công nợ sau lần này: <b data-after>${balanceLabel(balanceAfter(l))}</b>${l.existingPaymentId && settled(l)===l.cap ? " · Chỉ gắn phiếu đã có, không thu thêm." : ""}</small></article>`;
  }
  function render() {
    if (!alive) return;
    root.classList.add("sp-page");
    root.setAttribute("data-no-busy", "");
    root.dataset.mobileActions = "off";
    root.innerHTML = `<section class="sa-page"><div class="page-head"><div><p class="eyebrow">THANH TO\xC1N SEPAY</p><h1>\u0110\u1ED1i so\xE1t chi ti\u1EBFt</h1></div><div class="sp-head-actions"><button class="btn secondary" data-back>\u2190 Giao d\u1ECBch</button><button class="btn secondary" data-reload ${busy ? "disabled" : ""}>T\u1EA3i l\u1EA1i c\xF4ng n\u1EE3</button></div></div><p class="sp-error" data-notice role="alert">${esc(notice || storageWarning)}</p>${summary ? `<section class="card"><strong class="sp-bank-amount">${money(summary.amount)}</strong><p>${esc(event?.content)}</p><small>M\xE3 SePay ${esc(event?.providerId)} \xB7 TK ${esc(event?.accountNumber)}</small>${summary.needsReview ? '<p class="sp-warning">T\u1ED5ng \u0111\u01A1n web \u0111\xE3 thay \u0111\u1ED5i sau ph\xE2n b\u1ED5: c\u1EA7n \u0111\u1ED1i so\xE1t l\u1EA1i. Ch\u01B0a th\u1EC3 ghi th\xEAm.</p>' : ""}<p class="muted">Chỉ phân bổ tiền thực nhận. Chọn “Dùng tiền còn lại” tại dòng nhận phần dư/thiếu. Công nợ giữ đúng số thiếu hoặc khách trả dư; không làm tròn hoặc xoá chênh lệch. Ph\xED GHN b\u1ECB tr\u1EEB v\u1EABn \u0111\u1EC3 \u0111\u01A1n c\xF2n n\u1EE3.</p></section>${pending ? '<div class="sp-warning">Ch\u01B0a x\xE1c nh\u1EADn \u0111\u01B0\u1EE3c k\u1EBFt qu\u1EA3. Gi\u1EEF nguy\xEAn l\xF4 v\xE0 m\xE3 thao t\xE1c; b\u1EA5m ki\u1EC3m tra l\u1EA1i k\u1EBFt qu\u1EA3 \u0111\u1EC3 tr\xE1nh ghi tr\xF9ng. <button class="btn navy" data-retry>Ki\u1EC3m tra l\u1EA1i k\u1EBFt qu\u1EA3</button></div>' : ""}${voidPending ? '<div class="sp-warning">Ch\u01B0a r\xF5 k\u1EBFt qu\u1EA3 g\u1EE1 ph\xE2n b\u1ED5. <button class="btn secondary" data-retry-void>Ki\u1EC3m tra l\u1EA1i l\u1EC7nh g\u1EE1</button></div>' : ""}${stale ? '<p class="sp-warning">D\u1EEF li\u1EC7u v\u1EEBa thay \u0111\u1ED5i. Nh\xE1p \u0111\u01B0\u1EE3c gi\u1EEF l\u1EA1i. T\u1EA3i l\u1EA1i c\xF4ng n\u1EE3 v\xE0 ki\u1EC3m tra t\u1EEBng d\xF2ng tr\u01B0\u1EDBc khi g\u1EEDi l\u1EA1i.</p>' : ""}<form class="card sa-search" data-search><label>T\xECm \u0111\u01A1n / H\u0110KT / h\xF3a \u0111\u01A1n / kh\xE1ch<input name="q" maxlength="120" value="${esc(filters.q)}"></label><label>Lo\u1EA1i \u0111\u01A1n<select name="source">${[["all", "T\u1EA5t c\u1EA3"], ["crm", "\u0110\u01A1n CRM"], ["contract", "H\u0110KT"], ["pos", "POS"], ["web", "Website"], ["ghn", "Có vận đơn GHN"]].map(([v, t]) => `<option value="${v}" ${filters.source === v ? "selected" : ""}>${t}</option>`).join("")}</select></label><label>T\u1EEB ng\xE0y<input type="date" name="from" value="${esc(filters.from)}"></label><label>\u0110\u1EBFn ng\xE0y<input type="date" name="to" value="${esc(filters.to)}"></label><button class="btn navy" ${busy ? "disabled" : ""}>T\xECm ch\u1EE9ng t\u1EEB</button></form><section class="card"><h2>Ch\u1EE9ng t\u1EEB c\xF2n n\u1EE3 / phi\u1EBFu thu c\xF3 th\u1EC3 g\u1EAFn</h2><div class="sa-candidates">${candidates.map((c) => `<article><div><b>${esc(c.contractNo || c.orderNo)}</b><small>${esc(c.customerName)}</small><small>T\u1ED5ng ${money(c.total)} \xB7 \u0110\xE3 thu ${money(c.paid)} \xB7 C\xF2n n\u1EE3 ${money(c.outstanding)}</small>${c.blockedReason ? `<small>${esc(c.blockedReason)}</small>` : ""}</div><button class="btn secondary" data-add="${esc(c.targetId)}" ${busy || pending || voidPending || c.blockedReason || lines.some((l) => l.targetId === c.targetId) ? "disabled" : ""}>Th\xEAm</button></article>`).join("") || "<p>Kh\xF4ng c\xF3 ch\u1EE9ng t\u1EEB ph\xF9 h\u1EE3p trong trang n\xE0y.</p>"}</div><div class="sp-pager"><button class="btn secondary" data-page="${Math.max(0, filters.offset - 50)}" ${!filters.offset || busy ? "disabled" : ""}>\u2190 Tr\u01B0\u1EDBc</button><span>Trang ${filters.offset / 50 + 1}</span><button class="btn secondary" data-page="${filters.offset + 50}" ${!hasMore || busy ? "disabled" : ""}>Sau \u2192</button></div></section><section class="card"><h2>\u0110ang ph\xE2n b\u1ED5 (${lines.length})</h2><div data-lines>${lines.map(row).join("") || "<p>Ch\u1ECDn c\xE1c \u0111\u01A1n \u0111\u1EC3 nh\u1EADp s\u1ED1 ti\u1EC1n nh\u1EADn t\u1EEBng \u0111\u01A1n.</p>"}</div></section><div data-check>${review ? `<section class="card sa-review"><h2>Ki\u1EC3m tra tr\u01B0\u1EDBc khi ghi thu</h2>${lines.map((l) => `<p>${esc(l.orderNo)}: <b>${money(l.amount)}</b>${fee(l) ? ` + phí GHN cấn trừ ${money(fee(l))}` : ""}${l.expectedAmount!==settled(l) && l.expectedAmount ? ` · ${differenceText(l.expectedAmount,settled(l))} so với ${money(l.expectedAmount)}` : ""}${l.existingPaymentId ? settled(l)===l.cap?" · Gắn phiếu đã có":" · Huỷ phiếu cũ và tạo phiếu đúng số thực nhận, giữ lịch sử" : ""}</p>`).join("")}<p>T\u1ED5ng ghi nh\u1EADn ${money(totals().amount)} \xB7 Còn chưa phân bổ (+ dư / − thiếu) ${money(totals().remaining)}</p><label class="sp-check"><input type="checkbox" data-verified>Tôi đã đối chiếu đúng đơn, tài khoản nhận, số tiền và chấp nhận phần chênh lệch hiển thị (nếu có).</label><button class="btn navy" data-confirm disabled>X\xE1c nh\u1EADn ph\xE2n b\u1ED5</button><button class="btn secondary" data-cancel>Quay l\u1EA1i s\u1EEDa</button></section>` : ""}</div><section class="card"><h2>L\u1ECBch s\u1EED ph\xE2n b\u1ED5</h2>${summary.allocations.map((a) => `<article class="sa-history"><b>${esc(a.targetNo || a.targetKey)}</b> \xB7 ${money(a.amount)}${a.ghnFee ? ` + phí GHN ${money(a.ghnFee)}` : ""}${a.difference ? `<small>${differenceText(a.expectedAmount,a.amount)} · Số đối chiếu ${money(a.expectedAmount)}</small>` : ""}<small>L\xF4 ${esc(a.batchId)} \xB7 ${esc(a.createdAt)}</small>${a.voidedAt ? `<small>\u0110\xE3 g\u1EE1: ${esc(a.voidReason)}</small>` : `${canOpenOrders() ? `<a href="#/orders/${encodeURIComponent(a.webOrderId ? "web:" + a.webOrderId : a.orderId)}">M\u1EDF \u0111\u01A1n</a>` : ""}${summary.canVoid ? `<button class="btn ghost" data-void="${esc(a.id)}" ${busy || pending || voidPending ? "disabled" : ""}>G\u1EE1 ph\xE2n b\u1ED5</button>` : ""}`}</article>`).join("") || "<p>Ch\u01B0a c\xF3 ph\xE2n b\u1ED5.</p>"}<div data-void-form></div></section><footer class="card sa-footer" data-footer>${footer()}</footer>` : "<p>Ch\u01B0a t\u1EA3i \u0111\u01B0\u1EE3c \u0111\u1ED1i so\xE1t. B\u1EA5m t\u1EA3i l\u1EA1i \u0111\u1EC3 th\u1EED l\u1EA1i.</p>"}</section>`;
  }
  async function load() {
    if (busy) return;
    busy = true;
    const own = ++sequence;
    notice = "";
    try {
      const [s, e] = await Promise.all([api(path), api("/sepay/transactions/" + encodeURIComponent(id))]);
      if (!alive || own !== sequence) return;
      summary = s;
      event = e.transaction;
      stale = false;
      await find(false);
    } catch (e) {
      if (alive && own === sequence) error(e);
    } finally {
      if (alive && own === sequence) {
        busy = false;
        review = false;
        render();
      }
    }
  }
  async function find(paint = true) {
    const own = ++searchSeq;
    try {
      const r = await api("/sepay/transactions/" + encodeURIComponent(id) + "/allocation-candidates?" + new URLSearchParams({ ...filters, offset: String(filters.offset) }));
      if (!alive || own !== searchSeq) return;
      candidates = r.candidates;
      hasMore = r.hasMore;
      for (const l of lines) {
        const c = candidates.find((c2) => c2.targetId === l.targetId);
        if (c) {
          const previousCap=l.cap;
          Object.assign(l, { outstanding: c.outstanding, paid: c.paid, total: c.total, paymentReviewRequired: c.paymentReviewRequired, existingPayments: c.existingPayments, ghnCode: c.ghnCode || "", ghnFeeHint: c.ghnFeeHint || 0 });
          l.cap = l.existingPaymentId ? c.existingPayments?.find((p) => p.id === l.existingPaymentId)?.amount ?? 0 : c.outstanding ?? c.total;
          if(!pending && l.expectedAmount===previousCap)l.expectedAmount=l.cap;
        }
      }
      save();
    } catch (e) {
      if (alive && own === searchSeq) error(e);
    }
    if (alive && paint) render();
  }
  let searchSeq = 0;
  function update() {
    review = false;
    save();
    const t = totals();
    $("[data-total-selected]").textContent = money(t.amount);
    $("[data-total-remaining]").textContent = money(t.remaining);
    $("[data-review]").disabled = !t.valid || stale || summary.needsReview || !!pending || !!voidPending;
    for (const l of lines) {
      const el = [...root.querySelectorAll("[data-line]")].find((el2) => el2.dataset.line === l.targetId);
      if(el) el.querySelector("[data-line-difference]").textContent = differenceText(l.expectedAmount,settled(l))+(l.existingPaymentId&&settled(l)!==l.cap?" · Huỷ phiếu cũ và tạo phiếu đúng số thực nhận; giữ lịch sử.":"");
      if (el) el.querySelector("[data-after]").textContent = balanceLabel(balanceAfter(l));
    }
    $("[data-check]").replaceChildren();
  }
  async function send() {
    if (busy || !pending) return;
    busy = true;
    review = false;
    save();
    render();
    try {
      await api(path, "POST", pending);
      if (!alive) return;
      pending = null;
      lines = [];
      notice = "\u0110\xE3 ghi nh\u1EADn ph\xE2n b\u1ED5.";
      save();
      busy = false;
      await load();
    } catch (e) {
      if (!alive) return;
      if (e.status && e.status < 500) {
        pending = null;
        stale = true;
      }
      error(e);
      notice = "Ch\u01B0a x\xE1c nh\u1EADn \u0111\u01B0\u1EE3c k\u1EBFt qu\u1EA3: " + (e.message || "M\u1EA5t k\u1EBFt n\u1ED1i") + (pending ? " \xB7 D\xF9ng n\xFAt ki\u1EC3m tra l\u1EA1i k\u1EBFt qu\u1EA3." : " \xB7 T\u1EA3i l\u1EA1i c\xF4ng n\u1EE3 tr\u01B0\u1EDBc khi g\u1EEDi l\u1EA1i.");
      save();
      busy = false;
      render();
    }
  }
  async function sendVoid() {
    if (busy || !voidPending) return;
    busy = true;
    render();
    try {
      await api(path + "/" + encodeURIComponent(voidPending.id) + "/void", "POST", voidPending.body);
      if (!alive) return;
      voidPending = null;
      save();
      busy = false;
      await load();
    } catch (e) {
      if (!alive) return;
      if (e.status && e.status < 500) voidPending = null;
      error(e);
      notice = "Ch\u01B0a x\xE1c nh\u1EADn \u0111\u01B0\u1EE3c l\u1EC7nh g\u1EE1: " + e.message;
      save();
      busy = false;
      render();
    }
  }
  function click(e) {
    const b = e.target.closest("button");
    if (!b || busy) return;
    if (b.hasAttribute("data-back")) {
      if ((lines.length || pending || voidPending) && !window.confirm("Nh\xE1p \u0111\u01B0\u1EE3c gi\u1EEF tr\xEAn m\xE1y n\xE0y. R\u1EDDi trang \u0111\u1ED1i so\xE1t?")) return;
      go("#/sepay");
      return;
    }
    if (b.hasAttribute("data-retry")) return void send();
    if (b.hasAttribute("data-retry-void")) return void sendVoid();
    if (b.hasAttribute("data-reload")) return void load();
    if (!summary) return;
    if (b.hasAttribute("data-page")) {
      filters.offset = Number(b.dataset.page);
      return void find();
    }
    if (b.hasAttribute("data-add")) {
      if (pending || voidPending || lines.length >= 100) return;
      const c = candidates.find((c2) => c2.targetId === b.dataset.add);
      if (!c) return;
      lines.push({ ...c, cap: c.outstanding ?? c.total, amount: 0, ghnFee: 0, paymentReviewed: false, existingPaymentId: "" });
      review = false;
      save();
      render();
    }
    const el = b.closest("[data-line]"), l = lines.find((l2) => l2.targetId === el?.dataset.line);
    if (l && b.hasAttribute("data-remove")) {
      lines = lines.filter((x) => x !== l);
      save();
      render();
    }
    if (l && b.hasAttribute("data-full")) {
      l.amount = Math.max(0, l.cap - fee(l));
      l.expectedAmount = l.cap;
      save();
      render();
    }
    if(l && b.hasAttribute("data-bank-remaining")){
      const available=summary.remaining-lines.filter(x=>x!==l).reduce((n,x)=>n+x.amount,0);
      l.expectedAmount=l.existingPaymentId?l.cap:(l.expectedAmount>0&&l.expectedAmount<=l.cap?l.expectedAmount:l.amount>0&&l.amount<=l.cap?l.amount:l.cap);
      l.amount=Math.max(0,available);
      review=false;save();render();
    }
    if (b.hasAttribute("data-review") && totals().valid && !stale && !summary.needsReview && !pending && !voidPending) {
      review = true;
      render();
      $("[data-check]").scrollIntoView({ block: "start" });
    }
    if (b.hasAttribute("data-cancel")) {
      review = false;
      render();
    }
    if (b.hasAttribute("data-confirm") && review && $("[data-verified]")?.checked && totals().valid) {
      pending = { clientKey: crypto.randomUUID(), expectedRevision: summary.revision, lines: lines.map((l2) => ({ targetId: l2.targetId, amount: l2.amount, expectedAmount: l2.expectedAmount||settled(l2), ghnFee: fee(l2) || void 0, differenceConfirmed: true, existingPaymentId: l2.existingPaymentId || void 0, paymentReviewed: !!l2.paymentReviewed })) };
      return void send();
    }
    if (b.hasAttribute("data-void")) {
      $("[data-void-form]").innerHTML = `<form data-void-id="${esc(b.dataset.void)}"><label>L\xFD do g\u1EE1 ph\xE2n b\u1ED5<textarea name="reason" minlength="3" maxlength="1000" required></textarea></label><label class="sp-check"><input type="checkbox" required>T\xF4i x\xE1c nh\u1EADn g\u1EE1 kho\u1EA3n thu n\xE0y theo \u0111\xFAng ch\u1EE9ng t\u1EEB.</label><button class="btn navy">X\xE1c nh\u1EADn g\u1EE1 ph\xE2n b\u1ED5</button></form>`;
      $("[data-void-form]").scrollIntoView({ block: "start" });
    }
  }
  function input(e) {
    const el = e.target.closest("[data-line]"), l = lines.find((l2) => l2.targetId === el?.dataset.line);
    if (!l || busy || pending) return;
    if (e.target.matches("[data-amount]")) { l.amount = Number(e.target.value); l.expectedAmount=l.cap; }
    if (e.target.matches("[data-ghn-fee]")) { l.ghnFee = Number(e.target.value) || 0; l.expectedAmount=l.cap; }
    if (e.target.matches("[data-percent]")) {
      const percent = Number(e.target.value);
      l.amount = percent > 0 && percent <= 100 ? Math.round((l.outstanding ?? l.cap) * percent / 100) : 0;
      l.expectedAmount=l.amount;
      el.querySelector("[data-amount]").value = l.amount || "";
    }
    update();
  }
  function change(e) {
    if (e.target.matches("[data-verified]")) {
      $("[data-confirm]").disabled = !e.target.checked;
      return;
    }
    const el = e.target.closest("[data-line]"), l = lines.find((l2) => l2.targetId === el?.dataset.line);
    if (!l || pending || busy) return;
    if (e.target.matches("[data-payment-reviewed]")) {
      l.paymentReviewed = e.target.checked;
      update();
    }
    if (e.target.matches("[data-receipt]")) {
      l.existingPaymentId = e.target.value;
      const p = l.existingPayments.find((p2) => p2.id === l.existingPaymentId);
      l.cap = p?.amount ?? l.outstanding ?? l.total;
      l.ghnFee = p?.source === "ghn_cod" ? Math.min(l.ghnFeeHint || 0, Math.max(0, (p.amount || 0) - 1)) : 0;
      l.amount = p ? p.amount - l.ghnFee : 0;
      l.expectedAmount=l.amount;
      save();
      review = false;
      render();
    }
  }
  function submit(e) {
    if (e.target.matches("[data-search]")) {
      e.preventDefault();
      if (busy) return;
      filters = { ...Object.fromEntries(new FormData(e.target)), q: new FormData(e.target).get("q").trim(), offset: 0 };
      void find();
    }
    if (e.target.matches("[data-void-id]")) {
      e.preventDefault();
      if (busy || pending || voidPending) return;
      voidPending = { id: e.target.dataset.voidId, body: { reason: new FormData(e.target).get("reason").trim(), expectedRevision: summary.revision } };
      save();
      void sendVoid();
    }
  }
  async function show(transactionId) {
    id = transactionId;
    path = "/sepay/transactions/" + encodeURIComponent(id) + "/allocations";
    root.addEventListener("click", click);
    root.addEventListener("submit", submit);
    root.addEventListener("input", input);
    root.addEventListener("change", change);
    window.addEventListener("beforeunload", beforeUnload);
    root.innerHTML = "<p>\u0110ang t\u1EA3i \u0111\u1ED1i so\xE1t chi ti\u1EBFt\u2026</p>";
    try {
      const me = await api("/me");
      if (!alive) return;
      storageKey = "bn-sepay-allocation:" + me.user.id + ":" + id;
      try {
        const stored = JSON.parse(sessionStorage.getItem(storageKey) || "null");
        if (stored) {
          lines = Array.isArray(stored.lines) ? stored.lines : [];
          pending = stored.pending || null;
          voidPending = stored.voidPending || null;
        }
      } catch {
        storageWarning = "Kh\xF4ng \u0111\u1ECDc \u0111\u01B0\u1EE3c nh\xE1p tr\xEAn m\xE1y. Ki\u1EC3m tra l\u1ECBch s\u1EED tr\u01B0\u1EDBc khi ph\xE2n b\u1ED5.";
      }
      await load();
    } catch (e) {
      if (alive) {
        error(e);
        render();
      }
    }
  }
  return { show, close };
}
export {
  allocationTotals,
  initSepayAllocations
};
