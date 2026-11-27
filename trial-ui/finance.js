import {
  financeDefaults,
  financeRange,
  financeMetrics,
  financeKpiProgress,
} from "./finance-model.js";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const amount = (n) =>
  Number.isFinite(n)
    ? new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(n) +
      " ₫"
    : "Chưa đủ dữ liệu";
const number = (n) =>
  Number.isFinite(n)
    ? new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n)
    : "Chưa nhập";
const percent = (n) =>
  Number.isFinite(n) ? number(n * 100) + "%" : "Chưa đủ dữ liệu";
const stamp = (d) =>
  d?.cache?.computedAt
    ? `Bản tính lúc ${new Date(d.cache.computedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} (giờ Việt Nam)${d.cache.hit ? " · bản tính sẵn" : ""}`
    : "";
const metric = (label, value, note = "", tone = "") =>
  `<div class="fn-metric ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`;
export function initFinance({ api, root, go }) {
  if (!document.getElementById("finance-style")) {
    const style = document.createElement("link");
    style.id = "finance-style";
    style.rel = "stylesheet";
    style.href = new URL("./finance.css", import.meta.url).href;
    document.head.append(style);
  }
  let epoch = 0,
    active = false,
    queue = Promise.resolve(),
    filters = null,
    branches = [],
    kpi = null,
    forceRefresh = false,
    filtersReady = false;
  const $ = (s) => root.querySelector(s),
    valid = (id) => active && id === epoch;
  function close() {
    active = false;
    epoch++;
    root.replaceChildren();
    filters = null;
    kpi = null;
  }
  function busy(value) {
    root.setAttribute("aria-busy", String(value));
    root
      .querySelectorAll("button,input,select")
      .forEach((el) => (el.disabled = value));
  }
  function run(id, job) {
    busy(true);
    queue = queue
      .catch(() => {})
      .then(async () => {
        if (!valid(id)) return;
        try {
          await job();
        } finally {
          if (valid(id)) {
            busy(false);
            if (!filtersReady) {
              $("[data-profit]").disabled = true;
              $("[data-kpi]").disabled = true;
            }
          }
        }
      });
    return queue;
  }
  function fail(slot, e) {
    slot.innerHTML = `<p role="alert" class="fn-error">Không tải được số liệu: ${esc(e.message)}. Bấm “Làm mới số liệu” để thử lại.</p>`;
  }
  function frame() {
    root.classList.add("finance-page");
    root.innerHTML = `<div class="page-head"><div><p class="eyebrow">DÀNH CHO MANAGER</p><h1>Tài chính &amp; KPI</h1><p class="muted">Dữ liệu CRM · Tiền thu/chi, lợi nhuận và tiến độ mục tiêu.</p><p class="muted small">Chỉ tổng hợp chứng từ đã ghi vào sổ CRM. Đơn web chưa chuyển thành đơn CRM chưa được tính.</p></div><a class="btn" href="#/profit">Phân tích lợi nhuận →</a></div>
    <form class="card fn-filters"><label>Từ ngày<input name="from" type="date" required value="${esc(filters.from)}"></label><label>Đến ngày<input name="to" type="date" required value="${esc(filters.to)}"></label><label>Chi nhánh<select name="branch"><option value="">Toàn công ty</option></select></label><button class="btn navy" type="submit">Xem báo cáo</button><button class="btn" type="button" data-refresh>Làm mới số liệu</button><p class="fn-filter-error" role="alert"></p></form>
    <p class="fn-scope muted"></p>
    <section class="card fn-profit"><div class="fn-heading"><div><h2>Kết quả tài chính</h2><p>Doanh thu theo ngày đơn; chưa VAT, đã trừ hàng trả có hiệu lực công nợ.</p></div><button class="btn navy" type="button" data-profit>Tính lợi nhuận</button></div><div data-profit-content><p class="muted">Bấm “Tính lợi nhuận” để dùng cùng nguồn tính với trang Phân tích lợi nhuận. Phép tính này không tự chạy nền.</p></div></section>
    <div class="fn-grid"><section class="card"><h2>Dòng tiền trong kỳ</h2><p>Thu và chi đã ghi nhận, theo ngày chứng từ; không phải doanh thu và chi phí.</p><div data-flow><p role="status">Đang tải dòng tiền…</p></div></section>
    <section class="card"><h2>Công nợ hiện tại</h2><p>Không phải số dư cuối kỳ quá khứ. Số đã thu và hàng trả theo quy tắc Công nợ hiện hành.</p><div data-debt><p role="status">Đang chờ tải công nợ…</p></div></section>
    <section class="card"><h2>Điểm hòa vốn &amp; hiệu quả thu tiền</h2><dl class="fn-explain"><div><dt>Điểm hòa vốn</dt><dd>Chưa đủ dữ liệu định phí và tỷ lệ số dư đảm phí đã xác nhận.</dd></div><div><dt>DSO · Số ngày thu tiền bình quân</dt><dd>Chưa có dư phải thu bình quân và doanh thu bán chịu cùng kỳ.</dd></div><div><dt>Vốn lưu động</dt><dd>Chưa đủ tài sản ngắn hạn và nợ ngắn hạn.</dd></div></dl><span class="fn-tag">Chưa đủ dữ liệu để tính</span></section>
    <section class="card fn-kpi"><div class="fn-heading"><div><h2>KPI nhân viên Sale</h2><p>Giữ nguyên chỉ tiêu, trọng số và điểm trên bảng lương.</p></div></div><div class="fn-kpi-controls"><label>Tháng KPI<input type="month" name="kpiMonth" required value="${esc(filters.to.slice(0, 7))}"></label><button class="btn" type="button" data-kpi>Xem KPI</button></div><p class="fn-note">KPI theo tháng và từng nhân viên toàn công ty; bộ lọc chi nhánh phía trên không phân bổ KPI.</p><div data-kpi-content><p class="muted">Chỉ tải khi bấm “Xem KPI”.</p></div></section></div>
    <footer class="fn-foot">Đơn vị: VND · Ngày và giờ theo Việt Nam · Các phần có thời điểm tính riêng, không phải báo cáo kế toán đã kiểm toán.</footer>`;
    $(".fn-filters").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = new FormData(e.currentTarget),
        from = String(form.get("from")),
        to = String(form.get("to")),
        branch = String(form.get("branch"));
      if (!financeRange(from, to)) {
        $(".fn-filter-error").textContent =
          "Chọn khoảng ngày hợp lệ, tối đa 366 ngày.";
        return;
      }
      if (branch && !branches.some((b) => b.id === branch)) {
        $(".fn-filter-error").textContent = "Chi nhánh không hợp lệ.";
        return;
      }
      const q = new URLSearchParams({
        from,
        to,
        ...(branch ? { branch } : {}),
      });
      const hash = "#/finance?" + q;
      if (location.hash === hash) show(q.toString());
      else go(hash);
    });
    $("[data-refresh]").onclick = () =>
      show(new URLSearchParams(filters).toString(), true);
    $("[data-profit]").onclick = () => loadProfit(epoch);
    $("[data-kpi]").onclick = () => loadKpi(epoch);
  }
  function renderFlow(d) {
    const f = d.flow;
    $("[data-flow]").innerHTML =
      `<div class="fn-trio">${metric("Tiền vào", amount(f.in), "Khách trả + thu khác", "positive")}${metric("Tiền ra", f.unlinkedOut ? "Cần đối chiếu" : amount(f.out), "Trả NCC + hoàn khách + chi quỹ", "outgoing")}${metric("Dòng tiền thuần", f.unlinkedOut ? "Cần đối chiếu" : amount(f.net), "Tiền vào − tiền ra", f.unlinkedOut ? "" : f.net >= 0 ? "positive" : "outgoing")}</div>
    <details><summary>Theo phương thức và đối chiếu</summary><dl class="fn-explain">${f.byMethod.map((m) => `<div><dt>${esc({ cash: "Tiền mặt", transfer: "Chuyển khoản" }[m.method] || m.method)}</dt><dd>Thu ${amount(m.in)} · Chi ${amount(m.out)}</dd></div>`).join("")}<div><dt>Chuyển quỹ nội bộ (loại khỏi thu/chi)</dt><dd>Vào ${amount(f.transfersIn)} · Ra ${amount(f.transfersOut)}</dd></div><div><dt>Điều chỉnh sổ quỹ (loại khỏi thu/chi)</dt><dd>${amount(f.adjustments)}</dd></div></dl></details>${f.unlinkedOut ? `<p class="fn-note">Có ${amount(f.unlinkedOut)} phiếu chi thủ công trả NCC / hoàn khách chưa có liên kết đối chiếu. Tổng chứng từ ghi chi ${amount(f.out)} có thể trùng; chưa hiển thị tổng tiền ra và dòng tiền thuần cho đến khi đối chiếu.</p>` : ""}
    ${f.unassignedIn || f.unassignedOut ? `<p class="fn-note">Chưa gán chi nhánh: thu ${amount(f.unassignedIn)}, chi ${amount(f.unassignedOut)} (trả NCC ${amount(f.unassignedSupplier)}). ${filters.branch ? "Không cộng vào chi nhánh đang chọn." : "Đã cộng vào tổng công ty."}</p>` : ""}
    ${f.classificationReview ? `<p class="fn-note">${number(f.classificationReview)} phiếu quỹ cũ phân loại theo nội dung, cần đối chiếu tại Phân tích lợi nhuận.</p>` : ""}
    ${f.carrierCollected || f.otherReceipts || f.otherSupplier ? `<p class="fn-note">Không cộng vào thu/chi tiền đã xác định: GHN đã thu COD ${amount(f.carrierCollected)} (số khách đã trả cho GHN; tiền về ngân hàng xem riêng bên dưới); phiếu thu phương thức khác ${amount(f.otherReceipts)}; trả NCC phương thức khác ${amount(f.otherSupplier)}. Trả NCC chưa phân bổ theo chi nhánh.</p>` : ""}
    ${f.ghnSettled ? `<section data-ghn-settled><h3>GHN thực chuyển về ngân hàng (đã đối soát SePay)</h3><div class="fn-trio">${metric("Tiền ngân hàng thực nhận",amount(f.ghnSettled.bankNet),`${f.ghnSettled.transactions} giao dịch · ${f.ghnSettled.allocations} phân bổ`)}${metric("Phí GHN đã xác nhận",amount(f.ghnSettled.confirmedFee),`COD đối chiếu ${amount(f.ghnSettled.cod)}`)}${metric("Chênh lệch GHN sau phí",(f.ghnSettled.difference>0?"+":"")+amount(f.ghnSettled.difference),`Thiếu ${amount(f.ghnSettled.shortfall)} · Dư ${amount(f.ghnSettled.surplus)}`)}</div><p class="fn-note">Theo ngày giao dịch ngân hàng, chỉ phân bổ còn hiệu lực; số GHN cập nhật mỗi lần tải báo cáo. Chênh lệch = tiền ngân hàng + phí xác nhận − COD. Thiếu và dư theo dõi riêng, không tự bù. Trình bày riêng, chưa cộng vào Tiền vào / Dòng tiền thuần ở trên; không thay thu khách hoặc số két. Không bao gồm khoản GHN nhận qua nguồn khác chưa liên kết SePay.</p>${f.ghnSettled.needsReview?`<p class="fn-note">${f.ghnSettled.needsReview} phân bổ cần kiểm tra lại chứng từ/tài khoản, chưa cộng vào số GHN đã đối soát.</p>`:""}</section>` : ""}
    <p class="muted small">Chi nhánh theo nơi phát sinh đơn hoặc ca quỹ. Chưa đối chiếu tự động các phiếu chi thủ công trùng chứng từ trả NCC ngoài liên kết có sẵn.</p>
    <p class="fn-note">Số dư cuối kỳ: chưa đủ số dư đầu kỳ đã xác nhận. Dòng tiền thuần không phải số dư quỹ.</p><p class="fn-stamp">${esc(stamp(d))}</p>`;
  }
  function renderDebt(d) {
    const t = d.totals;
    $("[data-debt]").innerHTML =
      `<div class="fn-pair">${metric("Còn phải thu", amount(t.balance), number(t.orders) + " đơn có dư phải thu")}${metric("Đã quá hạn", amount(t.overdue), "Theo lịch thu tiền", "outgoing")}</div><dl class="fn-explain"><div><dt>Quá hạn 1–30 ngày</dt><dd>${amount(t.d30)}</dd></div><div><dt>Quá hạn 31–60 ngày</dt><dd>${amount(t.d60)}</dd></div><div><dt>Quá hạn trên 60 ngày</dt><dd>${amount(t.over60)}</dd></div></dl><a href="#/receivables">Xem chi tiết Công nợ →</a><p class="fn-stamp">Ngày đối chiếu ${esc(d.today)} · ${esc(stamp(d))}</p>`;
  }
  async function loadProfit(id) {
    return run(id, async () => {
      const slot = $("[data-profit-content]");
      slot.innerHTML =
        '<p role="status">Đang tính từ nguồn lợi nhuận hiện hành…</p>';
      try {
        const d = await api(
          "/profit?" +
            new URLSearchParams({
              ...filters,
              grain: "month",
              compare: "0",
              view: "overview",
              ...(forceRefresh ? { refresh: "1" } : {}),
            }),
        );
        if (!valid(id)) return;
        const m = financeMetrics(d, filters.branch);
        slot.innerHTML = `<div class="fn-four">${metric("Doanh thu thuần", amount(m.revenue), "Tiền hàng chưa VAT")}${metric("Chi phí đã ghi nhận", amount(m.cost), "Trên doanh thu đủ giá vốn")}${metric("Lợi nhuận tạm tính", amount(m.net), "Sau chi phí đã ghi nhận", m.net === null ? "" : m.net >= 0 ? "positive" : "outgoing")}${metric("Biên tạm tính", percent(m.margin), "Trên doanh thu đủ giá vốn + thu phí")}</div>
      ${m.warnings.length ? `<p class="fn-note">${esc(m.warnings.join(" "))} Chưa hiển thị tổng chi phí, lợi nhuận và biên để tránh coi chi phí thiếu là 0.</p>` : ""}<ul class="fn-notes">${m.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul><p class="muted small">Thu phí khách: ${amount(d.summary.feeRevenue)} · Doanh thu đủ giá vốn: ${amount(d.summary.coveredRevenue)} / ${amount(d.summary.revenue)}. Giá vốn ước tính / tính lại: ${amount(d.summary.revenueBy.estimate + d.summary.revenueBy.backfill)} doanh thu liên quan. Chưa phải lãi ròng kế toán.</p><p class="fn-stamp">${esc(stamp(d))} · <a href="#/profit">Xem nguồn và đối soát →</a></p>`;
      } catch (e) {
        if (valid(id)) fail(slot, e);
      }
    });
  }
  function renderKpiMember() {
    const m = kpi.members.find((m) => m.id === $("[name=kpiMember]").value),
      slot = $("[data-kpi-member]");
    if (!m) {
      slot.textContent = "Không có nhân viên bật KPI trong tháng này.";
      return;
    }
    slot.innerHTML = `<div class="fn-pair">${metric("Tổng điểm thực tế", percent(m.total), "Theo từng phần KPI")}${metric("KPI dùng tính thưởng", percent(m.used), m.adjustedBy === "fixed" ? "KPI cố định" : m.adjustedBy === "override" ? "KPI đã điều chỉnh" : "Theo điểm thực tế")}</div><p class="fn-note">${esc({ estimate: "Phiếu tạm tính", confirmed: "Theo phiếu đã chốt", paid: "Theo phiếu đã thanh toán" }[m.status] || m.status)} · Nguồn ${m.source === "crm" ? "CRM" : "nhập tay"} · Tỷ lệ thưởng KPI ${percent(m.bonusRate)} (không phải số tiền thưởng).</p>
    <div class="fn-kpi-parts">${m.parts
      .map((p) => {
        const v = financeKpiProgress(p);
        return `<div><div class="fn-heading"><strong>${esc(p.label)}</strong><span>${percent(v)}</span></div><p>Thực tế ${number(p.actual)}${p.extra ? " + quy đổi " + number(p.extra) : ""} / ${number(p.target)} · Chỉ tiêu ${p.own ? "riêng" : "chung"}</p><progress max="100" value="${v === null ? 0 : Math.max(0, Math.min(100, v * 100))}" aria-label="${esc(p.label)}"></progress><small>Điểm KPI: ${percent(p.points)}${p.max === null ? "" : " · tối đa " + percent(p.max)}</small></div>`;
      })
      .join("")}</div>`;
  }
  async function loadKpi(id) {
    const month = $("[name=kpiMonth]").value;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return;
    return run(id, async () => {
      const slot = $("[data-kpi-content]");
      slot.innerHTML = '<p role="status">Đang lấy KPI theo bảng lương…</p>';
      try {
        const d = await api(
          "/dashboard/kpi?" +
            new URLSearchParams({
              from: month,
              to: month,
              month,
              ...(forceRefresh ? { refresh: "1" } : {}),
            }),
        );
        if (!valid(id)) return;
        kpi = d;
        if (!d.available) {
          slot.innerHTML =
            '<p class="fn-note">Nguồn KPI hiện chưa khả dụng.</p>';
          return;
        }
        slot.innerHTML = `<label>Nhân viên<select name="kpiMember">${d.members.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("")}</select></label><div data-kpi-member></div><p class="fn-stamp">Tháng ${esc(d.month)} · ${esc(stamp(d))}</p>`;
        $("[name=kpiMember]").onchange = renderKpiMember;
        renderKpiMember();
      } catch (e) {
        if (valid(id)) fail(slot, e);
      }
    });
  }
  async function show(query = "", fresh = false) {
    close();
    active = true;
    const id = epoch,
      params = new URLSearchParams(query),
      defaults = financeDefaults();
    filters = {
      from: params.get("from") || defaults.from,
      to: params.get("to") || defaults.to,
      branch: params.get("branch") || "",
    };
    forceRefresh = fresh;
    filtersReady = false;
    frame();
    if (!financeRange(filters.from, filters.to)) {
      $(".fn-filter-error").textContent =
        "Khoảng ngày không hợp lệ, tối đa 366 ngày. Sửa bộ lọc rồi bấm Xem báo cáo.";
      $("[data-flow]").textContent = "Chưa tính.";
      $("[data-debt]").textContent = "Chưa tính.";
      $("[data-profit]").disabled = true;
      $("[data-kpi]").disabled = true;
      return;
    }
    await run(id, async () => {
      try {
        const options = await api("/finance/options");
        if (!valid(id)) return;
        branches = options.branches;
        const select = $("[name=branch]");
        select.innerHTML =
          '<option value="">Toàn công ty</option>' +
          branches
            .map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`)
            .join("");
        select.value = filters.branch;
        if (filters.branch && !branches.some((b) => b.id === filters.branch))
          throw new Error("Chi nhánh không tồn tại");
        filtersReady = true;
        $(".fn-scope").textContent =
          `Kỳ ${filters.from} → ${filters.to} · ${branches.find((b) => b.id === filters.branch)?.name || "Toàn công ty"}`;
      } catch (e) {
        if (valid(id)) {
          fail($("[data-flow]"), e);
          $("[data-debt]").textContent =
            "Chưa tính do bộ lọc chưa được xác minh.";
        }
        return;
      }
      for (const [path, selector, render] of [
        ["/finance/cashflow", "[data-flow]", renderFlow],
        ["/finance/receivables", "[data-debt]", renderDebt],
      ]) {
        if (!valid(id)) return;
        try {
          const q = new URLSearchParams({
              from: filters.from,
              to: filters.to,
              branch: filters.branch,
              ...(fresh ? { refresh: "1" } : {}),
            }),
            d = await api(path + "?" + q);
          if (valid(id)) render(d);
        } catch (e) {
          if (valid(id)) fail($(selector), e);
        }
      }
    });
  }
  return { show, close };
}
