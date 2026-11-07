import { initCenterCampaigns } from "./customer-campaigns.js";
import { vietnamToday } from "./customer-anniversary.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (v) => new Intl.NumberFormat("vi-VN").format(v) + " đ";
const fold = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
const match = (row, q) =>
  fold(
    Object.values(row)
      .filter((v) => typeof v === "string")
      .join(" "),
  ).includes(fold(q.trim()));
export function centerRows(rows, q, status, today = vietnamToday()) {
  return rows
    .filter((a) => match(a, q))
    .filter((a) => {
      if (status === "all") return true;
      if (status === "done") return !!a.nextDoneAt;
      if (a.nextDoneAt || !a.nextAt) return false;
      if (status === "due") return a.nextAt <= today;
      if (status === "today") return a.nextAt === today;
      return status === "overdue" ? a.nextAt < today : a.nextAt > today;
    });
}
export function phoneHref(phone) {
  const value = String(phone ?? "").trim(),
    digits = value.replace(/\D/g, "");
  return /^\+?[\d ().-]{7,30}$/.test(value) && digits.length >= 7
    ? "tel:" + value.replace(/[^+\d]/g, "")
    : null;
}
export function initCustomerCenter({
  root,
  api,
  canCare,
  user,
  openCare,
  toast,
}) {
  let run = 0,
    owner = null,
    selected = "calendar",
    q = "",
    status = "due",
    page = 0,
    activities = [],
    care = null,
    anniversaries = null,
    careError = "",
    annError = "",
    loading = false;
  let campaignUi = null,
    counts = null,
    opportunities = null,
    oppError = "",
    countError = "",
    oppPage = 0,
    month = vietnamToday().slice(0, 7),
    days = 180,
    searchTimer = 0;
  const busy = new Set();
  const shortcuts = [
    ["calendar", "Lịch chăm sóc"],
    ["period", "Khách mua cùng kỳ"],
    ["dormant", "Khách lâu chưa mua"],
    ["anniversary", "Kỷ niệm khách hàng"],
    ["campaign", "Chiến dịch trọng tâm"],
  ];
  const filters = () => new URLSearchParams({ month, days });
  const opportunityKind = () => (selected === "dormant" ? "dormant" : "period");
  const realForm = (customer) =>
    openCare(customer ? { customer } : {}, () => load());
  function render() {
    const active = root.ownerDocument?.activeElement;
    const searchFocused =
      active?.matches?.("[data-center-search]") && root.contains(active);
    const selection = searchFocused
      ? [active.selectionStart, active.selectionEnd]
      : null;
    const allowed = canCare(),
      today = care?.today || vietnamToday(),
      rows = centerRows(activities, q, status, today);
    campaignUi?.destroy();
    campaignUi = null;
    const cards = [
      [
        "Việc đến hạn hôm nay",
        allowed ? (care?.counts.today ?? "—") : "—",
        "calendar",
      ],
      ["Khách mua cùng kỳ", counts?.period ?? "—", "period"],
      ["Khách lâu chưa mua", counts?.dormant ?? "—", "dormant"],
      ["Kỷ niệm sắp tới", anniversaries?.total ?? "—", "anniversary"],
      ["Chiến dịch đang chạy", counts?.campaigns ?? "—", "campaign"],
    ];
    root.innerHTML = `<div class="page-head"><div><span class="eyebrow">Kinh doanh</span><h1>Trung tâm khách hàng</h1><p class="muted">${user()?.name ? `Xin chào, ${esc(user().name)}. ` : ""}Theo dõi lịch hẹn, ghi nhận kết quả và chuẩn bị lần chăm sóc tiếp theo.</p></div><button class="btn primary" data-center-record ${allowed ? "" : "disabled"} ${allowed ? "" : 'title="Chưa được cấp quyền Giao dịch & chăm sóc"'}>＋ Ghi nhận chăm sóc</button></div>
   <div class="center-search" ${selected === "campaign" ? "hidden" : ""}><label>Tìm khách trong các danh sách đang hiển thị<input type="search" data-center-search placeholder="Tên khách, công ty, số điện thoại…" value="${esc(q)}"></label><button class="btn secondary" data-center-reload ${loading ? "disabled" : ""}>${loading ? "Đang tải…" : "Làm mới"}</button></div>
   <div class="center-stats">${cards.map(([label, value, key]) => `<button class="stat" data-center-section="${key}" aria-pressed="${selected === key}"><small>${label}</small><strong>${value}</strong>${`<span class="muted small">${key === "calendar" ? (allowed ? "Theo phạm vi API chăm sóc" : "Chưa có quyền chăm sóc") : "Theo phạm vi khách được xem"}</span>`}</button>`).join("")}</div>
   ${countError ? `<p class="error" role="alert">${esc(countError)}</p>` : ""}
   <div class="center-filters"><label>Cùng kỳ của tháng<input type="month" data-center-month value="${esc(month)}"></label><label>Lâu chưa mua (ngày)<input type="number" data-center-days min="1" max="3650" value="${days}"></label></div>
   <nav class="center-shortcuts" aria-label="Nội dung trung tâm khách hàng">${shortcuts.map(([key, label]) => `<button class="chip ${selected === key ? "active" : ""}" data-center-section="${key}" aria-pressed="${selected === key}">${label}</button>`).join("")}</nav>
   <div class="center-columns" style="grid-template-columns:${selected === "calendar" ? "" : "minmax(0,1fr)"}"><section class="card center-reminders" ${selected === "calendar" ? "" : "hidden"} aria-labelledby="center-reminders-title"><h2 id="center-reminders-title">Nhắc việc hôm nay</h2><p class="muted small">Bao gồm lịch quá hạn. Bộ lọc áp dụng trên trang đang hiển thị; số tổng hôm nay ở thẻ trên do máy chủ trả về. Hẹn hiện có ngày, chưa có giờ hẹn.</p>
    <label class="center-status">Trạng thái<select data-center-status>${[
      ["due", "Đến hạn / quá hạn"],
      ["today", "Hôm nay"],
      ["overdue", "Quá hạn"],
      ["upcoming", "Sắp tới"],
      ["done", "Đã hoàn tất trên trang này"],
      ["all", "Tất cả trên trang này"],
    ]
      .map(
        ([v, t]) =>
          `<option value="${v}" ${v === status ? "selected" : ""}>${t}</option>`,
      )
      .join("")}</select></label>
    ${
      !allowed
        ? '<p class="empty">Chưa được cấp quyền xem Giao dịch & chăm sóc.</p>'
        : loading
          ? '<p role="status">Đang tải lịch chăm sóc…</p>'
          : careError
            ? `<p class="error" role="alert">${esc(careError)}</p><button class="btn secondary" data-center-reload>Thử lại</button>`
            : rows.length
              ? `<div class="center-list">${rows
                  .map((a) => {
                    const href = phoneHref(a.customerPhone),
                      done = !!a.nextDoneAt;
                    return `<article class="center-item"><div><a class="center-name" href="#/customers/${encodeURIComponent(a.customerId)}">${esc(a.customerName)}</a><p>${esc(a.contactName || "Chưa có người liên hệ")}</p><p class="muted">${esc(a.nextAction || a.subject || a.content || "Chăm sóc theo lịch hẹn")}</p><p class="muted small">Hẹn ${esc(a.nextAt)} · ${esc(a.ownerName)} · Chưa có giờ hẹn</p><span class="pill ${done ? "ok" : a.nextAt < today ? "danger" : "info"}">${done ? "Đã hoàn tất" : a.nextAt < today ? "Quá hạn" : a.nextAt === today ? "Hôm nay" : "Sắp tới"}</span></div><div class="center-actions">${href ? `<a class="btn secondary" href="${esc(href)}">Gọi</a>` : '<button class="btn secondary" disabled>Chưa có SĐT</button>'}<button class="btn secondary" data-center-contact="${esc(a.id)}">Ghi nhận</button><button class="btn primary" data-center-done="${esc(a.id)}" ${!a.canEdit || done || busy.has(a.id) ? "disabled" : ""}>${busy.has(a.id) ? "Đang lưu…" : done ? "Đã hoàn tất" : "Hoàn tất"}</button></div></article>`;
                  })
                  .join("")}</div>`
              : '<p class="empty">Không có lịch phù hợp trên trang này. Có thể đổi bộ lọc hoặc chuyển trang.</p>'
    }
    ${allowed && !careError ? `<div class="center-pager"><button class="btn secondary" data-center-page="-1" ${!page || loading ? "disabled" : ""}>Trang trước</button><span>Trang ${page + 1} · ${care?.total ?? 0} lịch hẹn chưa hoàn tất</span><button class="btn secondary" data-center-page="1" ${loading || !care || (page + 1) * 100 >= care.total ? "disabled" : ""}>Trang sau</button></div>` : ""}
   </section>
   <section class="card" ${["calendar", "period", "dormant"].includes(selected) ? "" : "hidden"} aria-labelledby="center-opportunities-title"><h2 id="center-opportunities-title">${opportunityKind() === "dormant" ? "Khách lâu chưa mua" : "Khách mua cùng kỳ"}</h2><p class="muted small">${opportunityKind() === "dormant" ? `Lần mua gần nhất cách ít nhất ${days} ngày. Khách chưa từng mua không nằm trong danh sách này.` : `Đã mua trong tháng ${esc(month.slice(5))}/${Number(month.slice(0, 4)) - 1}.`} Chỉ tính đơn đã xác nhận hoặc HĐKT đã ký, bỏ đơn huỷ. Giá trị đơn gồm VAT, chưa trừ hàng trả; xem hồ sơ để đối chiếu công nợ.</p>
   ${loading ? '<p role="status">Đang tải lịch sử mua…</p>' : oppError ? `<p class="error" role="alert">${esc(oppError)}</p><button class="btn secondary" data-center-reload>Thử lại</button>` : (opportunities?.customers || []).map((a) => `<article class="center-item"><a class="center-name" href="#/customers/${encodeURIComponent(a.id)}">${esc(a.name)}</a><p>${esc(a.contact || "Chưa có người liên hệ")}</p><p class="muted small">Mua gần nhất ${esc(a.lastOrderDate)} · ${a.lastValue === null ? "Chưa có giá trị" : money(a.lastValue)}</p><p>${esc(a.products)}</p>${opportunityKind() === "period" ? `<p>${a.periodOrders} đơn trong cùng kỳ · ${money(a.periodValue)}</p>` : ""}<div class="center-actions">${phoneHref(a.phone) ? `<a class="btn secondary" href="${esc(phoneHref(a.phone))}">Gọi</a>` : '<span class="muted">Chưa có SĐT</span>'}<a class="btn secondary" href="#/customers/${encodeURIComponent(a.id)}">Hồ sơ khách</a><button class="btn primary" data-center-opportunity="${esc(a.id)}" ${allowed ? "" : "disabled"}>Ghi nhận / hẹn lại</button></div></article>`).join("") || '<p class="empty">Chưa có khách phù hợp từ lịch sử đơn trên CRM.</p>'}
   <div class="center-pager"><button class="btn secondary" data-center-opage="-1" ${loading || !oppPage ? "disabled" : ""}>Trang trước</button><span>Trang ${oppPage + 1} · ${opportunities?.total ?? 0} khách</span><button class="btn secondary" data-center-opage="1" ${loading || (oppPage + 1) * 20 >= (opportunities?.total ?? 0) ? "disabled" : ""}>Trang sau</button></div></section>
   </div>
   <section class="card center-anniversaries" ${selected === "anniversary" ? "" : "hidden"}><h2>Kỷ niệm khách hàng</h2><p class="muted small">Mốc 5, 10, 15… năm, chuẩn bị trước 60 ngày. Tổng: ${anniversaries?.total ?? "—"} khách; hiển thị tối đa 100.</p>${
     loading
       ? '<p role="status">Đang tải kỷ niệm…</p>'
       : annError
         ? `<p class="error" role="alert">${esc(annError)}</p><button class="btn secondary" data-center-reload>Thử lại</button>`
         : (anniversaries?.reminders || [])
             .filter((a) => match(a, q))
             .map(
               (a) =>
                 `<article class="center-item"><div><a class="center-name" href="#/customers/${encodeURIComponent(a.id)}">${esc(a.name)}</a><p>${esc(a.contact)} · ${esc(a.anniversary.years)} năm vào ${esc(a.anniversary.date)}</p><p class="muted">${esc(a.anniversary.suggestion)}</p></div><button class="btn secondary" data-center-anniversary="${esc(a.id)}" ${allowed ? "" : "disabled"}>Ghi nhận chăm sóc</button></article>`,
             )
             .join("") || '<p class="empty">Chưa có kỷ niệm phù hợp.</p>'
   }</section>
   <section class="card" data-center-campaigns ${selected === "campaign" ? "" : "hidden"}></section>
   <p class="center-feedback muted" data-center-feedback role="status"></p>`;
    if (searchFocused) {
      const input = root.querySelector("[data-center-search]");
      input?.focus({ preventScroll: true });
      input?.setSelectionRange(...selection);
    }
    if (selected === "campaign" && !loading) {
      campaignUi = initCenterCampaigns({
        root: root.querySelector("[data-center-campaigns]"),
        api,
        user,
        canCare,
        openCare,
        toast,
        phoneHref,
        onChange: refreshCounts,
      });
      campaignUi.load();
    }
  }
  async function refreshCounts() {
    const current = run;
    try {
      const d = await api("/customers/center/counts?" + filters());
      if (current !== run || owner !== user()?.id) return;
      counts = d;
      const value = root.querySelector(
        '.center-stats [data-center-section="campaign"] strong',
      );
      if (value) value.textContent = d.campaigns;
    } catch (ex) {
      if (current === run) toast(ex.message, "err");
    }
  }
  async function load() {
    const id = user()?.id;
    if (id !== owner) {
      owner = id;
      q = "";
      page = 0;
      activities = [];
      busy.clear();
      counts = null;
      opportunities = null;
      selected = "calendar";
    }
    const current = ++run;
    loading = true;
    care = null;
    anniversaries = null;
    careError = "";
    annError = "";
    countError = "";
    oppError = "";
    counts = null;
    opportunities = null;
    render();
    const results = await Promise.allSettled([
      canCare()
        ? api(`/care?view=follow-ups&limit=100&offset=${page * 100}`)
        : Promise.resolve(null),
      api("/customers/anniversaries"),
      api("/customers/center/counts?" + filters()),
      ["calendar", "period", "dormant"].includes(selected)
        ? api(
            "/customers/center/opportunities?" +
              filters() +
              "&" +
              new URLSearchParams({
                kind: opportunityKind(),
                q,
                limit: 20,
                offset: oppPage * 20,
              }),
          )
        : Promise.resolve(null),
    ]);
    if (current !== run || id !== user()?.id) return;
    if (results[0].status === "fulfilled") {
      const data = results[0].value;
      care = data ? { ...data, counts: { ...data.counts } } : null;
      activities = (data?.activities || []).map((a) => ({ ...a }));
    } else {
      activities = [];
      careError = results[0].reason.message || "Không tải được lịch hẹn.";
    }
    if (results[1].status === "fulfilled") anniversaries = results[1].value;
    else annError = results[1].reason.message || "Không tải được kỷ niệm.";
    if (results[2].status === "fulfilled") counts = results[2].value;
    else countError = results[2].reason.message || "Không tải được thống kê.";
    if (results[3].status === "fulfilled") opportunities = results[3].value;
    else oppError = results[3].reason.message || "Không tải được lịch sử mua.";
    loading = false;
    render();
  }
  const search = (e) => {
    if (e.isComposing || !e.target.matches("[data-center-search]")) return;
    q = e.target.value;
    oppPage = 0;
    clearTimeout(searchTimer);
    if (["calendar", "period", "dormant"].includes(selected)) {
      searchTimer = setTimeout(load, 350);
      return;
    }
    const start = e.target.selectionStart;
    render();
    const input = root.querySelector("[data-center-search]");
    input.focus();
    input.setSelectionRange(start, start);
  };
  root.addEventListener("input", search);
  root.addEventListener("compositionend", search);
  root.addEventListener("change", (e) => {
    if (e.target.matches("[data-center-month]")) {
      month = e.target.value;
      oppPage = 0;
      return load();
    }
    if (e.target.matches("[data-center-days]")) {
      days = Number(e.target.value);
      oppPage = 0;
      return load();
    }
    if (e.target.matches("[data-center-status]")) {
      status = e.target.value;
      render();
      root.querySelector("[data-center-status]").focus();
    }
  });
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.hasAttribute("data-center-section")) {
      selected = b.dataset.centerSection;
      oppPage = 0;
      return load();
    }
    if (b.hasAttribute("data-center-reload")) return load();
    if (b.hasAttribute("data-center-record") && canCare()) return realForm();
    if (b.hasAttribute("data-center-page")) {
      page = Math.max(0, page + Number(b.dataset.centerPage));
      return load();
    }
    if (b.hasAttribute("data-center-opage")) {
      oppPage = Math.max(0, oppPage + Number(b.dataset.centerOpage));
      return load();
    }
    if (b.hasAttribute("data-center-opportunity") && canCare()) {
      const row = opportunities?.customers.find(
        (a) => a.id === b.dataset.centerOpportunity,
      );
      if (row) return realForm(row);
    }
    const a = activities.find(
      (a) => a.id === (b.dataset.centerDone || b.dataset.centerContact),
    );
    if (b.hasAttribute("data-center-contact") && a && canCare())
      return realForm({
        id: a.customerId,
        name: a.customerName,
        contact: a.contactName,
      });
    if (b.hasAttribute("data-center-anniversary") && canCare()) {
      const a = anniversaries?.reminders.find(
        (a) => a.id === b.dataset.centerAnniversary,
      );
      if (a) return realForm(a);
    }
    if (
      b.hasAttribute("data-center-done") &&
      a?.canEdit &&
      !a.nextDoneAt &&
      !busy.has(a.id) &&
      canCare()
    ) {
      const current = run;
      busy.add(a.id);
      render();
      try {
        const d = await api(`/care/${encodeURIComponent(a.id)}/done`, "POST", {
          revision: a.revision,
          nextAt: a.nextAt,
        });
        if (current !== run || owner !== user()?.id) return;
        Object.assign(a, d.activity);
        if (care) {
          care.total = Math.max(0, care.total - 1);
          if (a.nextAt === care.today)
            care.counts.today = Math.max(0, care.counts.today - 1);
        }
        status = "all";
        toast(
          "Đã đánh dấu lịch hẹn hoàn tất. Ghi nhận giao dịch mới nếu cần lưu kết quả trao đổi.",
        );
      } catch (ex) {
        if (current === run) toast(ex.message, "err");
      } finally {
        busy.delete(a.id);
        if (current === run && owner === user()?.id) render();
      }
    }
  });
  return {
    load,
    invalidate() {
      run++;
      clearTimeout(searchTimer);
      campaignUi?.destroy();
    },
  };
}
