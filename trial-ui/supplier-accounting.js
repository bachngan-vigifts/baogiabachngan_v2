const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const stateName = (s) =>
  ({
    submitted: "Chờ đối chiếu",
    verified: "Đã đối chiếu",
    rejected: "Cần kiểm tra lại",
    draft: "Nháp",
    posted: "Đã ghi sổ",
    voided: "Đã hủy đối chiếu",
  })[s] || s;
const money = (n) =>
  n === null || n === undefined
    ? "Chưa đủ dữ liệu"
    : Number(n).toLocaleString("vi-VN") + " đ";
/** Internal-only panel; portal receives a different, allowlisted projection. */
export function initSupplierAccounting({
  api,
  host,
  supplierId,
  isCurrent,
  confirmBox,
}) {
  let seq = 0,
    invoiceOffset = 0,
    balanceOffset = 0,
    closed = false,
    busy = false;
  const live = (n) => !closed && n === seq && isCurrent();
  const base = "/accounting/suppliers/" + encodeURIComponent(supplierId);
  host.innerHTML =
    '<h3>Hóa đơn & công nợ kế toán</h3><button class="btn secondary" type="button" data-open-accounting>Xem đối chiếu hóa đơn / công nợ</button>';
  host.querySelector("button").onclick = load;
  async function load() {
    const n = ++seq;
    host.innerHTML = '<p role="status">Đang tải đối chiếu…</p>';
    try {
      const r = await api(
        base +
          "?limit=10&invoiceOffset=" +
          invoiceOffset +
          "&balanceOffset=" +
          balanceOffset,
        "GET",
        undefined,
        { fresh: true },
      );
      if (!live(n)) return;
      render(r);
    } catch (e) {
      if (live(n)) {
        host.innerHTML =
          '<p role="alert"></p><button type="button" class="btn secondary">Thử lại</button>';
        host.querySelector("p").textContent = e.message;
        host.querySelector("button").onclick = load;
      }
    }
  }
  function render(r) {
    host.innerHTML = `<h3>Hóa đơn & công nợ kế toán</h3><p class="muted small">${esc(r.debtBasis)} Chỉ chia sẻ trạng thái ghi sổ sau khi xác nhận liên kết; không chia sẻ tồn, giá vốn, ghi chú nội bộ hay dữ liệu NCC khác.</p>${[
      ...(r.invoices.warnings || []),
      ...(r.balances.warnings || []),
    ]
      .filter(
        (s, i, a) => a.indexOf(s) === i && !s.startsWith("Công nợ tính theo"),
      )
      .map((s) => `<p class="muted small">${esc(s)}</p>`)
      .join(
        "",
      )}<p role="status" data-message></p><h4>Hóa đơn NCC (${r.invoices.total})</h4>${
      r.invoices.items
        .map((i) => {
          const l = r.links.find((l) => l.invoiceId === i.id);
          return `<article class="sup-accounting-row"><b>${esc(i.no)} · ${esc(i.series || "không ký hiệu")}</b><p>${esc(i.date)} · ${esc(i.orderNo)} · ${money(i.total)}</p><p>Đối chiếu NCC: ${esc(stateName(i.status))}${l ? " · " + esc(l.bookName) + " · " + esc(stateName(l.state)) + (l.shared ? " · Đã cho phép chia sẻ" : " · Chỉ nội bộ") : ""}</p><div class="pur-actions">${!l && i.status === "verified" ? `<button type="button" class="btn secondary small" data-link="${esc(i.id)}">Liên kết sổ kế toán</button>` : ""}${r.canVerify && !l && i.status === "submitted" ? `<button type="button" class="btn secondary small" data-verify="${esc(i.id)}">Xác nhận đã đối chiếu hóa đơn</button>` : ""}${l ? `<button type="button" class="btn secondary small" data-revoke="${esc(l.id)}">Thu hồi liên kết</button>` : ""}</div><div data-link-form="${esc(i.id)}"></div></article>`;
        })
        .join("") ||
      "<p>Chưa có hóa đơn NCC khai báo. NCC bổ sung hóa đơn theo đơn mua trên cổng NCC trước.</p>"
    }<div class="pur-actions"><button class="btn secondary small" type="button" data-inv-prev ${invoiceOffset ? "" : "disabled"}>Hóa đơn trước</button><button class="btn secondary small" type="button" data-inv-next ${invoiceOffset + 10 < r.invoices.total ? "" : "disabled"}>Hóa đơn sau</button></div><h4>Công nợ theo đơn (${r.balances.total})</h4>${r.balances.items.map((i) => `<article class="sup-accounting-row"><b>${esc(i.no)}</b><p>Đơn: ${money(i.total)} · Đã thanh toán: ${money(i.paid)}</p><p>Còn phải trả theo đơn: <b>${money(i.remaining)}</b></p><p>Hóa đơn đã ghi sổ được chia sẻ: ${money(i.accountedInvoiceTotal)} (không cộng thêm vào nợ)</p></article>`).join("") || "<p>Chưa có đơn mua được duyệt để tính công nợ.</p>"}<div class="pur-actions"><button class="btn secondary small" type="button" data-bal-prev ${balanceOffset ? "" : "disabled"}>Đơn trước</button><button class="btn secondary small" type="button" data-bal-next ${balanceOffset + 10 < r.balances.total ? "" : "disabled"}>Đơn sau</button><button class="btn secondary small" type="button" data-refresh>Làm mới</button></div>`;
    const message = (e) => {
      const p = host.querySelector("[data-message]");
      if (p) p.textContent = e;
    };
    async function write(button, run) {
      if (busy) return;
      const generation = seq;
      busy = true;
      button.disabled = true;
      try {
        await run();
        if (live(generation)) await load();
      } catch (e) {
        if (live(generation)) message(e.message);
      } finally {
        busy = false;
        button.disabled = false;
      }
    }
    host.querySelector("[data-inv-prev]").onclick = () => {
      invoiceOffset = Math.max(0, invoiceOffset - 10);
      load();
    };
    host.querySelector("[data-inv-next]").onclick = () => {
      invoiceOffset += 10;
      load();
    };
    host.querySelector("[data-bal-prev]").onclick = () => {
      balanceOffset = Math.max(0, balanceOffset - 10);
      load();
    };
    host.querySelector("[data-bal-next]").onclick = () => {
      balanceOffset += 10;
      load();
    };
    host.querySelector("[data-refresh]").onclick = load;
    host.querySelectorAll("[data-verify]").forEach(
      (b) =>
        (b.onclick = () =>
          write(b, async () => {
            if (
              !(await confirmBox(
                "Xác nhận hóa đơn đúng NCC, đơn mua, ngày và số tiền theo chứng từ gốc?",
                { title: "Đối chiếu hóa đơn", ok: "Xác nhận" },
              ))
            )
              return;
            await api(
              "/supplier-workspace-admin/invoices/" +
                encodeURIComponent(b.dataset.verify) +
                "/verify",
              "POST",
              { status: "verified" },
            );
          })),
    );
    host.querySelectorAll("[data-revoke]").forEach(
      (b) =>
        (b.onclick = () => {
          const l = r.links.find((l) => l.id === b.dataset.revoke),
            row = b.closest("article"),
            area = row.querySelector("[data-link-form]");
          area.innerHTML =
            '<label>Lý do thu hồi<input maxlength="1000" data-reason></label><button type="button" class="btn secondary" data-confirm-revoke>Xác nhận thu hồi liên kết</button>';
          area.querySelector("button").onclick = (e) =>
            write(e.currentTarget, async () => {
              const reason = area.querySelector("input").value.trim();
              if (!reason) throw Error("Nhập lý do thu hồi.");
              await api(
                "/accounting/supplier-links/" +
                  encodeURIComponent(l.id) +
                  "/revoke",
                "POST",
                { reason, revision: l.revision },
              );
            });
        }),
    );
    host.querySelectorAll("[data-link]").forEach(
      (b) =>
        (b.onclick = async () => {
          const generation = seq;
          try {
            b.disabled = true;
            const d = await api(
              base +
                "/invoice-options?invoiceId=" +
                encodeURIComponent(b.dataset.link),
              "GET",
              undefined,
              { fresh: true },
            );
            if (!live(generation)) return;
            const area = b.closest("article").querySelector("[data-link-form]");
            area.innerHTML = `<p>${esc(d.message)}</p>${d.options.length ? `<label>Chứng từ / sổ / pháp nhân<select data-document><option value="">Chọn chứng từ đã đối soát</option>${d.options.map((o) => `<option value="${esc(o.id)}">${esc(o.bookName)} · ${esc(o.entityName)} (${esc(o.entityTaxCode)}) · ${esc(o.reference)} · ${esc(o.date)}</option>`).join("")}</select></label><label class="sup-accounting-check"><input type="checkbox" data-confirm> Đúng pháp nhân, NCC và chứng từ gốc.</label><label class="sup-accounting-check"><input type="checkbox" data-shared> Cho NCC này xem trạng thái đã ghi sổ và số tiền hóa đơn liên kết.</label><button type="button" class="btn primary" data-confirm-link>Lưu liên kết</button>` : "<p>Chưa có chứng từ mua đã duyệt khớp hóa đơn trong hai sổ. Vào Không gian kế toán để nhập và duyệt đúng chứng từ; chưa tự sinh số dư.</p>"}`;
            area
              .querySelector("[data-confirm-link]")
              ?.addEventListener("click", (e) =>
                write(e.currentTarget, async () => {
                  const documentId =
                      area.querySelector("[data-document]").value,
                    confirmed = area.querySelector("[data-confirm]").checked;
                  if (!documentId || !confirmed)
                    throw Error(
                      "Chọn chứng từ và xác nhận đối soát pháp nhân.",
                    );
                  await api(base + "/links", "POST", {
                    invoiceId: b.dataset.link,
                    documentId,
                    confirmed,
                    shared: area.querySelector("[data-shared]").checked,
                  });
                }),
              );
          } catch (e) {
            if (live(generation)) message(e.message);
          } finally {
            b.disabled = false;
          }
        }),
    );
  }
  return {
    close: () => {
      closed = true;
      seq++;
      host.replaceChildren();
    },
  };
}
