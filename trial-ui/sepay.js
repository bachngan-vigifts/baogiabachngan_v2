import {initSepayAllocations} from './sepay-allocations.js';
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
    debit:"Tiền ra – chỉ theo dõi",
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
  let allocationUi=null;
  let active = false,
    epoch = 0,
    detailEpoch = 0,
    searchEpoch = 0,
    searchTimer = null,
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
  const badge = (s, web = false) =>
    `<span class="sp-badge sp-${esc(s)}">${esc(web ? (s === "matched" ? "Đã đối soát đơn web" : s === "receipt_issue" ? "Đơn web cần kiểm tra" : sepayStateLabel(s)) : sepayStateLabel(s))}</span>`;
  const link = (o) => {
    const href =
      (o.webOrderId
        ? "#/orders/web:"
        : o.contractNo
          ? "#/contracts/"
          : "#/orders/") +
      encodeURIComponent(o.webOrderId || o.orderId || o.id);
    return canOpenOrders()
      ? `<a href="${href}">${esc(o.webOrderNo || o.contractNo || o.orderNo || "Mở đơn")}</a>`
      : esc(o.webOrderNo || o.contractNo || o.orderNo || "Đơn CRM");
  };
  function close() {
    allocationUi?.close();allocationUi=null;
    active = false;
    epoch++;
    detailEpoch++;
    clearTimeout(searchTimer);
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
    root.innerHTML = `<div class="page-head"><div><p class="eyebrow">TIỀN &amp; CÔNG NỢ</p><h1>Thanh toán SePay</h1><p class="muted">Giao dịch ngân hàng theo công ty, phiếu thu và các khoản cần đối soát.</p></div><div class="sp-head-actions"><button class="btn navy" data-pull disabled>Lấy giao dịch hôm nay</button><button class="btn secondary" data-refresh>Làm mới</button></div></div><p class="sp-scope muted" data-pull-notice role="status">${esc(pullNotice)}</p>
    <p class="sp-warning" data-web-scope role="status" hidden></p>
    <div class="sp-companies" role="tablist" aria-label="Công ty">${[['vigifts','Vigifts'],['bach-ngan','Bách Ngân']].map(([key,label])=>`<button type="button" role="tab" aria-selected="${params.get('entity')===key}" data-entity="${key}">${label}</button>`).join('')}</div><div class="sp-entity-note"><span class="muted">Phân theo tài khoản ngân hàng đã cấu hình.</span><button type="button" class="btn ghost small" aria-pressed="${params.get('entity')==='unassigned'}" data-entity="unassigned">Tài khoản chưa phân loại</button></div>
    <form class="card sp-filters" data-filters><label>Từ ngày<input type="date" name="from" required value="${esc(params.get("from"))}"></label><label>Đến ngày<input type="date" name="to" required value="${esc(params.get("to"))}"></label>
    <label>Trạng thái<select name="status">${[
      ["all", "Tất cả"],
      ["pending", "Chờ đối soát"],
      ["matched", "Đã ghi thu"],
      ["unmatched", "Chưa khớp đơn"],
      ["review", "Cần đối soát"],
      ["receipt_issue", "Khoản thu cần kiểm tra"],
    ]
      .map(
        ([v, t]) =>
          `<option value="${v}" ${params.get("status") === v ? "selected" : ""}>${t}</option>`,
      )
      .join("")}</select></label>
    <label>Tài khoản ngân hàng<input name="account" placeholder="Đúng số tài khoản" maxlength="100" value="${esc(params.get("account"))}"></label>
    <label class="sp-search">Tìm giao dịch / đơn / khách<input name="q" maxlength="120" placeholder="Mã SePay, nội dung, số đơn, khách hàng…" value="${esc(params.get("q"))}"></label>
    <label>Số tiền từ (₫)<input type="number" name="min" min="0" max="1000000000000" step="1" value="${esc(params.get("min"))}"></label><label>Đến (₫)<input type="number" name="max" min="0" max="1000000000000" step="1" value="${esc(params.get("max"))}"></label>
    <label data-direction-field hidden>Loại giao dịch<select name="direction">${[['in','Tiền vào'],['out','Tiền ra'],['all','Tiền vào và tiền ra']].map(([v,t])=>`<option value="${v}" ${params.get('direction')===v?'selected':''}>${t}</option>`).join('')}</select></label>
    <div class="sp-filter-actions"><button class="btn navy" type="submit">Lọc giao dịch</button><button class="btn ghost" type="button" data-clear>Bỏ lọc</button></div></form>
    <div class="sp-stats" data-stats aria-live="polite">${["Tổng tiền SePay", "Đã ghi thu / đối soát", "Chờ đối soát", "Khoản thu cần kiểm tra"].map((t) => `<section class="card"><span>${t}</span><strong>—</strong><small>Đang tải…</small></section>`).join("")}</div>
    <p class="muted sp-scope">Tổng hợp theo toàn bộ bộ lọc, không chỉ các dòng đang hiển thị. Ngày/giờ Việt Nam.</p><div data-setup></div>
    <div class="sp-layout"><section class="card sp-list"><div class="sp-heading"><h2>Giao dịch nhận từ SePay</h2><span data-count></span></div><div data-list role="status">Đang tải giao dịch…</div><div class="sp-pager" data-pager></div></section>
    <section class="card sp-detail" data-detail tabindex="-1" role="region" aria-label="Đối soát giao dịch"><h2>Đối soát giao dịch</h2><p class="muted">Chọn “Xem / đối soát” để xem chứng từ, đơn và phiếu thu.</p></section></div>`;
  }
  function listBusy(b) {
    listLoading = b;
    $("[data-filters]")
      .querySelectorAll("input,select,button")
      .forEach((x) => (x.disabled = b || mutating));
    root.querySelectorAll("[data-entity]").forEach(x=>x.disabled=b||mutating);
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
      $('[data-web-scope]').textContent=next.webOrderScopeMessage||'';
      $('[data-web-scope]').hidden=!next.webOrderScopeMessage;
      const s = next.summary;
      $("[data-direction-field]").hidden=!next.capabilities?.canViewDebits;
      $("[data-stats]").innerHTML = [
        ["Tổng tiền vào", s.amount, s.incomingCount??s.count, ""],
        ["Đã ghi thu / đối soát", s.postedAmount, s.postedCount, "posted"],
        ["Chờ đối soát", s.pendingAmount, s.pendingCount, "pending"],
        ["Khoản thu cần kiểm tra", s.issueAmount, s.issueCount, "issue"],
        ...(next.capabilities?.canViewDebits?[["Tiền ra",s.outgoingAmount,s.outgoingCount,"outgoing"]]:[]),
      ]
        .map(
          ([t, a, c, tone]) =>
            `<section class="card sp-stat-${tone}"><span>${t}</span><strong>${esc(money(a))}</strong><small>${esc(c)} giao dịch</small></section>`,
        )
        .join("");
      $("[data-setup]").innerHTML = next.automationConfigured
        ? ""
        : `<p class="sp-warning">Chưa bật tự ghi thu cho đơn CRM. Manager vẫn có thể chọn đơn và xác nhận tạo phiếu thu từ tài khoản ngân hàng đã cấu hình ở quầy; POS/web đối soát theo chứng từ nguồn.</p>`;
      if (!next.capabilities?.canPull)
        $("[data-setup]").insertAdjacentHTML(
          "beforeend",
          '<p class="sp-warning">Chưa cấu hình API đọc SePay trên máy chủ. Vẫn có thể nhận giao dịch qua webhook.</p>',
        );
      if(next.capabilities?.canViewDebits&&!next.capabilities?.debitImportEnabled)$('[data-setup]').insertAdjacentHTML('beforeend','<p class="sp-warning">Đồng bộ tiền ra chưa bật; hiện chỉ hiển thị các khoản tiền ra đã có trong CRM.</p>');
      const rows = next.transactions;
      $("[data-count]").textContent = next.pagination.total + " giao dịch";
      $("[data-list]").innerHTML = rows.length
        ? `<table class="sp-table"><thead><tr><th>Ngày / mã SePay</th><th>Số tiền</th><th>Nội dung / tài khoản</th><th>Trạng thái / đơn</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr data-row="${esc(r.id)}"><td>${esc(stamp(r.transactionAt))}<small>${esc(r.providerId)}</small></td><td class="sp-money ${r.transferType==='out'?'sp-outgoing':''}">${r.transferType==='out'?'− ':''}${esc(money(r.amount))}</td><td class="sp-content">${esc(r.content)}<small>TK ${esc(r.accountNumber)}</small></td><td>${badge(r.status, !!r.webOrderId)}${r.orderId || r.webOrderId ? `<small>${link(r)}</small>` : ""}${r.status === "receipt_issue" ? `<small>${r.webOrderId ? "Đơn web hoặc xác nhận thanh toán đã thay đổi; cần kiểm tra." : "Kiểm tra phiếu thu đã huỷ, thiếu hoặc không khớp."}</small>` : ""}</td><td><button class="btn secondary small" data-open="${esc(r.id)}">${r.transferType==='out'?'Xem tiền ra':'Xem / đối soát'}</button></td></tr>`).join("")}</tbody></table>`
        : '<p class="sp-empty">Không có giao dịch trong bộ lọc này.</p>';
      const p = next.pagination;
      $("[data-pager]").innerHTML =
        `<button class="btn secondary small" data-prev ${p.offset === 0 ? "disabled" : ""}>← Trước</button><span>${p.total ? p.offset + 1 : 0}–${p.offset + rows.length} / ${p.total}</span><button class="btn secondary small" data-next ${!p.hasMore ? "disabled" : ""}>Sau →</button>`;
    } catch (e) {
      if (!valid(id)) return;
      data = null;event=null;preview=null;draft=null;selectedId=null;detailEpoch++;
      $('[data-direction-field]').hidden=true;
      $('[data-stats] .sp-stat-outgoing')?.remove();
      $('[data-detail]').innerHTML='<h2>Đối soát giao dịch</h2><p class="muted">Chưa tải được dữ liệu; hãy làm mới để kiểm tra quyền truy cập.</p>';
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
    mutating = true;
    detailEpoch++;
    searchEpoch++;
    event = null;
    preview = null;
    draft = null;
    $("[data-detail]").innerHTML =
      '<h2>Đối soát giao dịch</h2><p class="muted">Chọn giao dịch sau khi tải xong.</p>';
    listBusy(true);
    $("[data-pull-notice]").textContent =
      "Đang lấy giao dịch SePay và đối soát POS/web khi đủ căn cứ…";
    try {
      const r = await api("/sepay/pull-today", "POST", {});
      if (!valid(own)) return;
      pullNotice = `Ngày ${r.day}: thêm ${r.imported} giao dịch tiền vào; ${r.duplicate} đã có; ${r.outgoing===undefined?'':`${data?.capabilities?.debitImportEnabled?'Đã đồng bộ':'Đã đọc, chưa bật lưu'} ${r.outgoing} giao dịch tiền ra / không có tiền vào. `}${r.nearbyMatched ? `Đã tự đối soát ${r.nearbyMatched} khoản POS/web. ` : ""}Không tạo phiếu thu mới.`;
      $("[data-pull-notice]").textContent = pullNotice;
      mutating = false;
      const next = new URLSearchParams({
        from: r.day,
        to: r.day,
        status: "all",entity:params.get("entity")||"bach-ngan",direction:params.get("direction")||"in",
      });
      if (params.toString() === next.toString()) await load(own);
      else navigate(next);
    } catch (e) {
      if (valid(own))
        $("[data-pull-notice]").textContent =
          "Chưa xác nhận được đợt lấy giao dịch: " +
          e.message +
          " Có thể thử lại; hệ thống kiểm tra ID trùng.";
    } finally {
      mutating = false;
      if (valid(own)) listBusy(false);
    }
  }
  function receiptView(r) {
    if (r.webOrderId)
      return `<div class="sp-receipt"><b>Đơn web ${esc(r.webOrderNo || r.orderNo || "Không còn tìm thấy đơn nguồn")}</b><p>${r.status === "matched" ? "Đã đối soát khoản thu website; không tạo thêm phiếu thu CRM." : "Khoản thu website cần kiểm tra theo trạng thái giao dịch."}</p>${link(r)}</div>`;
    return r.paymentId
      ? `<div class="sp-receipt"><b>Phiếu thu ${esc(r.paymentId)}</b><p>${esc(money(r.paymentAmount))} · ${esc(r.paymentDate || "Chưa có ngày thu")}</p><p>${esc(r.paymentReference || "")}</p>${r.status === "receipt_issue" ? '<p class="sp-error">Phiếu thu đã huỷ, thiếu hoặc không khớp. Không tạo lại phiếu từ giao dịch này.</p>' : ""}${r.orderId ? link(r) : ""}</div>`
      : "";
  }
  async function openDetail(id) {
    if (mutating) return;
    selectedId = id;
    const back =
      '<button class="btn secondary small sp-back" type="button" data-back-list>← Về giao dịch</button>';
    const own = epoch,
      d = ++detailEpoch;
    clearTimeout(searchTimer);
    searchEpoch++;
    event = null;
    preview = null;
    draft = null;
    $("[data-detail]").innerHTML =
      back +
      '<h2>Đối soát giao dịch</h2><p role="status">Đang tải chứng từ…</p>';
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
        `${back}<div class="sp-heading"><h2>Đối soát giao dịch</h2>${badge(r.status, !!r.webOrderId)}</div><strong class="sp-bank-amount ${r.transferType==='out'?'sp-outgoing':''}">${r.transferType==='out'?'− ':''}${esc(money(r.amount))}</strong><dl class="sp-info"><dt>Mã SePay</dt><dd>${esc(r.providerId)}</dd><dt>Thời gian</dt><dd>${esc(stamp(r.transactionAt))}</dd><dt>Tài khoản ngân hàng</dt><dd>${esc(r.accountNumber)}</dd><dt>Nội dung gốc</dt><dd class="sp-original">${esc(r.content)}</dd></dl>
      ${r.reason && !(r.webOrderId && r.status === "matched") ? `<p class="sp-warning">${esc(r.reason)}</p>` : ""}${receiptView(r)}
      <div data-notice aria-live="polite"></div>
      ${data?.capabilities.canConfirm&&r.transferType==='in'&&(r.detailed||['review','unmatched'].includes(r.status))?`<a class="btn navy" href="#/sepay?allocation=${encodeURIComponent(r.id)}">Đối soát chi tiết · nhiều đơn</a>`:''}
      ${!data?.capabilities.canConfirm ? '<p class="sp-readonly">Tài khoản được cấp quyền SePay được xem và tải giao dịch. Cần quyền Đối soát khoản thu SePay để chọn đơn và xác nhận ghi thu.</p>' : !res.capabilities.canConfirm ? `<p class="sp-readonly">${esc(res.blockReason || "Giao dịch đã được xử lý; không tạo thêm phiếu thu.")}</p>` : `${!res.accountApproved ? '<p class="sp-warning">Tài khoản nhận chưa được duyệt ghi thu. Vẫn có thể tìm, chọn đơn/HĐKT và xem công nợ; cần duyệt tài khoản trước khi xác nhận thanh toán.</p>' : ""}<section class="sp-match"><h3>Chọn đơn / HĐKT</h3><p class="muted small">Chọn đúng đơn POS/web/CRM hoặc HĐKT. POS gắn phiếu chuyển khoản đã có; đơn web dùng chứng từ ngân hàng, không tạo phiếu thu CRM trùng.</p><form class="sp-order-filters" data-order-search><label class="sp-order-query">Tìm số đơn / HĐKT hoặc khách hàng<input name="orderQuery" maxlength="120" placeholder="Số đơn, khách hàng, điện thoại…"></label><label>Loại đơn<select name="source"><option value="all">Tất cả</option><option value="pos">Đơn POS</option><option value="web">Đơn website</option><option value="crm">Đơn CRM</option><option value="contract">HĐKT</option></select></label><label>Ngày đơn từ<input type="date" name="from"></label><label>Đến ngày<input type="date" name="to"></label><label>Trạng thái<select name="eligibility"><option value="active">Chưa hủy (gồm bản nháp)</option><option value="eligible">Có thể chọn đối soát</option><option value="draft">Bản nháp chưa duyệt/ký</option><option value="cancelled">Đã hủy</option><option value="all">Tất cả</option></select></label><label>Giá trị đơn từ (₫)<input type="number" name="min" min="0" max="1000000000000" step="1"></label><label>Đến (₫)<input type="number" name="max" min="0" max="1000000000000" step="1"></label><button class="btn secondary" type="submit">Lọc / tìm đơn</button><button class="btn secondary" type="button" data-clear-orders>Bỏ bộ lọc</button></form><div data-order-results aria-live="polite"></div><div data-preview tabindex="-1" role="region" aria-label="Gán khoản thu" aria-live="polite"></div></section>`}
      ${res.history.length ? `<details class="sp-history"><summary>Nhật ký xử lý (${res.history.length})</summary>${res.history.map((h) => `<article><b>${esc(h.actorName || "Hệ thống")}</b> · ${esc(stamp(h.createdAt))}<p>${esc(h.reason || "Kiểm tra lại giao dịch")}</p></article>`).join("")}</details>` : ""}`;
      if ($("[data-order-search]"))
        await searchOrders($("[data-order-search]"));
      if (!valid(own, d)) return;
      root
        .querySelectorAll("[data-row]")
        .forEach((x) =>
          x.classList.toggle("sp-selected", x.dataset.row === id),
        );
      // Loading content is short and may clamp scrolling at the page bottom.
      // Reposition once the full form exists, unless the user has already returned to the list.
      if (document.activeElement === $("[data-detail]"))
        $("[data-detail]").scrollIntoView({
          block: "start",
          behavior: "instant",
        });
    } catch (e) {
      if (valid(own, d))
        $("[data-detail]").innerHTML =
          `${back}<h2>Đối soát giao dịch</h2><p role="alert" class="sp-error">${esc(e.message)}</p>`;
    }
  }
  async function searchOrders(form, offset = 0) {
    clearTimeout(searchTimer);
    if (!event || mutating) return;
    const own = epoch,
      d = detailEpoch,
      s = ++searchEpoch,
      filters = new URLSearchParams();
    for (const [k,v] of new FormData(form)) if (String(v).trim()) filters.set(k === "orderQuery" ? "q" : k, String(v).trim());
    filters.set("offset", String(offset));
    form.querySelector('button[type="submit"]').disabled = true;
    $("[data-order-results]").textContent = "Đang tìm…";
    preview = null; draft = null;
    $("[data-preview]").replaceChildren();
    try {
      const r = await api("/sepay/orders?" + filters);
      if (!valid(own, d) || s !== searchEpoch) return;
      const labels = {draft:"Bản nháp",confirmed:"Đã duyệt",delivering:"Đang giao",delivered:"Đã giao",cancelled:"Đã hủy",signed:"Đã ký",completed:"Hoàn tất"};
      $("[data-order-results]").innerHTML = (r.webOrderScopeMessage?`<p class="sp-warning">${esc(r.webOrderScopeMessage)}</p>`:'')+(r.orders.length
        ? `<ul class="sp-order-results">${r.orders.map((o) => `<li><button type="button" ${o.selectable ? `data-choose="${esc(o.id)}"` : 'disabled'}><b>${esc(o.contractNo || o.orderNo)}</b><span>${esc(o.customerName)} · ${esc(money(o.total))}</span><span>${esc({pos:"POS",web:"Website",crm:"Đơn CRM",contract:"HĐKT"}[o.kind] || "Đơn CRM")} · ${esc(o.orderNo)} · ${esc(o.orderDate.slice(0,10))} · ${esc(labels[o.contractStatus || o.status] || o.status)}</span>${o.selectable ? '<span class="sp-choose-action">Chọn đơn này để gán khoản thu →</span>' : `<span class="sp-choose-action">${o.status === "cancelled" ? "Không thể gán: đơn đã hủy." : "Chưa thể gán: cần duyệt đơn hoặc ký HĐKT."}</span>`}</button></li>`).join("")}</ul>`
        : '<p class="sp-empty">Không có đơn/HĐKT phù hợp. Thử bỏ bộ lọc hoặc tìm theo mã hợp đồng, tên khách không dấu.</p>') +
        `<div class="sp-order-pages"><button type="button" class="btn secondary" data-order-offset="${Math.max(0,r.offset-r.limit)}" ${r.offset===0 ? "disabled" : ""}>← Trước</button><span>Trang ${Math.floor(r.offset/r.limit)+1}</span><button type="button" class="btn secondary" data-order-offset="${r.offset+r.limit}" ${!r.hasMore ? "disabled" : ""}>Sau →</button></div>`;
    } catch (e) {
      if (valid(own, d) && s === searchEpoch)
        $("[data-order-results]").innerHTML =
          `<p class="sp-error" role="alert">${esc(e.message)}</p>`;
    } finally {
      if (valid(own, d) && s === searchEpoch) {
        form.querySelector('button[type="submit"]').disabled = false;

      }
    }
  }
  async function chooseOrder(id) {
    clearTimeout(searchTimer);
    if (!event || mutating) return;
    const own = epoch,
      d = detailEpoch,
      s = ++searchEpoch;
    preview = null;
    draft = null;
    const target = $("[data-preview]");
    target.textContent = "Đang kiểm tra đơn và công nợ trước khi gán khoản thu…";
    root.querySelectorAll("[data-choose]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.choose === id)));
    target.focus({preventScroll:true});
    target.scrollIntoView({block:"start",behavior:"instant"});
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
        `<section class="sp-order-preview"><h3>${link(p.order)}</h3><p>${esc(p.order.customerName)}</p><p class="sp-assignment-amount">Khoản thu sẽ gán: <b>${esc(money(event.amount))}</b></p><dl class="sp-info"><dt>Giá trị đơn</dt><dd>${esc(money(p.order.total))}</dd>${p.expectedAccount ? `<dt>Tài khoản mặc định</dt><dd>${esc(p.expectedAccount)}</dd>` : ""}<dt>Còn phải thu</dt><dd>${esc(money(p.debt.balance))}</dd><dt>Nhân viên đang giữ</dt><dd>${esc(money(p.debt.held))}</dd><dt>Còn có thể thu</dt><dd><b>${esc(money(p.debt.available))}</b></dd></dl>
      ${p.blockReason && p.accountApproved ? `<p class="sp-warning">${esc(p.blockReason)}</p>` : ""}
      ${p.accountApproved && p.manualConflict ? '<p class="sp-warning">Có phiếu chuyển khoản nhập trước cần đối chiếu. Chọn phiếu khớp để gắn giao dịch, không tạo thêm tiền.</p>' : ""}
      ${p.accountApproved && !p.canCreate && !p.existingReceipts.length ? '<p class="sp-warning">Chưa thể tạo phiếu thu mới: kiểm tra công nợ, tài khoản và các khoản đã thu.</p>' : ""}
      ${
        !p.accountApproved
          ? `<p class="sp-warning" id="sepay-account-block-reason" data-account-block>${esc(p.blockReason || "Đã chọn đơn/HĐKT để kiểm tra công nợ. Tài khoản nhận chưa được duyệt nên chưa thể gán khoản thu và ghi nhận thanh toán.")}</p><button class="btn navy" type="button" disabled aria-describedby="sepay-account-block-reason">Gán khoản thu vào đơn này</button><button class="btn secondary" type="button" data-reload-detail>Kiểm tra lại tài khoản</button>`
          : `${p.warning ? `<p class="sp-warning">${esc(p.warning)}</p>` : ""}<form data-approval-form><label>Cách ghi nhận<select name="existingPaymentId"><option value="" ${!p.canCreate ? "disabled" : ""} ${!p.existingReceipts.length ? "selected" : ""}>${p.recordMode === "web-link" ? "Đối soát vào đơn web, không tạo phiếu thu mới" : "Tạo phiếu thu mới"}</option>${p.existingReceipts.map((x, i) => `<option value="${esc(x.id)}" ${i === 0 ? "selected" : ""}>Gắn phiếu ${esc(x.reference || x.id)} · ${esc(money(x.amount))} · ${esc(x.paidAt)}</option>`).join("")}</select></label>
      ${p.moreReceipts ? '<p class="muted small">Hiện tối đa 50 phiếu khớp. Kiểm tra kỹ mã phiếu trước khi chọn.</p>' : ""}
      <label>Lý do đối soát<textarea name="reason" required minlength="10" maxlength="1000" rows="3" placeholder="Ghi căn cứ xác định đúng đơn hoặc phiếu thu (ít nhất 10 ký tự)"></textarea></label><label class="sp-check"><input type="checkbox" name="verified" required><span>Tôi đã đối chiếu giao dịch ngân hàng, đơn và phiếu thu.</span></label><button class="btn navy" type="submit" ${!p.canCreate && !p.existingReceipts.length ? "disabled" : ""}>Xem lại để gán khoản thu</button></form><div data-review tabindex="-1" role="region" aria-label="Xác nhận gán khoản thu"></div>`
      }</section>`;
    } catch (e) {
      if (valid(own, d) && s === searchEpoch)
        $("[data-preview]").innerHTML =
          `<p class="sp-error" role="alert">${esc(e.message)}</p>`;
    } finally {
      // A long result list can put the preview several screens below the chosen row.
      // Reveal the completed result unless the user has moved focus elsewhere.
      if (valid(own,d) && s === searchEpoch && document.activeElement === target)
        target.scrollIntoView({block:"start",behavior:"instant"});
    }
  }
  function prepare(form) {
    if (!event || !preview || !preview.accountApproved || mutating) return;
    const f = new FormData(form);
    draft = {
      orderId: preview.order.id,
      reason: String(f.get("reason") || "").trim(),
      confirmed: true,
    };
    const receipt = String(f.get("existingPaymentId") || "");
    if (receipt) draft.existingPaymentId = receipt;
    $("[data-review]").innerHTML =
      `<section class="sp-review"><h3>Kiểm tra lần cuối</h3><p><b>${esc(money(event.amount))}</b> · TK ${esc(event.accountNumber)} · ${esc(stamp(event.transactionAt))}</p><p>Đơn/HĐKT: <b>${esc(preview.order.contractNo || preview.order.orderNo)}</b> · ${esc(preview.order.customerName)}</p><p>${preview.recordMode === "web-link" ? "Gắn chứng từ ngân hàng với đơn web; không tạo thêm phiếu thu CRM." : receipt ? "Gắn với phiếu thu đã có; không cộng thêm tiền." : "Tạo phiếu thu cho toàn bộ số tiền giao dịch."}</p><p class="sp-original">Lý do: ${esc(draft.reason)}</p><button class="btn navy" type="button" data-confirm>Xác nhận gán khoản thu</button><button class="btn ghost" type="button" data-cancel-review>Quay lại kiểm tra</button></section>`;
    $("[data-review]").focus({preventScroll:true});
    $("[data-review]").scrollIntoView({block:"start",behavior:"instant"});
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
      const next = new URLSearchParams({entity:params.get("entity")||"bach-ngan"});
      for (const [k, v] of new FormData(e.target))
        if (String(v).trim()) next.set(k, String(v).trim());
      navigate(next);
    } else if (e.target.matches("[data-order-search]")) searchOrders(e.target);
    else if (e.target.matches("[data-approval-form]")) prepare(e.target);
  });
  root.addEventListener("input", (e) => {
    const form = e.target.closest("[data-order-search]");
    if (form) {
      clearTimeout(searchTimer);
      searchEpoch++;
      preview = null; draft = null;
      $("[data-preview]")?.replaceChildren();
      $("[data-order-results]").textContent = "Đang tìm…";
      searchTimer = setTimeout(() => { if(active && form.isConnected) searchOrders(form); },250);
    }
    if (e.target.closest("[data-approval-form]")) {
      draft = null;
      $("[data-review]")?.replaceChildren();
    }
  });
  root.addEventListener("change", (e) => {
    const form = e.target.closest("[data-order-search]");
    if (form && e.target.tagName === "SELECT") searchOrders(form);
    if (e.target.closest("[data-approval-form]")) {
      draft = null;
      $("[data-review]")?.replaceChildren();
    }
  });
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !active || mutating) return;
    if(b.hasAttribute('data-entity')){if(listLoading)return;const next=new URLSearchParams(params);next.set('entity',b.dataset.entity);next.delete('offset');next.delete('account');navigate(next);return;}
    if (b.hasAttribute("data-pull")) pullToday();
    if (b.hasAttribute("data-refresh")) load(epoch);
    if (b.hasAttribute("data-back-list")) {
      const target =
        [...root.querySelectorAll("[data-open]")].find(
          (x) => x.dataset.open === selectedId,
        ) || $("[data-list]");
      if (!target.hasAttribute("tabindex") && target.tagName !== "BUTTON")
        target.tabIndex = -1;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "center", behavior: "instant" });
    }
    if (b.hasAttribute("data-clear"))
      navigate(new URLSearchParams({...sepayDefaults(),entity:params.get("entity")||"bach-ngan"}));
    if (b.hasAttribute("data-clear-orders")) { const form = $("[data-order-search]"); form.reset(); searchOrders(form); }
    if (b.hasAttribute("data-order-offset")) searchOrders($("[data-order-search]"),Number(b.dataset.orderOffset));
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
    allocationUi?.close();allocationUi=null;
    active = true;
    const id = ++epoch;
    detailEpoch++;
    clearTimeout(searchTimer);
    searchEpoch++;
    data = null;
    event = null;
    preview = null;
    draft = null;
    params = new URLSearchParams(query);
    if(params.has('allocation')){allocationUi=initSepayAllocations({api,root,go,canOpenOrders});await allocationUi.show(params.get('allocation'));return;}
    const defaults = sepayDefaults();
    for (const k of ["from", "to"])
      if (!params.has(k)) params.set(k, defaults[k]);
    if (!params.has("status")) params.set("status", "all");
    if(!params.has("entity"))params.set("entity","bach-ngan");
    if(!params.has("direction"))params.set("direction","in");
    frame();
    await load(id);
  }
  // Reuse the app's visible/active 30-second pulse; no extra timer or provider call here.
  function refresh() {
    if (
      !active ||
      allocationUi ||
      document.visibilityState === "hidden" ||
      mutating ||
      listLoading ||
      event
    )
      return;
    return load(epoch);
  }
  return { show, close, refresh };
}
