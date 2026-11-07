import { renderShiftReport } from "./shift-report-view.js";
import { printPos } from "./pos-print.js";

const el = (tag, cls = "", text) => {
  const n = document.createElement(tag);
  n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
};
const money = (n) => Number(n || 0).toLocaleString("vi-VN") + " đ";
const when = (value) =>
  value
    ? new Date(value).toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "—";
const dayLabel = (value) => value?.split("-").reverse().join("/") || "—";
export function reportPeriod(
  kind,
  today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10),
) {
  const d = new Date(today + "T00:00:00Z"),
    iso = (x) => x.toISOString().slice(0, 10);
  if (kind === "today") return { from: today, to: today };
  if (kind === "week")
    return { from: iso(new Date(d.valueOf() - 6 * 86400000)), to: today };
  if (kind === "previous")
    return {
      from: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))),
      to: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0))),
    };
  return { from: today.slice(0, 7) + "-01", to: today };
}
export function reportTotals(s) {
  return {
    netRevenue: Number(s.revenue || 0) - Number(s.returnCredit || 0),
    received: Number(s.cash || 0) + Number(s.transfer || 0),
    refunded: Number(s.refundCash || 0) + Number(s.refundTransfer || 0),
  };
}

export function initShiftReports({ api, root, go }) {
  let run = 0;
  const link = (params) =>
    "#/shift-reports" + (params.toString() ? "?" + params : "");
  const button = (text, fn, cls = "btn secondary") => {
    const b = el("button", cls, text);
    b.type = "button";
    b.dataset.mobileNavigation = "";
    b.onclick = fn;
    return b;
  };
  function header(subtitle) {
    const head = el("header", "page-head"),
      titles = el("div");
    titles.append(
      el("p", "eyebrow", "CÔNG VIỆC & BÁO CÁO"),
      el("h1", "", "Báo cáo ca"),
      el("p", "muted", subtitle),
    );
    head.append(titles);
    root.append(head);
    return head;
  }
  function visit(params) {
    const hash = link(params);
    if (location.hash === hash) void show(params.toString());
    else go(hash);
  }
  function navigate(params, patch) {
    const next = new URLSearchParams(params);
    next.delete("shiftId");
    next.delete("page");
    for (const [key, value] of Object.entries(patch))
      value ? next.set(key, value) : next.delete(key);
    visit(next);
  }
  function select(label, name, options, value) {
    const box = el("label"),
      input = el("select");
    input.name = name;
    input.setAttribute("aria-label", label);
    for (const [v, t] of options) {
      const o = el("option", "", t);
      o.value = v;
      input.append(o);
    }
    input.value = value || "";
    box.append(el("span", "", label), input);
    return box;
  }
  function filters(data, params) {
    const f = data.filters,
      form = el("form", "srp-filters card"),
      quick = el("div", "chips srp-periods");
    for (const [value, label] of [
      ["today", "Hôm nay"],
      ["week", "7 ngày gần nhất"],
      ["month", "Tháng này"],
      ["previous", "Tháng trước"],
    ])
      quick.append(
        button(
          label,
          () => navigate(params, { ...reportPeriod(value) }),
          "chip",
        ),
      );
    const grid = el("div", "srp-filter-grid");
    for (const [name, label] of [
      ["from", "Từ ngày"],
      ["to", "Đến ngày"],
    ]) {
      const box = el("label"),
        input = el("input");
      input.type = "date";
      input.name = name;
      input.value = f[name];
      input.required = true;
      input.setAttribute("aria-label", label);
      box.append(el("span", "", label), input);
      grid.append(box);
    }
    const options = (rows, all) => [
      ["", all],
      ...rows.map((x) => [x.id, x.name]),
    ];
    grid.append(
      select(
        "Cửa hàng / quầy",
        "registerId",
        options(data.registers, "Tất cả cửa hàng / quầy"),
        f.registerId,
      ),
      select(
        "Nhân viên mở ca",
        "memberId",
        options(
          data.members,
          data.scope === "own" ? "Ca của tôi" : "Tất cả nhân viên",
        ),
        f.memberId,
      ),
      select(
        "Loại ca",
        "templateId",
        options(data.templates, "Tất cả loại ca"),
        f.templateId,
      ),
      select(
        "Trạng thái",
        "status",
        [
          ["all", "Tất cả ca"],
          ["open", "Đang mở"],
          ["closed", "Đã kết"],
        ],
        f.status,
      ),
      select(
        "Đối chiếu tiền mặt",
        "difference",
        [
          ["all", "Tất cả"],
          ["matched", "Đã kết – khớp két"],
          ["shortage", "Đã kết – thiếu tiền"],
          ["surplus", "Đã kết – thừa tiền"],
        ],
        f.difference,
      ),
    );
    const search = el("label"),
      input = el("input");
    input.name = "q";
    input.type = "search";
    input.maxLength = 100;
    input.value = f.q;
    input.placeholder = "Tên nhân viên, quầy, mã ca…";
    input.setAttribute("aria-label", "Tìm trong báo cáo ca");
    search.append(el("span", "", "Tìm kiếm"), input);
    grid.append(search);
    const actions = el("div", "srp-filter-actions"),
      submit = el("button", "btn primary", "Xem báo cáo");
    submit.type = "submit";
    actions.append(
      button("Xóa bộ lọc", () => visit(new URLSearchParams())),
      submit,
    );
    const error = el("p", "error");
    error.setAttribute("role", "alert");
    form.append(quick, grid, error, actions);
    form.onsubmit = (e) => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      if (values.from > values.to) {
        error.textContent = "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.";
        return;
      }
      navigate(params, values);
    };
    root.append(form);
  }
  function overview(data) {
    const s = data.summary,
      t = reportTotals(s),
      stats = el("div", "srp-stats");
    for (const [label, value, note] of [
      [
        "Số ca",
        s.shiftCount,
        `${s.openCount} đang mở · ${s.closedCount} đã kết`,
      ],
      [
        "Giá trị đơn trừ hàng trả",
        money(t.netRevenue),
        `${s.billCount} bill · Giá trị đơn gồm VAT`,
      ],
      [
        "Tiền khách đã thu",
        money(t.received),
        "Tiền mặt + chuyển khoản, trước hoàn tiền",
      ],
      [
        "Tiền mặt khách trả",
        money(s.cash),
        "Không cộng tiền đầu ca hoặc chuyển két",
      ],
      [
        "Chuyển khoản khách trả",
        money(s.transfer),
        "Không tính vào số dư két tiền mặt",
      ],
      [
        "Ca lệch tiền mặt",
        s.differenceCount,
        `Thiếu ${money(Math.abs(s.shortage))} · Thừa ${money(s.surplus)}`,
      ],
    ]) {
      const card = el("section", "card srp-stat");
      card.append(
        el("span", "", label),
        el("strong", "", value),
        el("small", "muted", note),
      );
      stats.append(card);
    }
    root.append(stats);
    const notes = el("section", "card srp-facts");
    for (const [label, value] of [
      ["Giá trị đơn", s.revenue],
      ["Chiết khấu đã tính trong giá trị đơn", s.discount],
      ["Giá trị trả hàng giảm trừ", s.returnCredit],
      ["Đã hoàn cho khách", t.refunded],
      ["Thu thủ công", s.manualIn],
      ["Chi thủ công", s.manualOut],
    ]) {
      const item = el("div");
      item.append(el("span", "", label), el("b", "", money(value)));
      notes.append(item);
    }
    root.append(
      notes,
      el(
        "p",
        "srp-help",
        "Tổng hợp toàn bộ ca khớp bộ lọc, không chỉ trang đang xem. Ca thuộc ngày kinh doanh; ca đã kết dùng báo cáo chốt, ca đang mở là tạm tính. Tiền đầu ca / bàn giao không cộng thành doanh thu. Giá trị đơn theo ca lập, trả hàng theo ca nhận có hiệu lực giảm công nợ; chiết khấu đã nằm trong giá trị đơn.",
      ),
    );
  }
  function table(headers, rows, cls = "") {
    const wrap = el("div", "srp-table-wrap"),
      t = el("table", "srp-table " + cls),
      head = el("thead"),
      tr = el("tr"),
      body = el("tbody");
    for (const h of headers) tr.append(el("th", "", h));
    head.append(tr);
    for (const cells of rows) {
      const row = el("tr");
      cells.forEach((value, i) => {
        const cell = el("td");
        cell.dataset.label = headers[i];
        if (value instanceof Node) cell.append(value);
        else cell.textContent = String(value ?? "—");
        row.append(cell);
      });
      body.append(row);
    }
    t.append(head, body);
    wrap.append(t);
    return wrap;
  }
  function breakdown(data, params) {
    const section = el("section", "card srp-section"),
      head = el("div", "srp-section-head");
    const group = select(
      "Tổng hợp theo",
      "groupBy",
      [
        ["register", "Cửa hàng / quầy"],
        ["member", "Nhân viên"],
        ["day", "Ngày kinh doanh"],
      ],
      data.filters.groupBy,
    );
    group.querySelector("select").onchange = (e) =>
      navigate(params, { groupBy: e.target.value });
    head.append(el("h2", "", "Thống kê tổng hợp"), group);
    section.append(head);
    if (!data.groups.length)
      section.append(
        el("p", "muted", "Chưa có dữ liệu trong khoảng ngày này."),
      );
    else
      section.append(
        table(
          [
            "Nhóm",
            "Số ca",
            "Số bill",
            "Giá trị đơn trừ trả",
            "Tiền mặt",
            "Chuyển khoản",
            "Hoàn tiền",
            "Thiếu két",
            "Thừa két",
          ],
          data.groups.map((g) => {
            const totals = reportTotals(g);
            return [
              data.filters.groupBy === "day" ? dayLabel(g.name) : g.name,
              g.shiftCount,
              g.billCount,
              money(totals.netRevenue),
              money(g.cash),
              money(g.transfer),
              money(totals.refunded),
              money(Math.abs(g.shortage)),
              money(g.surplus),
            ];
          }),
          "srp-groups",
        ),
      );
    root.append(section);
  }
  function list(data, params) {
    const section = el("section", "card srp-section");
    section.append(el("h2", "", "Chi tiết từng ca"));
    if (!data.rows.length)
      section.append(el("p", "empty", "Không có ca phù hợp bộ lọc."));
    else
      section.append(
        table(
          [
            "Ngày / ca",
            "Cửa hàng / nhân viên",
            "Trạng thái",
            "Số bill",
            "Giá trị đơn",
            "Tiền mặt / chuyển khoản",
            "Két hệ thống",
            "Thực đếm",
            "Chênh lệch",
            "Thao tác",
          ],
          data.rows.map((r) => {
            const meta = el("div", "srp-cell-main");
            meta.append(
              el("b", "", dayLabel(r.business_date)),
              el("small", "", r.template_name || "Ca bán hàng"),
              el(
                "small",
                "",
                when(r.opened_at) +
                  " → " +
                  (r.closed_at ? when(r.closed_at) : "đang mở"),
              ),
            );
            const owner = el("div", "srp-cell-main");
            owner.append(
              el("b", "", r.register_name),
              el("span", "", r.member_name),
            );
            const state = el(
              "span",
              "pill " + (r.closed_at ? "" : "ok"),
              r.closed_at ? "Đã kết" : "Đang mở",
            );
            const sums = el("div", "srp-cell-main");
            sums.append(
              el("span", "", "TM " + money(r.cash)),
              el("span", "", "CK " + money(r.transfer)),
            );
            const diff = el(
              "span",
              r.cash_difference ? "srp-danger" : "",
              r.closed_at ? money(r.cash_difference) : "Chưa kết",
            );
            diff.title = r.difference_reason || "";
            const open = button(
              "Xem ca",
              () => {
                const p = new URLSearchParams(params);
                p.set("shiftId", r.id);
                visit(p);
              },
              "btn secondary small",
            );
            open.dataset.shiftReport = r.id;
            return [
              meta,
              owner,
              state,
              r.billCount,
              money(r.revenue),
              sums,
              r.expected_cash == null ? "—" : money(r.expected_cash),
              r.closed_at ? money(r.counted_cash) : "Chưa đếm",
              diff,
              open,
            ];
          }),
          "srp-shifts",
        ),
      );
    const f = data.filters,
      total = data.summary.shiftCount,
      pages = Math.max(1, Math.ceil(total / f.pageSize)),
      pager = el("div", "srp-pager");
    const prev = button("← Trước", () =>
        navigate(params, { page: String(f.page - 1) }),
      ),
      next = button("Sau →", () =>
        navigate(params, { page: String(f.page + 1) }),
      );
    prev.disabled = f.page <= 1;
    next.disabled = f.page >= pages;
    const size = select(
      "Số ca mỗi trang",
      "pageSize",
      [
        ["25", "25 ca"],
        ["50", "50 ca"],
        ["100", "100 ca"],
      ],
      String(f.pageSize),
    );
    size.querySelector("select").onchange = (e) =>
      navigate(params, { pageSize: e.target.value });
    pager.append(
      el(
        "span",
        "muted",
        `${total ? Math.min((f.page - 1) * f.pageSize + 1, total) : 0}–${Math.min(f.page * f.pageSize, total)} / ${total} ca · Trang ${f.page}/${pages}`,
      ),
      size,
      prev,
      next,
    );
    section.append(pager);
    root.append(section);
  }
  async function show(query = "") {
    const mine = ++run,
      params = new URLSearchParams(query),
      id = params.get("shiftId");
    root.classList.add("shift-reports-page");
    root.replaceChildren();
    const head = header(
      id
        ? "Chi tiết số liệu và đối chiếu tiền mặt của ca."
        : "Theo dõi kết quả bán hàng, tiền thu và đối chiếu bàn giao ca.",
    );
    const loading = el("p", "muted", "Đang tải báo cáo…");
    loading.setAttribute("role", "status");
    root.append(loading);
    try {
      if (id) {
        const back = new URLSearchParams(params);
        back.delete("shiftId");
        head.append(button("← Danh sách ca", () => visit(back)));
        const d = await api("/pos/shifts/" + encodeURIComponent(id));
        if (mine !== run || root.hidden) return;
        loading.remove();
        head.append(button("In K80", () => printPos(d, "shift")));
        const content = el("section", "srp-detail");
        renderShiftReport(content, d);
        root.append(content);
      } else {
        const data = await api("/pos/shift-reports?" + params);
        if (mine !== run || root.hidden) return;
        loading.remove();
        head.append(button("Làm mới", () => show(query)));
        filters(data, params);
        overview(data);
        breakdown(data, params);
        list(data, params);
        root.append(
          el(
            "p",
            "muted small",
            "Cập nhật " +
              when(data.asOf) +
              (data.scope === "own"
                ? " · Chỉ báo cáo ca của bạn."
                : " · Các cửa hàng được phép xem."),
          ),
        );
      }
    } catch (e) {
      if (mine !== run || root.hidden) return;
      loading.remove();
      const error = el("section", "card srp-error");
      error.setAttribute("role", "alert");
      error.append(
        el("p", "", e.message),
        button("Thử lại", () => show(query)),
      );
      root.append(error);
    }
  }
  function close() {
    ++run;
    root.replaceChildren();
  }
  return { show, close };
}
