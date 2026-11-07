const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const labels = {
  draft: "Nháp",
  active: "Đang chạy",
  completed: "Đã kết thúc",
  cancelled: "Đã huỷ",
};
export function initCenterCampaigns({
  root,
  api,
  user,
  canCare,
  openCare,
  toast,
  phoneHref,
  onChange,
}) {
  let run = 0,
    disposed = false,
    page = 0,
    detailPage = 0,
    data = null,
    detail = null,
    error = "",
    loading = false,
    query = "",
    searchTimer = 0;
  const session = user()?.id,
    dialogs = new Set();
  const live = () => !disposed && session === user()?.id;
  const base = "/customers/center/campaigns",
    manager = () => user()?.role === "manager";
  const dialog = (title, body) => {
    const dlg = document.createElement("dialog");
    dlg.className = "modal center-campaign-dialog";
    dlg.innerHTML = `<form><div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Đóng">×</button></div><div class="modal-body">${body}<p class="error" role="alert" data-error></p></div><div class="modal-foot"><button type="button" class="btn secondary" data-close>Huỷ</button><button class="btn primary" data-save>Lưu</button></div></form>`;
    document.body.append(dlg);
    dialogs.add(dlg);
    const close = () => {
      dialogs.delete(dlg);
      dlg.remove();
    };
    dlg.querySelectorAll("[data-close]").forEach((b) => (b.onclick = close));
    dlg.oncancel = close;
    dlg.showModal();
    return { dlg, form: dlg.querySelector("form"), close };
  };
  function render() {
    if (!live()) return;
    const campaign = detail?.campaign;
    root.innerHTML = `<div class="page-head"><div><h2>${campaign ? esc(campaign.name) : "Chiến dịch trọng tâm"}</h2><p class="muted small">Chỉ hiển thị phân công trong phạm vi được xem. Kết quả lấy từ giao dịch chăm sóc đã lưu, không tự cộng KPI khi tạo chiến dịch.</p></div>${manager() ? `<button class="btn primary" data-campaign-new>${campaign ? "＋ Thêm khách" : "＋ Tạo chiến dịch"}</button>` : ""}</div>
 <label>Tìm ${campaign ? "khách trong chiến dịch" : "chiến dịch"}<input type="search" data-campaign-search value="${esc(query)}" placeholder="Nhập từ khoá…"></label>
 ${
   campaign
     ? `<p>${esc(campaign.startDate)} – ${esc(campaign.endDate)} · ${labels[campaign.status]}</p><p>${esc(campaign.note)}</p><div class="center-actions"><button class="btn secondary" data-campaign-back>‹ Danh sách chiến dịch</button>${
         manager()
           ? `<label>Trạng thái<select data-campaign-status>${Object.entries(
               labels,
             )
               .map(
                 ([k, v]) =>
                   `<option value="${k}" ${k === campaign.status ? "selected" : ""}>${v}</option>`,
               )
               .join("")}</select></label>`
           : ""
       }</div>`
     : ""
 }
 ${
   loading
     ? '<p role="status">Đang tải chiến dịch…</p>'
     : error
       ? `<p class="error" role="alert">${esc(error)}</p><button class="btn secondary" data-campaign-reload>Thử lại</button>`
       : campaign
         ? detail.targets.length
           ? detail.targets
               .map((t) => {
                 const href = phoneHref(t.phone);
                 return `<article class="center-item"><a class="center-name" href="#/customers/${encodeURIComponent(t.customerId)}">${esc(t.name)}</a><p>${esc(t.contact)} · ${esc(t.assigneeName)}</p><p class="muted">${t.occurredAt ? `Đã ghi ${esc(t.occurredAt.slice(0, 10))}: ${esc(t.content)}` : "Chưa có giao dịch gắn với chiến dịch"}</p><span class="pill ${t.completion === "completed" ? "ok" : "muted"}">${t.completion === "completed" ? "Đã kết nối" : t.occurredAt ? "Đã ghi / chưa kết nối" : "Chưa chăm sóc"}</span><div class="center-actions">${href ? `<a class="btn secondary" href="${esc(href)}">Gọi</a>` : '<span class="muted">Chưa có SĐT</span>'}<button class="btn secondary" data-campaign-record="${esc(t.id)}" ${canCare() && campaign.status === "active" ? "" : "disabled"}>Ghi nhận</button><button class="btn secondary" data-campaign-link="${esc(t.id)}" ${canCare() && campaign.status === "active" ? "" : "disabled"}>Gắn giao dịch đã có</button></div></article>`;
               })
               .join("")
           : '<p class="empty">Chưa có khách phù hợp trong phạm vi được xem.</p>'
         : data?.campaigns.length
           ? data.campaigns
               .map(
                 (c) =>
                   `<article class="center-item"><h3>${esc(c.name)}</h3><p>${esc(c.startDate)} – ${esc(c.endDate)} · ${labels[c.status]}</p><p>${esc(c.note)}</p><p>${c.progress.assigned} khách · đã ghi ${c.progress.contacted} · đã kết nối ${c.progress.completed}</p><button class="btn secondary" data-campaign-open="${esc(c.id)}">Xem danh sách và ghi nhận</button></article>`,
               )
               .join("")
           : '<p class="empty">Chưa có chiến dịch trong phạm vi được xem. Manager có thể tạo và phân công khách thực tế.</p>'
 }
 <div class="center-pager"><button class="btn secondary" data-campaign-page="-1" ${loading || !(campaign ? detailPage : page) ? "disabled" : ""}>Trang trước</button><span>Trang ${(campaign ? detailPage : page) + 1} · ${campaign ? detail.total : (data?.total ?? 0)} ${campaign ? "khách" : "chiến dịch"}</span><button class="btn secondary" data-campaign-page="1" ${loading || ((campaign ? detailPage : page) + 1) * 20 >= (campaign ? detail.total : (data?.total ?? 0)) ? "disabled" : ""}>Trang sau</button></div>`;
  }
  async function load(id = detail?.campaign.id) {
    const current = ++run;
    loading = true;
    error = "";
    render();
    try {
      const d = await api(
        base +
          (id ? "/" + encodeURIComponent(id) : "") +
          "?" +
          new URLSearchParams({
            limit: 20,
            offset: (id ? detailPage : page) * 20,
            q: query,
          }),
      );
      if (current !== run || !live()) return;
      if (id) detail = d;
      else {
        data = d;
        detail = null;
      }
    } catch (ex) {
      if (current === run && live()) error = ex.message;
    } finally {
      if (current === run && live()) {
        loading = false;
        render();
      }
    }
  }
  async function assignForm() {
    let people;
    try {
      people = (await api("/tasks/people")).people.filter((p) =>
        ["employee", "manager"].includes(p.role),
      );
    } catch (ex) {
      toast(ex.message, "err");
      return;
    }
    if (!live()) return;
    const c = detail?.campaign,
      today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Ho_Chi_Minh",
      }).format(new Date());
    const { dlg, form, close } = dialog(
      c ? "Thêm khách vào chiến dịch" : "Tạo chiến dịch",
      `${c ? "" : `<label>Tên chiến dịch *<input name="name" required maxlength="160"></label><label>Mô tả<textarea name="note" maxlength="2000"></textarea></label><div class="form-grid cols-2"><label>Từ ngày *<input type="date" name="startDate" value="${today}" required></label><label>Đến ngày *<input type="date" name="endDate" value="${today}" required></label></div>`}<label>Nhân viên được phân công *<select name="assigneeId" required>${people.map((p) => `<option value="${esc(p.id)}" ${p.id === user()?.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label><p class="muted small">Nhân viên phải được phụ trách hoặc chia sẻ khách trước khi phân công.</p><label>Tìm khách doanh nghiệp đã duyệt<input type="search" name="customerQ" placeholder="Tên, điện thoại, mã khách…"></label><div data-customers></div><p data-selected>Chưa chọn khách</p>`,
    );
    const picked = new Map();
    let lookup = 0,
      timer = 0,
      saving = false;
    const search = async () => {
      const n = ++lookup;
      try {
        const d = await api(
          "/customers?" +
            new URLSearchParams({
              q: form.elements.customerQ.value,
              limit: 20,
              offset: 0,
            }),
        );
        if (n !== lookup || !dlg.isConnected || !live()) return;
        dlg.querySelector("[data-customers]").innerHTML =
          (d.customers || [])
            .filter((x) => !x.isRetail && x.approvalStatus === "approved")
            .map(
              (x) =>
                `<label class="center-customer-choice"><input type="checkbox" data-pick="${esc(x.id)}" data-name="${esc(x.name)}" ${picked.has(x.id) ? "checked" : ""}>${esc(x.name)}</label>`,
            )
            .join("") || '<p class="empty">Không có khách phù hợp.</p>';
      } catch (ex) {
        if (n === lookup && dlg.isConnected)
          dlg.querySelector("[data-error]").textContent = ex.message;
      }
    };
    form.elements.customerQ.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(search, 250);
    };
    dlg.onchange = (e) => {
      if (!e.target.dataset.pick) return;
      if (e.target.checked) {
        if (picked.size >= 100) {
          e.target.checked = false;
          return;
        }
        picked.set(e.target.dataset.pick, e.target.dataset.name);
      } else picked.delete(e.target.dataset.pick);
      dlg.querySelector("[data-selected]").textContent =
        `Đã chọn ${picked.size}: ${[...picked.values()].join(", ")}`;
    };
    await search();
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (saving || !live() || !form.reportValidity()) return;
      const fields = form.elements,
        body = {
          assigneeId: fields.assigneeId.value,
          customerIds: [...picked.keys()],
          ...(!c
            ? {
                name: fields.name.value,
                note: fields.note.value,
                startDate: fields.startDate.value,
                endDate: fields.endDate.value,
              }
            : {}),
        };
      saving = true;
      dlg.querySelector("[data-save]").disabled = true;
      try {
        const d = await api(
          base + (c ? "/" + encodeURIComponent(c.id) + "/targets" : ""),
          "POST",
          body,
        );
        if (!live()) return;
        close();
        toast(c ? "Đã thêm phân công." : "Đã tạo chiến dịch.");
        query = "";
        detailPage = 0;
        await load(c?.id || d.campaign.id);
        onChange?.();
      } catch (ex) {
        if (dlg.isConnected)
          dlg.querySelector("[data-error]").textContent = ex.message;
      } finally {
        saving = false;
        if (dlg.isConnected) dlg.querySelector("[data-save]").disabled = false;
      }
    };
  }
  async function link(target, activity) {
    await api(
      `${base}/${encodeURIComponent(detail.campaign.id)}/targets/${encodeURIComponent(target.id)}/activity`,
      "PUT",
      { activityId: activity.id, revision: target.revision },
    );
    await load();
    onChange?.();
  }
  async function existing(target, preselected = null) {
    const campaign = detail.campaign;
    let rows;
    try {
      rows = (
        await api(
          "/care?" +
            new URLSearchParams({
              view: "log",
              customerId: target.customerId,
              from: campaign.startDate,
              to: campaign.endDate,
              limit: 100,
            }),
        )
      ).activities.filter((a) => a.ownerId === target.assigneeId);
    } catch (ex) {
      toast(ex.message, "err");
      return;
    }
    if (!live()) return;
    const { dlg, form, close } = dialog(
      "Gắn giao dịch đã ghi",
      `<p>${esc(target.name)} · ${esc(target.assigneeName)}</p><p class="muted small">Nếu lần ghi vừa rồi đã lưu nhưng chưa gắn được, chọn lại tại đây; không ghi thêm giao dịch trùng.</p><label>Giao dịch trong thời gian chiến dịch<select name="activityId" required><option value="">Chọn giao dịch</option>${rows.map((a) => `<option value="${esc(a.id)}" ${a.id === preselected?.id ? "selected" : ""}>${esc(a.occurredAt.slice(0, 10))} · ${esc(a.content || a.subject)}</option>`).join("")}</select></label>`,
    );
    let saving = false;
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (saving || !form.reportValidity() || !live()) return;
      saving = true;
      dlg.querySelector("[data-save]").disabled = true;
      try {
        await link(target, { id: form.elements.activityId.value });
        close();
        toast("Đã gắn kết quả chăm sóc.");
      } catch (ex) {
        if (dlg.isConnected)
          dlg.querySelector("[data-error]").textContent = ex.message;
      } finally {
        saving = false;
        if (dlg.isConnected) dlg.querySelector("[data-save]").disabled = false;
      }
    };
  }
  root.addEventListener("input", (e) => {
    if (!e.target.matches("[data-campaign-search]")) return;
    query = e.target.value;
    page = detailPage = 0;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => load(), 300);
  });
  root.addEventListener("change", async (e) => {
    if (!e.target.matches("[data-campaign-status]")) return;
    try {
      await api(base + "/" + encodeURIComponent(detail.campaign.id), "PUT", {
        status: e.target.value,
        revision: detail.campaign.revision,
      });
      await load();
      onChange?.();
    } catch (ex) {
      toast(ex.message, "err");
      await load();
    }
  });
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled || !live()) return;
    if (b.hasAttribute("data-campaign-new") && manager()) return assignForm();
    if (b.hasAttribute("data-campaign-back")) {
      query = "";
      detail = null;
      detailPage = 0;
      return load(null);
    }
    if (b.dataset.campaignOpen) {
      query = "";
      detailPage = 0;
      return load(b.dataset.campaignOpen);
    }
    if (b.hasAttribute("data-campaign-reload")) return load();
    if (b.dataset.campaignPage) {
      if (detail)
        detailPage = Math.max(0, detailPage + Number(b.dataset.campaignPage));
      else page = Math.max(0, page + Number(b.dataset.campaignPage));
      return load();
    }
    const target = detail?.targets.find(
      (t) => t.id === (b.dataset.campaignRecord || b.dataset.campaignLink),
    );
    if (!target || !canCare()) return;
    if (b.dataset.campaignLink) return existing(target);
    if (b.dataset.campaignRecord)
      return openCare(
        {
          customer: { id: target.customerId, name: target.name },
          ownerId: target.assigneeId,
        },
        async (activity) => {
          if (!live() || !activity?.id) return;
          try {
            await link(target, activity);
            toast("Đã cập nhật kết quả chiến dịch.");
          } catch (ex) {
            toast(
              "Giao dịch đã lưu; chưa gắn được vào chiến dịch: " + ex.message,
              "err",
            );
            await existing(target, activity);
          }
        },
      );
  });
  return {
    load,
    destroy() {
      disposed = true;
      run++;
      clearTimeout(searchTimer);
      dialogs.forEach((d) => d.remove());
      dialogs.clear();
    },
  };
}
