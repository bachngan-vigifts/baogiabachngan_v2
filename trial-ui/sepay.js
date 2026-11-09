const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n) =>
  Number.isFinite(n)
    ? new Intl.NumberFormat("vi-VN").format(n) + " ₫"
    : "Chưa đủ dữ liệu";
const stamp = (s) =>
  s && Number.isFinite(Date.parse(s))
    ? new Date(s).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
    : "Chưa xác định";
export const sepayStateLabel = (s) =>
  ({
    matched: "Đã ghi thu",
    unmatched: "Chưa khớp đơn",
    review: "Cần đối soát",
    receipt_issue: "Phiếu thu cần kiểm tra",
  })[s] || "Cần kiểm tra";
export function sepayDefaults(now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return { from: today.slice(0, 7) + "-01", to: today };
}
export function initSepay({ api, root, go, canOpenOrders = () => true }) {
  if (!document.getElementById("sepay-style")) {
    const l = document.createElement("link");
    l.id = "sepay-style";
    l.rel = "stylesheet";
    l.href = new URL("./sepay.css", import.meta.url).href;
    document.head.append(l);
  }
  root.dataset.mobileActions = "off";
  // This page owns all button locks, including refresh/recovery after a failed read.
  root.setAttribute("data-no-busy", "");
  let active = false,
    epoch = 0,
    detailEpoch = 0,
    searchEpoch = 0,
    params = null,
    data = null,
    event = null,
    selectedId = null,
    preview = null,
    draft = null,
    mutating = false,
    listLoading = false,
    pullNotice = "";
  const $ = (s) => root.querySelector(s),
    valid = (id, d) =>
      active && epoch === id && (d === undefined || detailEpoch === d);
  const badge = (s) =>
    `<span class="sp-badge sp-${esc(s)}">${esc(sepayStateLabel(s))}</span>`;
  const link = (o) => {
    const href =
      (o.contractNo ? "#/contracts/" : "#/orders/") +
      encodeURIComponent(o.orderId || o.id);
    return canOpenOrders()
      ? `<a href="${href}">${esc(o.contractNo || o.orderNo || "Mở đơn")}</a>`
      : esc(o.contractNo || o.orderNo || "Đơn CRM");
  };
  function close() {
    active = false;
    epoch++;
    detailEpoch++;
    searchEpoch++;
    event = null;
    preview = null;
    draft = null;
    pullNotice = "";
    root.replaceChildren();
  }
  function navigate(next) {
    if (mutating) return;
    go("#/sepay?" + next.toString());
  }
  function frame() {
    root.classList.add("sp-page");
    root.innerHTML = `<div class="page-head"><div><p class="eyebrow">TIỀN &amp; CÔNG NỢ</p><h1>Thanh toán SePay</h1><p class="muted">Tiền vào ngân hàng, phiếu thu và các khoản cần đối soát.</p></div><div class="sp-head-actions"><button class="btn navy" data-pull disabled>Lấy giao dịch hôm nay</button><button class="btn secondary" data-refresh>Làm mới</button></div></div><p class="sp-scope muted" data-pull-notice role="status">${esc(pullNotice)}</p>
    <form class="card sp-filters" data-filters><label>Từ ngày<input type="date" name="from" required value="${esc(params.get("from"))}"></label><label>Đến ngày<input type="date" name="to" required value="${esc(params.get("to"))}"></label>
    <label>Trạng thái<select name="status">${[
      ["all", "Tất cả"],
      ["pending", "Chờ đối soát"],
      ["matched", "Đã ghi thu"],
      ["unmatched", "Chưa khớp đơn"],
      ["review", "Cần đối soát"],
      ["receipt_issue", "Phiếu thu cần kiểm tra"],
    ]
      .map(
        ([v, t]) =>
          `<option value="${v}" ${params.get("status") === v ? "selected" : ""}>${t}</option>`,
      )
      .join("")}</select></label>
    <label>Tài khoản nhận<input name="account" placeholder="Đúng số tài khoản" maxlength="100" value="${esc(params.get("account"))}"></label>
    <label class="sp-search">Tìm giao dịch / đơn / khách<input name="q" maxlength="120" placeholder="Mã SePay, nội dung, số đơn, khách hàng…" value="${esc(params.get("q"))}"></label>
    <label>Số tiền từ (₫)<input type="number" name="min" min="0" max="1000000000000" step="1" value="${esc(params.get("min"))}"></label><label>Đến (₫)<input type="number" name="max" min="0" max="1000000000000" step="1" value="${esc(params.get("max"))}"></label>
    <div class="sp-filter-actions"><button class="btn navy" type="submit">Lọc giao dịch</button><button class="btn ghost" type="button" data-clear>Bỏ lọc</button></div></form>
    <div class="sp-stats" data-stats aria-live="polite">${["Tổng tiền SePay", "Đã ghi thu vào CRM", "Chờ đối soát", "Phiếu thu cần kiểm tra"].map((t) => `<section class="card"><span>${t}</span><strong>—</strong><small>Đang tải…</small></section>`).join("")}</div>
    <p class="muted sp-scope">Tổng hợp theo toàn bộ bộ lọc, không chỉ các dòng đang hiển thị. Ngày/giờ Việt Nam.</p><div data-setup></div>
    <div class="sp-layout"><section class="card sp-list"><div class="sp-heading"><h2>Giao dịch nhận từ SePay</h2><span data-count></span></div><div data-list role="status">Đang tải giao dịch…</div><div class="sp-pager" data-pager></div></section>
    <section class="card sp-detail" data-detail tabindex="-1" role="region" aria-label="Đối soát giao dịch"><h2>Đối soát giao dịch</h2><p class="muted">Chọn “Xem / đối soát” để xem chứng từ, đơn và phiếu thu.</p></section></div>`;
  }
  function listBusy(b) {
    listLoading = b;
    $("[data-filters]")
      .querySelectorAll("input,select,button")
      .forEach((x) => (x.disabled = b || mutating));
    $("[data-refresh]").disabled = b || mutating;
    $("[data-pull]").disabled = b || mutating || !data?.capabilities?.canPull;
    root.setAttribute("aria-busy", String(b));
  }
  async function load(id) {
    listBusy(true);
    try {
      const next = await api("/sepay/transactions?" + params.toString());
      if (!valid(id)) return;
      data = next;
      const s = next.summary;
      $("[data-stats]").innerHTML = [
        ["Tổng tiền SePay", s.amount, s.count, ""],
        ["Đã ghi thu vào CRM", s.postedAmount, s.postedCount, "posted"],
        ["Chờ đối soát", s.pendingAmount, s.pendingCount, "pending"],
        ["Phiếu thu cần kiểm tra", s.issueAmount, s.issueCount, "issue"],
      ]
        .map(
          ([t, a, c, tone]) =>
            `<section class="card sp-stat-${tone}"><span>${t}</span><strong>${esc(money(a))}</strong><small>${esc(c)} giao dịch</small></section>`,
        )
        .join("");
      $("[data-setup]").innerHTML = next.automationConfigured
        ? ""
        : `<p class="sp-warning">Tài khoản nhận tiền tự động chưa được cấu hình. Giao dịch vẫn được lưu để đối soát; chưa tự ghi thu.</p>`;
      if(!next.capabilities?.canPull)$("[data-setup]").insertAdjacentHTML("beforeend",'<p class="sp-warning">Chưa cấu hình API đọc SePay trên máy chủ. Vẫn có thể nhận giao dịch qua webhook.</p>');
      const rows = next.transactions;
      $("[data-count]").textContent = next.pagination.total + " giao dịch";
      $("[data-list]").innerHTML = rows.length
        ? `<table class="sp-table"><thead><tr><th>Ngày / mã SePay</th><th>Số tiền</th><th>Nội dung / tài khoản</th><th>Trạng thái / đơn</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr data-row="${esc(r.id)}"><td>${esc(stamp(r.transactionAt))}<small>${esc(r.providerId)}</small></td><td class="sp-money">${esc(money(r.amount))}</td><td class="sp-content">${esc(r.content)}<small>TK ${esc(r.accountNumber)}</small></td><td>${badge(r.status)}${r.orderId ? `<small>${link(r)}</small>` : ""}${r.status === "receipt_issue" ? "<small>Kiểm tra phiếu thu đã huỷ, thiếu hoặc không khớp.</small>" : ""}</td><td><button class="btn secondary small" data-open="${esc(r.id)}">Xem / đối soát</button></td></tr>`).join("")}</tbody></table>`
        : '<p class="sp-empty">Không có giao dịch trong bộ lọc này.</p>';
      const p = next.pagination;
      $("[data-pager]").innerHTML =
        `<button class="btn secondary small" data-prev ${p.offset === 0 ? "disabled" : ""}>← Trước</button><span>${p.total ? p.offset + 1 : 0}–${p.offset + rows.length} / ${p.total}</span><button class="btn secondary small" data-next ${!p.hasMore ? "disabled" : ""}>Sau →</button>`;
    } catch (e) {
      if (!valid(id)) return;
      data = null;
      $("[data-stats]")
        .querySelectorAll("strong")
        .forEach((x) => (x.textContent = "—"));
      $("[data-stats]")
        .querySelectorAll("small")
        .forEach((x) => (x.textContent = "Chưa tải được"));
      $("[data-list]").innerHTML =
        `<p class="sp-error" role="alert">Không tải được giao dịch: ${esc(e.message)}. Bấm “Làm mới” để thử lại.</p>`;
      $("[data-count]").textContent = "";
      $("[data-pager]").replaceChildren();
    } finally {
      if (valid(id)) listBusy(false);
    }
  }
  async function pullToday() {
    if (mutating || listLoading || !data?.capabilities?.canPull) return;
    const own = epoch;
    mutating = true;detailEpoch++;searchEpoch++;event=null;preview=null;draft=null;
    $("[data-detail]").innerHTML='<h2>Đối soát giao dịch</h2><p class="muted">Chọn giao dịch sau khi tải xong.</p>';
    listBusy(true);
    $("[data-pull-notice]").textContent="Đang lấy giao dịch hôm nay từ SePay… Chỉ tải để đối soát, chưa ghi thu.";
    try {
      const r = await api("/sepay/pull-today", "POST", {});
      if (!valid(own)) return;
      pullNotice=`Ngày ${r.day}: thêm ${r.imported} giao dịch tiền vào; ${r.duplicate} đã có; bỏ qua ${r.outgoing} giao dịch không có tiền vào. Chưa tạo phiếu thu.`;
      $("[data-pull-notice]").textContent=pullNotice;
      mutating=false;
      const next=new URLSearchParams({from:r.day,to:r.day,status:"all"});
      if(params.toString()===next.toString())await load(own);else navigate(next);
    } catch(e) {
      if(valid(own))$("[data-pull-notice]").textContent="Chưa xác nhận được đợt lấy giao dịch: "+e.message+" Có thể thử lại; hệ thống kiểm tra ID trùng.";
    } finally {
      mutating=false;if(valid(own))listBusy(false);
    }
  }
  function receiptView(r) {
    return r.paymentId
      ? `<div class="sp-receipt"><b>Phiếu thu ${esc(r.paymentId)}</b><p>${esc(money(r.paymentAmount))} · ${esc(r.paymentDate || "Chưa có ngày thu")}</p><p>${esc(r.paymentReference || "")}</p>${r.status === "receipt_issue" ? '<p class="sp-error">Phiếu thu đã huỷ, thiếu hoặc không khớp. Không tạo lại phiếu từ giao dịch này.</p>' : ""}${r.orderId ? link(r) : ""}</div>`
      : "";
  }
  async function openDetail(id) {
    if (mutating) return;
    selectedId = id;
    const back = '<button class="btn secondary small sp-back" type="button" data-back-list>← Về giao dịch</button>';
    const own = epoch,
      d = ++detailEpoch;
    searchEpoch++;
    event = null;
    preview = null;
    draft = null;
    $("[data-detail]").innerHTML =
      back + '<h2>Đối soát giao dịch</h2><p role="status">Đang tải chứng từ…</p>';
    // On narrow layouts this region follows the entire list. Reveal the response
    // immediately rather than silently updating content several screens below the button.
    $("[data-detail]").focus({ preventScroll: true });
    $("[data-detail]").scrollIntoView({ block: "start", behavior: "instant" });
    try {
      const res = await api("/sepay/transactions/" + encodeURIComponent(id));
      if (!valid(own, d)) return;
      event = res.transaction;
      const r = event;
      $("[data-detail]").innerHTML =
        `${back}<div class="sp-heading"><h2>Đối soát giao dịch</h2>${badge(r.status)}</div><strong class="sp-bank-amount">${esc(money(r.amount))}</strong><dl class="sp-info"><dt>Mã SePay</dt><dd>${esc(r.providerId)}</dd><dt>Thời gian</dt><dd>${esc(stamp(r.transactionAt))}</dd><dt>Tài khoản nhận</dt><dd>${esc(r.accountNumber)}</dd><dt>Nội dung gốc</dt><dd class="sp-original">${esc(r.content)}</dd></dl>
      ${r.reason ? `<p class="sp-warning">${esc(r.reason)}</p>` : ""}${receiptView(r)}
      <div data-notice aria-live="polite"></div>
      ${!data?.capabilities.canConfirm ? '<p class="sp-readonly">Kế toán được xem và đối chiếu. Chỉ Manager được xác nhận ghi thu.</p>' : !res.capabilities.canConfirm ? `<p class="sp-readonly">${esc(res.blockReason || "Giao dịch đã được xử lý; không tạo thêm phiếu thu.")}</p>` : !res.accountApproved ? '<p class="sp-warning">Tài khoản này chưa được duyệt nhận tiền cho đơn CRM. Cần cấu hình tài khoản trước khi xác nhận.</p>' : `<section class="sp-match"><h3>Chọn đơn / HĐKT</h3><p class="muted small">Gắn toàn bộ số tiền vào một đơn CRM/HĐKT. Khoản POS, đơn web chưa chuyển CRM và khoản cần chia nhiều đơn xử lý theo luồng riêng.</p><form data-order-search><label>Tìm số đơn hoặc khách hàng<input name="orderQuery" minlength="2" maxlength="120" required placeholder="Nhập ít nhất 2 ký tự"></label><button class="btn secondary" type="submit">Tìm đơn</button></form><div data-order-results></div><div data-preview></div></section>`}
      ${res.history.length ? `<details class="sp-history"><summary>Nhật ký xử lý (${res.history.length})</summary>${res.history.map((h) => `<article><b>${esc(h.actorName || "Hệ thống")}</b> · ${esc(stamp(h.createdAt))}<p>${esc(h.reason || "Kiểm tra lại giao dịch")}</p></article>`).join("")}</details>` : ""}`;
      root
        .querySelectorAll("[data-row]")
        .forEach((x) =>
          x.classList.toggle("sp-selected", x.dataset.row === id),
        );
      // Loading content is short and may clamp scrolling at the page bottom.
      // Reposition once the full form exists, unless the user has already returned to the list.
      if (document.activeElement === $("[data-detail]"))
        $("[data-detail]").scrollIntoView({ block: "start", behavior: "instant" });
    } catch (e) {
      if (valid(own, d))
        $("[data-detail]").innerHTML =
          `${back}<h2>Đối soát giao dịch</h2><p role="alert" class="sp-error">${esc(e.message)}</p>`;
    }
  }
  async function searchOrders(form) {
    if (!event || mutating) return;
    const own = epoch,
      d = detailEpoch,
      s = ++searchEpoch,
      q = String(new FormData(form).get("orderQuery") || "").trim();
    if (q.length < 2) return;
    form.querySelector('button[type="submit"]').disabled = true;
    $("[data-order-results]").textContent = "Đang tìm…";
    preview = null;
    draft = null;
    $("[data-preview]").replaceChildren();
    try {
      const r = await api("/sepay/orders?q=" + encodeURIComponent(q));
      if (!valid(own, d) || s !== searchEpoch) return;
      $("[data-order-results]").innerHTML = r.orders.length
        ? `<ul class="sp-order-results">${r.orders.map((o) => `<li><button type="button" data-choose="${esc(o.id)}"><b>${esc(o.contractNo || o.orderNo)}</b><span>${esc(o.customerName)} · ${esc(money(o.total))}</span></button></li>`).join("")}</ul>${r.hasMore ? '<p class="muted small">Có thêm kết quả. Nhập cụ thể hơn để tìm đúng đơn.</p>' : ""}`
        : '<p class="sp-empty">Không tìm thấy đơn CRM/HĐKT hợp lệ.</p>';
    } catch (e) {
      if (valid(own, d) && s === searchEpoch)
        $("[data-order-results]").innerHTML =
          `<p class="sp-error" role="alert">${esc(e.message)}</p>`;
    } finally {
      if (valid(own, d) && s === searchEpoch)
        form.querySelector('button[type="submit"]').disabled = false;
    }
  }
  async function chooseOrder(id) {
    if (!event || mutating) return;
    const own = epoch,
      d = detailEpoch,
      s = ++searchEpoch;
    preview = null;
    draft = null;
    $("[data-preview]").textContent = "Đang kiểm tra công nợ…";
    try {
      const p = await api(
        "/sepay/orders/" +
          encodeURIComponent(id) +
          "?transactionId=" +
          encodeURIComponent(event.id),
      );
      if (!valid(own, d) || s !== searchEpoch) return;
      preview = p;
      $("[data-preview]").innerHTML =
        `<section class="sp-order-preview"><h3>${link(p.order)}</h3><p>${esc(p.order.customerName)}</p><dl class="sp-info"><dt>Giá trị đơn</dt><dd>${esc(money(p.order.total))}</dd><dt>Còn phải thu</dt><dd>${esc(money(p.debt.balance))}</dd><dt>Nhân viên đang giữ</dt><dd>${esc(money(p.debt.held))}</dd><dt>Còn có thể thu</dt><dd><b>${esc(money(p.debt.available))}</b></dd></dl>
      ${p.manualConflict ? '<p class="sp-warning">Có phiếu chuyển khoản nhập trước cần đối chiếu. Chọn phiếu khớp để gắn giao dịch, không tạo thêm tiền.</p>' : ""}
      ${!p.canCreate ? '<p class="sp-warning">Chưa thể tạo phiếu thu mới: kiểm tra công nợ, tài khoản và các khoản đã thu.</p>' : ""}
      <form data-approval-form><label>Cách ghi nhận<select name="existingPaymentId"><option value="" ${!p.canCreate ? "disabled" : ""} ${!p.existingReceipts.length ? "selected" : ""}>Tạo phiếu thu mới</option>${p.existingReceipts.map((x, i) => `<option value="${esc(x.id)}" ${i === 0 ? "selected" : ""}>Gắn phiếu ${esc(x.reference || x.id)} · ${esc(money(x.amount))} · ${esc(x.paidAt)}</option>`).join("")}</select></label>
      ${p.moreReceipts ? '<p class="muted small">Hiện tối đa 50 phiếu khớp. Kiểm tra kỹ mã phiếu trước khi chọn.</p>' : ""}
      <label>Lý do đối soát<textarea name="reason" required minlength="10" maxlength="1000" rows="3" placeholder="Ghi căn cứ xác định đúng đơn hoặc phiếu thu (ít nhất 10 ký tự)"></textarea></label><label class="sp-check"><input type="checkbox" name="verified" required><span>Tôi đã đối chiếu giao dịch ngân hàng, đơn và phiếu thu.</span></label><button class="btn navy" type="submit" ${!p.canCreate && !p.existingReceipts.length ? "disabled" : ""}>Xem lại trước khi xác nhận</button></form><div data-review></div></section>`;
    } catch (e) {
      if (valid(own, d) && s === searchEpoch)
        $("[data-preview]").innerHTML =
          `<p class="sp-error" role="alert">${esc(e.message)}</p>`;
    }
  }
  function prepare(form) {
    if (!event || !preview || mutating) return;
    const f = new FormData(form);
    draft = {
      orderId: preview.order.id,
      reason: String(f.get("reason") || "").trim(),
      confirmed: true,
    };
    const receipt = String(f.get("existingPaymentId") || "");
    if (receipt) draft.existingPaymentId = receipt;
    $("[data-review]").innerHTML =
      `<section class="sp-review"><h3>Kiểm tra lần cuối</h3><p><b>${esc(money(event.amount))}</b> · TK ${esc(event.accountNumber)} · ${esc(stamp(event.transactionAt))}</p><p>Đơn/HĐKT: <b>${esc(preview.order.contractNo || preview.order.orderNo)}</b> · ${esc(preview.order.customerName)}</p><p>${receipt ? "Gắn với phiếu thu đã có; không cộng thêm tiền." : "Tạo phiếu thu cho toàn bộ số tiền giao dịch."}</p><p class="sp-original">Lý do: ${esc(draft.reason)}</p><button class="btn navy" type="button" data-confirm>Xác nhận ${receipt ? "đối soát" : "ghi thu"}</button><button class="btn ghost" type="button" data-cancel-review>Quay lại kiểm tra</button></section>`;
  }
  async function confirm() {
    if (!draft || !event || mutating) return;
    const own = epoch,
      d = detailEpoch,
      id = event.id,
      body = { ...draft };
    mutating = true;
    root
      .querySelectorAll("input,select,textarea,button")
      .forEach((x) => (x.disabled = true));
    try {
      const r = await api(
        "/sepay/transactions/" + encodeURIComponent(id) + "/confirm",
        "POST",
        body,
      );
      if (!valid(own, d)) return;
      mutating = false;
      await load(own);
      if (!valid(own, d)) return;
      await openDetail(id);
      if (valid(own) && event?.id === id)
        $("[data-notice]").innerHTML =
          `<p class="sp-success" role="status">${r.duplicate ? "Giao dịch đã được ghi nhận trước đó; không tạo thêm phiếu thu." : body.existingPaymentId ? "Đã gắn giao dịch với phiếu thu hiện có; không cộng thêm tiền." : "Đã ghi thu vào đúng đơn."}</p>`;
    } catch (e) {
      if (valid(own, d)) {
        draft = null;
        $("[data-notice]").innerHTML =
          `<p class="sp-error" role="alert">Chưa xác nhận được kết quả: ${esc(e.message)}. Tải lại giao dịch trước khi thao tác tiếp.</p><button class="btn secondary" data-reload-detail>Tải lại giao dịch</button>`;
        $("[data-review]")?.replaceChildren();
      }
    } finally {
      mutating = false;
      if (active) {
        listBusy(listLoading);
        root
          .querySelectorAll("[data-open]")
          .forEach((x) => (x.disabled = false));
        if (data) {
          $("[data-prev]").disabled = data.pagination.offset === 0;
          $("[data-next]").disabled = !data.pagination.hasMore;
        }
        $("[data-reload-detail]")?.removeAttribute("disabled");
      }
    }
  }
  root.addEventListener("submit", (e) => {
    if (!active) return;
    e.preventDefault();
    if (e.target.matches("[data-filters]")) {
      const next = new URLSearchParams();
      for (const [k, v] of new FormData(e.target))
        if (String(v).trim()) next.set(k, String(v).trim());
      navigate(next);
    } else if (e.target.matches("[data-order-search]")) searchOrders(e.target);
    else if (e.target.matches("[data-approval-form]")) prepare(e.target);
  });
  root.addEventListener("input", (e) => {
    if (e.target.closest("[data-approval-form]")) {
      draft = null;
      $("[data-review]")?.replaceChildren();
    }
  });
  root.addEventListener("change", (e) => {
    if (e.target.closest("[data-approval-form]")) {
      draft = null;
      $("[data-review]")?.replaceChildren();
    }
  });
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !active || mutating) return;
    if (b.hasAttribute("data-pull")) pullToday();
    if (b.hasAttribute("data-refresh")) load(epoch);
    if (b.hasAttribute("data-back-list")) {
      const target = [...root.querySelectorAll("[data-open]")].find(x => x.dataset.open === selectedId) || $("[data-list]");
      if (!target.hasAttribute("tabindex") && target.tagName !== "BUTTON") target.tabIndex = -1;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "center", behavior: "instant" });
    }
    if (b.hasAttribute("data-clear"))
      navigate(new URLSearchParams(sepayDefaults()));
    if (b.dataset.open) openDetail(b.dataset.open);
    if (b.dataset.choose) chooseOrder(b.dataset.choose);
    if (b.hasAttribute("data-reload-detail") && event) openDetail(event.id);
    if (b.hasAttribute("data-confirm")) confirm();
    if (b.hasAttribute("data-cancel-review")) {
      draft = null;
      $("[data-review]").replaceChildren();
    }
    if ((b.hasAttribute("data-prev") || b.hasAttribute("data-next")) && data) {
      const n = new URLSearchParams(params);
      n.set(
        "offset",
        String(
          Math.max(
            0,
            data.pagination.offset +
              (b.hasAttribute("data-next") ? 1 : -1) * data.pagination.limit,
          ),
        ),
      );
      navigate(n);
    }
  });
  async function show(query = "") {
    active = true;
    const id = ++epoch;
    detailEpoch++;
    searchEpoch++;
    data = null;
    event = null;
    preview = null;
    draft = null;
    params = new URLSearchParams(query);
    const defaults = sepayDefaults();
    for (const k of ["from", "to"])
      if (!params.has(k)) params.set(k, defaults[k]);
    if (!params.has("status")) params.set("status", "all");
    frame();
    await load(id);
  }
  return { show, close };
}
