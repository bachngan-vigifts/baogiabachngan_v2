import { readAccountingFile } from "./accounting-file.js";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n) =>
  n === null || n === undefined
    ? "Chưa đủ dữ liệu"
    : Number(n).toLocaleString("vi-VN") + " đ";
const kindName = { opening: "Đầu kỳ", purchase: "Nhập mua", sale: "Xuất bán" };
const stateName = {
  draft: "Nháp",
  posted: "Đã ghi sổ",
  voided: "Đã hủy đối chiếu",
};
const dateNow = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function initAccounting({ api, root }) {
  if (!document.querySelector("#accounting-style")) {
    const l = document.createElement("link");
    l.id = "accounting-style";
    l.rel = "stylesheet";
    l.href = new URL("./accounting.css", import.meta.url).href;
    document.head.append(l);
  }
  root.setAttribute("data-no-busy", "");
  root.dataset.mobileActions = "off";
  let active = false,
    epoch = 0,
    options = null,
    report = null,
    filters = {
      entityId: "",
      bookId: "",
      from: dateNow().slice(0, 7) + "-01",
      to: dateNow(),
    },
    dialog = null,
    busy = false;
  const $ = (s) => root.querySelector(s),
    valid = (id) => active && id === epoch;
  const request = (p, method = "GET", body) =>
    api("/accounting" + p, method, body, { fresh: true });
  const entities = () =>
    options.entities
      .map(
        (e) =>
          `<option value="${esc(e.id)}">${esc(e.name)} · ${esc(e.taxCode)}</option>`,
      )
      .join("");
  const notice = (text) => {
    if ($("#ac-notice")) $("#ac-notice").textContent = text;
  };
  const selectedBook = () => options.books.find((b) => b.id === filters.bookId);
  function closeDialog() {
    dialog?.remove();
    dialog = null;
    busy = false;
  }
  function modal(title, body, submit, label = "Lưu nháp") {
    closeDialog();
    const owner = epoch,
      d = document.createElement("dialog");
    dialog = d;
    d.className = "ac-dialog";
    d.innerHTML = `<form><header><h2>${esc(title)}</h2><button type="button" data-close aria-label="Đóng">×</button></header><div class="ac-modal-body">${body}<p role="alert" class="ac-error"></p></div><footer><button type="button" data-close>Huỷ</button><button type="submit" class="primary">${esc(label)}</button></footer></form>`;
    root.append(d);
    d.querySelectorAll("[data-close]").forEach(
      (b) =>
        (b.onclick = () => {
          if (!busy) closeDialog();
        }),
    );
    d.addEventListener("cancel", (e) => {
      if (busy) e.preventDefault();
      else closeDialog();
    });
    d.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      if (busy || !valid(owner)) return;
      busy = true;
      const buttons = [...d.querySelectorAll("button")];
      buttons.forEach((b) => (b.disabled = true));
      try {
        await submit(new FormData(e.target), d);
        if (valid(owner)) {
          closeDialog();
          await load();
        }
      } catch (error) {
        if (valid(owner) && dialog === d)
          d.querySelector(".ac-error").textContent = error.message;
      } finally {
        if (dialog === d) {
          busy = false;
          buttons.forEach((b) => (b.disabled = false));
        }
      }
    };
    d.showModal();
    return d;
  }
  const field = (label, name, type = "text", value = "", extra = "") =>
    `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
  function entityForm() {
    modal(
      "Pháp nhân sở hữu sổ",
      `<p>Nhập đúng tên và MST theo hồ sơ đăng ký. Không tự suy ra pháp nhân từ thương hiệu.</p><div class="ac-form">${field("Tên pháp nhân", "name", "text", "", 'required maxlength="500"')}${field("Mã số thuế", "taxCode", "text", "", 'required pattern="[0-9]{10}([0-9]{3})?" inputmode="numeric"')}</div><label class="ac-check"><input name="confirmed" type="checkbox" required> Tôi đã kiểm tra tên pháp nhân và MST.</label>`,
      (f) =>
        request("/entities", "POST", {
          name: f.get("name"),
          taxCode: f.get("taxCode"),
          confirmed: f.has("confirmed"),
        }),
      "Lưu pháp nhân",
    );
  }
  function bookForm(book) {
    modal(
      book ? "Cấu hình sổ kho" : "Thêm sổ kho kế toán",
      `<div class="ac-form">${field("Tên sổ", "name", "text", book?.name || "", 'required maxlength="200"')}<label>Pháp nhân / MST<select name="entityId"><option value="">Chưa cấu hình</option>${entities()}</select></label><label>Nhà cung cấp hóa đơn<select name="invoiceProvider"><option value="">Chưa cấu hình</option><option value="viettel">Viettel</option><option value="vnpt">VNPT</option></select></label></div><p>Thông tin nhà cung cấp dùng để cấu hình. Chưa kết nối tài khoản, ký số hoặc phát hành hóa đơn.</p>`,
      (f) =>
        request(book ? "/books/" + book.id : "/books", book ? "PUT" : "POST", {
          name: f.get("name"),
          entityId: f.get("entityId") || null,
          invoiceProvider: f.get("invoiceProvider") || null,
          active: book?.active ?? true,
          revision: book?.revision,
        }),
      "Lưu cấu hình",
    );
    if (book) {
      dialog.querySelector("[name=entityId]").value = book.entityId || "";
      dialog.querySelector("[name=invoiceProvider]").value =
        book.invoiceProvider || "";
    }
  }
  function policy() {
    const e = report.entity;
    modal(
      "Ngưỡng đối soát",
      `<p>Các ngưỡng dưới đây là ngưỡng quản trị nội bộ. Không có hệ số K chung mặc định cho mọi doanh nghiệp. Chỉ nhập tham số tham chiếu khi đã có nguồn xác nhận phù hợp MST/kỳ.</p><div class="ac-form">${field("Chậm luân chuyển (ngày)", "slowDays", "number", e.slowDays, 'required min="1" max="3650"')}${field("Ngày tồn dự kiến", "coverageDays", "number", e.coverageDays, 'required min="1" max="3650"')}${field("Nhập / xuất bán", "importRatio", "number", e.importRatio, 'required min="0.0001" step="0.0001"')}${field("K tham chiếu (để trống nếu chưa xác nhận)", "referenceK", "number", e.referenceK || "", 'min="0.0001" step="0.0001"')}${field("Nguồn tham chiếu", "kSource", "text", e.kSource, 'maxlength="1500"')}${field("Ngày xác nhận tham chiếu", "kVerifiedDate", "date", e.kVerifiedDate || "")}</div>`,
      (f) =>
        request("/entities/" + e.id + "/policy", "PUT", {
          ...Object.fromEntries(f),
          revision: e.revision,
        }),
      "Lưu ngưỡng",
    );
  }
  function documentForm() {
    const book = selectedBook();
    if (!book?.entityId) return notice("Chọn một sổ đã gán pháp nhân trước.");
    const d = modal(
      "Nhập chứng từ kế toán",
      `<p>Chỉ nhập chứng từ có thật đã được đối soát. Số lượng và tiền trước VAT; tiền tính bằng đồng. Phiếu nháp chưa ảnh hưởng số dư.</p><div class="ac-form"><label>Loại<select name="kind"><option value="opening">Đầu kỳ</option><option value="purchase">Nhập mua</option><option value="sale">Xuất bán từ chứng từ ngoài CRM</option></select></label>${field("Ngày", "date", "date", filters.to, "required")}${field("Số chứng từ gốc", "reference", "text", "", 'required maxlength="120"')}${field("Ký hiệu", "series", "text", "", 'maxlength="50"')}${field("MST đối tác (nếu có)", "counterpartyTaxCode", "text", "", 'maxlength="20"')}${field("Ghi chú nguồn đối soát", "note", "text", "", 'required maxlength="1500"')}</div><div class="ac-line-head"><b>Dòng hàng</b><div class="ac-actions"><button type="button" data-template>Tải file mẫu SKU/SL</button><label>Nhập từ file (tối đa 5.000 dòng)<input type="file" data-import accept=".xlsx,.xls,.csv"></label><button type="button" data-add-line>+ Thêm dòng</button></div></div><p data-import-status role="status">File chỉ có SKU và SL. Đọc trang tính đầu tiên; SKU lưu dạng Text. Tên hàng, đơn vị và giá bán niêm yết lấy theo SKU trên CRM; tổng tiền = SL × giá bán niêm yết trước VAT. Đây là định giá theo giá bán, không phải giá vốn kế toán. Mã thiếu giá cần bổ sung trước khi lưu; không tự áp thuế.</p><div class="ac-lines"></div><div class="ac-actions"><button type="button" data-prev>Trang trước</button><span data-page></span><button type="button" data-next>Trang sau</button></div><label class="ac-check"><input type="checkbox" name="confirmedZero"> Xác nhận sổ đầu kỳ không có hàng, số dư bằng 0.</label><p>Chỉ đánh dấu sổ rỗng nếu đã kiểm kê và đối chiếu chứng từ. Chưa bật trả/điều chỉnh vì cần đối soát giá trị gốc.</p>`,
      (f) => {
        syncRows();
        const missing = rows.findIndex(r => !r.sku || !r.name || !r.unit || r.netValue === "" || r.netValue === undefined);
        if (!f.has("confirmedZero") && missing >= 0) {
          page = Math.floor(missing / pageSize); paintRows();
          throw Error("Dòng " + (missing + 1) + ": bổ sung tên hàng, đơn vị và tổng tiền trước VAT theo chứng từ gốc.");
        }
        return request("/books/" + book.id + "/documents", "POST", {
          ...Object.fromEntries(f),
          lines:
            f.has("confirmedZero") && f.get("kind") === "opening" ? [] : rows,
          confirmedZero: f.has("confirmedZero"),
        });
      },
    );
    const pageSize = 25, owner = epoch;
    let rows = [], page = 0, importSeq = 0;
    const syncRows = () => {
      d.querySelectorAll(".ac-line").forEach(row => {
        rows[Number(row.dataset.index)] = { ...rows[Number(row.dataset.index)], ...Object.fromEntries([...row.querySelectorAll("input[data-key]")].map(i => [i.dataset.key, i.value])) };
      });
    };
    const paintRows = () => {
      const box = d.querySelector(".ac-lines"); box.replaceChildren();
      page = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
      for (let index = page * pageSize; index < Math.min(rows.length, (page + 1) * pageSize); index++) {
        const row = document.createElement("div"); row.className = "ac-line"; row.dataset.index = index;
        row.innerHTML = [["sku", "SKU", "text"], ["name", "Tên hàng", "text"], ["unit", "Đơn vị", "text"], ["quantity", "Số lượng", "number"], ["netValue", "Tổng tiền trước VAT", "number"], ["taxRate", "Thuế suất %", "number"]]
          .map(([key,label,type]) => `<label>${label}<input data-key="${key}" type="${type}" ${["quantity", "netValue", "taxRate"].includes(key) ? 'min="0" step="any"' : ""} ${key === "taxRate" ? "" : "required"}></label>`).join("") + '<button type="button" data-remove>Xóa</button>';
        row.querySelectorAll("input").forEach(i => { i.value = rows[index][i.dataset.key] ?? ""; i.disabled = d.querySelector("[name=confirmedZero]").checked; });
        row.querySelector("[data-remove]").onclick = () => { syncRows(); rows.splice(index, 1); paintRows(); };
        if (rows[index].unitPrice !== undefined) {
          const source = document.createElement("small"); source.style.gridColumn = "1 / -1";
          source.textContent = rows[index].unitPrice === null ? "Chưa có giá bán niêm yết trên CRM; bổ sung tổng tiền trước khi lưu." : `Giá bán niêm yết CRM: ${money(rows[index].unitPrice)} / ${rows[index].unit || "đơn vị"} · ${rows[index].pricePolicyName}`;
          row.append(source);
          const amount = row.querySelector('[data-key=netValue]');
          row.querySelector('[data-key=quantity]').oninput = event => {
            const price = rows[index].unitPrice;
            const total = price === null ? null : Math.round(Number(event.target.value) * price);
            amount.value = event.target.value && total !== null && Number.isSafeInteger(total) && total <= 9e12 ? total : "";
          };
          const invalidatePrice = () => {
            rows[index].unitPrice = null; amount.value = "";
            source.textContent = "Đã đổi SKU/đơn vị; kiểm tra lại đơn giá và tổng tiền trước khi lưu.";
          };
          row.querySelector('[data-key=sku]').oninput = invalidatePrice;
          row.querySelector('[data-key=unit]').oninput = invalidatePrice;
        }
        box.append(row);
      }
      d.querySelector("[data-page]").textContent = `Trang ${page + 1}/${Math.max(1, Math.ceil(rows.length/pageSize))} · ${rows.length}/5.000 dòng`;
      d.querySelector("[data-prev]").disabled = page === 0;
      d.querySelector("[data-next]").disabled = (page + 1) * pageSize >= rows.length;
    };
    d.querySelector("[data-prev]").onclick = () => { syncRows(); page--; paintRows(); };
    d.querySelector("[data-next]").onclick = () => { syncRows(); page++; paintRows(); };
    const add = () => {
      syncRows();
      if (rows.length >= 5000) return void (d.querySelector(".ac-error").textContent = "Tối đa 5.000 dòng/chứng từ.");
      rows.push({}); page = Math.floor((rows.length - 1)/pageSize); paintRows();
    };
    d.querySelector("[data-add-line]").onclick = add;
    d.querySelector("[data-template]").onclick = async () => {
      const button = d.querySelector("[data-template]"); button.disabled = true;
      try {
        const { downloadAccountingTemplate } = await import("./accounting-template.js");
        if (valid(owner) && dialog === d) await downloadAccountingTemplate();
      } catch(e) { if (valid(owner) && dialog === d) d.querySelector(".ac-error").textContent = e.message; }
      finally { if (!busy) button.disabled = false; }
    };
    d.querySelector("[data-import]").onchange = async (event) => {
      const file = event.target.files?.[0];
      if (!file || busy) return;
      const seq = ++importSeq;
      const status = d.querySelector("[data-import-status]");
      const submit = d.querySelector('button[type=submit]');
      busy = true; submit.disabled = true; status.textContent = "Đang kiểm tra file…";
      try {
        const imported = await readAccountingFile(file);
        if (!valid(owner) || dialog !== d || seq !== importSeq) return;
        const found = await request("/import-products", "POST", { skus: imported.map(r => r.sku) });
        if (!valid(owner) || dialog !== d || seq !== importSeq) return;
        syncRows();
        const existing = rows.filter(r => Object.values(r).some(v => String(v).trim() !== ""));
        if (existing.length + imported.length > 5000) throw Error("Tổng chứng từ vượt 5.000 dòng. Chưa nạp thêm dòng nào.");
        const seen = new Set(existing.map(r => r.sku));
        if (imported.some(r => seen.has(r.sku))) throw Error("File trùng SKU với dòng đang nhập. Chưa nạp thêm dòng nào.");
        const bySku = new Map(found.products.map(p => [p.sku, p]));
        const sourceNote = `Giá bán niêm yết CRM: ${found.pricePolicy?.name || "chưa có bảng giá phù hợp"} · ${found.priceAsOf}. Định giá theo giá bán, không phải giá vốn kế toán.`;
        const note = d.querySelector("[name=note]");
        if ((note.value + "\n" + sourceNote).trim().length > 1500) throw Error("Ghi chú quá dài để thêm nguồn giá. Rút gọn ghi chú rồi nhập lại file.");
        const priced = imported.map(r => {
          const product = bySku.get(r.sku), price = product?.unitPrice ?? null;
          const total = price === null ? null : Math.round(r.quantity * price);
          return { ...r, name: product?.name || "", unit: product?.unit || "", unitPrice: price,
            pricePolicyName: found.pricePolicy?.name || "", netValue: total !== null && Number.isSafeInteger(total) && total <= 9e12 ? total : "", taxRate: "" };
        });
        rows = [...existing, ...priced];
        note.value = (note.value + "\n" + sourceNote).trim();
        page = Math.floor(existing.length / pageSize);
        d.querySelector("[name=confirmedZero]").checked = false;
        paintRows();
        status.textContent = `Đã nạp ${imported.length} dòng. Chưa lưu vào sổ. Dùng ${found.pricePolicy?.name || "chưa có bảng giá niêm yết phù hợp"}; ${priced.filter(r => r.netValue === "").length} dòng thiếu giá/hợp lệ cần bổ sung tổng tiền. Giá bán niêm yết không phải giá vốn kế toán; kiểm tra trước khi duyệt.`;
        d.querySelector(".ac-error").textContent = "";
      } catch(e) { if (valid(owner) && dialog === d && seq === importSeq) status.textContent = e.message; }
      finally { if (valid(owner) && dialog === d && seq === importSeq) { busy = false; submit.disabled = false; event.target.value = ""; } }
    };
    add();
    d.querySelector("[name=confirmedZero]").onchange = (e) => {
      syncRows();
      if (
        e.target.checked &&
        d.querySelector("[name=kind]").value !== "opening"
      ) {
        e.target.checked = false;
        return;
      }
      d.querySelectorAll(".ac-line input").forEach(
        (i) => (i.disabled = e.target.checked),
      );
    };
    d.querySelector("[name=kind]").onchange = () => {
      d.querySelector("[name=confirmedZero]").checked = false;
      d.querySelectorAll(".ac-line input").forEach((i) => (i.disabled = false));
    };
  }
  async function detail(id) {
    const owner = epoch,
      d = await request("/documents/" + encodeURIComponent(id));
    if (!valid(owner)) return;
    modal(
      "Chứng từ " + d.reference,
      `<p>${esc(kindName[d.kind] || d.kind)} · ${esc(stateName[d.state])} · ${esc(d.date)}</p><p>${esc(d.note)}</p><div class="ac-table"><table><thead><tr><th>SKU · sản phẩm</th><th>ĐVT</th><th>Số lượng</th><th>Trước VAT</th><th>Thuế</th></tr></thead><tbody>${d.lines.slice(0, 50).map((l) => `<tr><td>${esc(l.sku)} · ${esc(l.name)}</td><td>${esc(l.unit)}</td><td>${esc(l.quantity)}</td><td>${money(l.netValue)}</td><td>${l.taxRate === null ? "Chưa rõ" : esc(l.taxRate) + "%"}</td></tr>`).join("")}</tbody></table></div><div class="ac-actions"><button type="button" data-detail-prev>Trang trước</button><span data-detail-page></span><button type="button" data-detail-next>Trang sau</button></div>${options.canApprove && d.state === "draft" ? '<label class="ac-check"><input type="checkbox" name="confirmed" required> Đã kiểm tra chứng từ gốc, pháp nhân, số lượng và giá trị đầu kỳ. Ghi sổ kế toán riêng.</label>' : "<p>Chứng từ ngoài trạng thái nháp không được sửa trực tiếp.</p>"}`,
      (f) => {
        if (!options.canApprove || d.state !== "draft")
          return Promise.resolve();
        return request("/documents/" + d.id + "/post", "POST", {
          revision: d.revision,
          confirmed: f.has("confirmed"),
        });
      },
      options.canApprove && d.state === "draft" ? "Duyệt ghi sổ" : "Đóng",
    );
    let linePage = 0;
    const detailDialog = dialog;
    const paint = () => {
      detailDialog.querySelector("tbody").innerHTML = d.lines.slice(linePage * 50, (linePage + 1) * 50).map(l => `<tr><td>${esc(l.sku)} · ${esc(l.name)}</td><td>${esc(l.unit)}</td><td>${esc(l.quantity)}</td><td>${money(l.netValue)}</td><td>${l.taxRate === null ? "Chưa rõ" : esc(l.taxRate) + "%"}</td></tr>`).join("");
      detailDialog.querySelector("[data-detail-page]").textContent = `Trang ${linePage + 1}/${Math.max(1, Math.ceil(d.lines.length / 50))} · ${d.lines.length} dòng`;
      detailDialog.querySelector("[data-detail-prev]").disabled = linePage === 0;
      detailDialog.querySelector("[data-detail-next]").disabled = (linePage + 1) * 50 >= d.lines.length;
    };
    detailDialog.querySelector("[data-detail-prev]").onclick = () => { linePage--; paint(); };
    detailDialog.querySelector("[data-detail-next]").onclick = () => { linePage++; paint(); };
    paint();
    if (options.canApprove && d.state !== "voided") {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Hủy đối chiếu";
      button.onclick = () =>
        modal(
          "Hủy đối chiếu " + d.reference,
          `<p>Chỉ hủy ghi nhận trong sổ kế toán CRM. Không hủy hóa đơn điện tử ở Viettel/VNPT và không thay đổi tồn vật lý.</p>${field("Lý do và căn cứ", "reason", "text", "", 'required maxlength="500"')}<label class="ac-check"><input type="checkbox" required> Đã đối soát các chứng từ liên quan.</label>`,
          (f) =>
            request("/documents/" + d.id + "/void", "POST", {
              revision: d.revision,
              reason: f.get("reason"),
            }),
          "Xác nhận hủy đối chiếu",
        );
      dialog.querySelector(".ac-modal-body").append(button);
    }
  }
  function review(a) {
    const old = a.review || {};
    modal(
      "Đối soát cảnh báo",
      `<p>${esc(a.message)}</p><label>Trạng thái<select name="status"><option value="open">Chưa xử lý</option><option value="investigating">Đang đối soát</option><option value="resolved">Đã đối soát</option></select></label><label>Ghi chú / căn cứ<textarea name="note" required maxlength="1000">${esc(old.note || "")}</textarea></label><p>Ghi chú không sửa tồn hoặc xóa dữ kiện cảnh báo.</p>`,
      (f) =>
        request("/reviews", "POST", {
          ...filters,
          ...Object.fromEntries(f),
          fingerprint: a.fingerprint,
          revision: old.revision || 0,
        }),
      "Lưu đối soát",
    );
    dialog.querySelector("[name=status]").value = old.status || "open";
  }
  function confirmPeriod() {
    modal(
      "Xác nhận đủ chứng từ kỳ",
      `<p>Chỉ xác nhận sau khi đối soát đầy đủ hóa đơn đầu vào, đầu ra và điều chỉnh của toàn pháp nhân. Ghi sổ bổ sung sẽ hủy xác nhận kỳ liên quan.</p>${field("Tháng đã kết thúc", "month", "month", filters.from.slice(0, 7), "required")}${field("Căn cứ đối soát", "reference", "text", "", 'required maxlength="1000"')}<label class="ac-check"><input name="confirmed" type="checkbox" required> Đủ chứng từ cho tất cả sổ của pháp nhân trong kỳ.</label>`,
      (f) =>
        request("/periods/confirm", "POST", {
          ...Object.fromEntries(f),
          entityId: filters.entityId,
          confirmed: f.has("confirmed"),
        }),
      "Xác nhận kỳ",
    );
  }
  async function sourceForm() {
    const book = selectedBook();
    if (!book?.openingDate) return notice("Chọn sổ có đầu kỳ đã duyệt trước.");
    let proposal = null;
    const owner = epoch,
      d = modal(
        "Đối chiếu đơn bán thực tế",
        `${field("Tìm theo số đơn CRM/POS", "q", "search", "", 'minlength="2"')}<button type="button" data-search>Tìm đơn</button><div data-results></div><div data-proposal></div><div class="ac-form">${field("Ngày chứng từ", "date", "date", filters.to, "required")}${field("Số chứng từ / mã bản nháp", "reference", "text", "", 'required maxlength="120"')}</div><label class="ac-check"><input name="confirmedEntity" type="checkbox" required> Tôi xác nhận đơn bán thuộc đúng pháp nhân/MST của sổ đang chọn.</label><p>Chỉ giữ đúng SKU/đơn vị của đơn thật; không thay mã để khớp tiền. Tạo bản nháp không phát hành hóa đơn.</p>`,
        (f) => {
          if (!proposal) throw new Error("Chọn và kiểm tra đơn bán trước.");
          return request("/books/" + book.id + "/sale-drafts", "POST", {
            ...Object.fromEntries(f),
            orderId: proposal.order.id,
            sourceRevision: proposal.order.revision,
            confirmedEntity: f.has("confirmedEntity"),
          });
        },
      );
    let searchEpoch = 0;
    d.querySelector("[name=q]").oninput = () => {
      searchEpoch++;
      proposal = null;
      d.querySelector("[data-proposal]").textContent = "";
      d.querySelector("[data-results]").replaceChildren();
    };
    d.querySelector("[data-search]").onclick = async () => {
      proposal = null;
      d.querySelector("[data-proposal]").textContent = "";
      const seq = ++searchEpoch;
      try {
        const r = await request(
          "/source-orders?q=" +
            encodeURIComponent(d.querySelector("[name=q]").value),
        );
        if (!valid(owner) || dialog !== d || seq !== searchEpoch) return;
        d.querySelector("[data-results]").replaceChildren();
        for (const o of r.orders) {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = o.orderNo + " · " + money(o.total);
          b.onclick = async () => {
            const current = ++searchEpoch;
            proposal = null;
            d.querySelector("[data-proposal]").textContent = "Đang đối chiếu…";
            try {
              const p = await request(
                "/books/" +
                  book.id +
                  "/suggest?orderId=" +
                  encodeURIComponent(o.id),
              );
              if (!valid(owner) || dialog !== d || current !== searchEpoch)
                return;
              proposal = p;
              d.querySelector("[data-proposal]").innerHTML =
                `<h3>${esc(p.order.orderNo)}</h3>${p.lines.map((l) => `<p>${esc(l.sku)} · ${esc(l.name)} · ${esc(l.quantity)} ${esc(l.unit)} · ${money(l.netValue)} · tồn sổ ${esc(l.available ?? "chưa rõ")}</p>`).join("")}`;
            } catch (e) {
              if (valid(owner) && dialog === d)
                d.querySelector(".ac-error").textContent = e.message;
            }
          };
          d.querySelector("[data-results]").append(b);
        }
      } catch (e) {
        if (valid(owner) && dialog === d)
          d.querySelector(".ac-error").textContent = e.message;
      }
    };
  }
  function render() {
    const b = selectedBook();
    root.innerHTML = `<header class="ac-head"><div><p>KẾ TOÁN · CHỈ MANAGER & KẾ TOÁN</p><h1>Không gian kế toán</h1><p>Sổ hóa đơn riêng · không cộng/trừ tồn kho vận hành</p></div><button data-action="refresh">Làm mới</button></header><p id="ac-notice" role="status"></p><section class="card ac-panel"><h2>Sổ kho kế toán</h2><div class="ac-book-grid">${options.books.map((book) => `<article><h3>${esc(book.name)}</h3><p>${book.entityId ? esc(options.entities.find((e) => e.id === book.entityId)?.name) : "Chưa gán pháp nhân/MST"}</p><p>${book.invoiceProvider === "viettel" ? "Viettel" : book.invoiceProvider === "vnpt" ? "VNPT" : "Chưa chọn nhà cung cấp"} · Chưa bật phát hành</p><p>${book.openingDate ? "Đã mở đầu kỳ " + esc(book.openingDate) : "Chưa có đầu kỳ được duyệt"}</p>${options.canConfigure ? `<button data-book="${esc(book.id)}">Cấu hình sổ</button>` : ""}</article>`).join("") || "<p>Chưa có sổ. Manager tạo sổ trước, không tự suy ra tồn bằng 0.</p>"}</div>${options.canConfigure ? '<div class="ac-actions"><button data-action="entity">Thêm pháp nhân/MST</button><button data-action="book">Thêm sổ</button></div>' : ""}</section><form class="card ac-filters"><label>Pháp nhân / MST<select name="entityId"><option value="">Chọn pháp nhân</option>${entities()}</select></label><label>Sổ kho<select name="bookId"><option value="">Tất cả sổ của pháp nhân</option>${options.books
      .filter((book) => book.entityId === filters.entityId)
      .map(
        (book) => `<option value="${esc(book.id)}">${esc(book.name)}</option>`,
      )
      .join(
        "",
      )}</select></label>${field("Từ ngày", "from", "date", filters.from, "required")}${field("Đến ngày", "to", "date", filters.to, "required")}<button type="submit">Xem báo cáo</button></form>${report ? `<section class="ac-stats"><article><span>Giá trị tồn sổ (trước VAT)</span><strong>${money(report.totals.stockValue)}</strong></article><article><span>Nhập mua ròng</span><strong>${money(report.totals.purchases)}</strong></article><article><span>Xuất bán ròng</span><strong>${money(report.totals.sales)}</strong></article></section><section class="card ac-panel"><h2>Đối chiếu tỷ lệ theo MST</h2><p>${report.k.ratio === null ? "Chưa đủ dữ liệu" : Number(report.k.ratio).toFixed(4)} · ${esc(report.k.state === "unknown" ? "Chưa xác nhận đủ chứng từ" : report.k.state === "unconfigured" ? "Chưa cấu hình K tham chiếu" : report.k.state === "review" ? "Cần đối soát" : "Trong mức tham chiếu đã nhập")}</p><p>${esc(report.k.message)}</p><small>${esc(report.k.scope)} · Nguồn: ${esc(report.k.source || "chưa cung cấp")}</small>${options.canConfigure ? '<div class="ac-actions"><button data-action="policy">Ngưỡng đối soát</button><button data-action="period">Xác nhận đủ chứng từ kỳ</button></div>' : ""}</section><section class="card ac-panel"><h2>Cảnh báo cần đối soát (${report.alertCount ?? report.alerts.length})</h2>${report.alerts.map((a, i) => `<article class="ac-alert"><div><b>${esc(a.sku || "Thiết lập sổ")}</b><p>${esc(a.message)}</p><small>${esc(a.source)}${a.review ? " · " + esc(a.review.status) + ": " + esc(a.review.note) : ""}</small></div><div class="ac-actions"><button data-review="${i}">Đối soát</button>${options.aiAvailable ? `<button data-ai="${i}">Trợ lý AI</button>` : ""}</div></article>`).join("") || "<p>Chưa có cảnh báo từ dữ liệu hiện có; không đồng nghĩa đã đủ chứng từ hoặc tuân thủ thuế.</p>"}<div class="ac-actions"><button data-report-prev="alertOffset">Trang cảnh báo trước</button><span>${Math.min(Number(filters.alertOffset||0)+1,report.alertCount ?? report.alerts.length)}–${Number(filters.alertOffset||0)+report.alerts.length} / ${report.alertCount ?? report.alerts.length}</span><button data-report-next="alertOffset">Trang cảnh báo sau</button></div><p>AI ${options.aiAvailable ? "đã cấu hình" : "chưa bật"}. Quy tắc cảnh báo không thay thế rà soát của kế toán.</p></section><section class="card ac-panel"><h2>Tồn theo mã hàng</h2><div class="ac-actions"><button data-report-prev="stockOffset">Trang tồn trước</button><span>${Math.min(Number(filters.stockOffset||0)+1,report.stockCount ?? report.stock.length)}–${Number(filters.stockOffset||0)+report.stock.length} / ${report.stockCount ?? report.stock.length}</span><button data-report-next="stockOffset">Trang tồn sau</button></div><div class="ac-table"><table><thead><tr><th>SKU · tên hàng</th><th>ĐVT</th><th>Tồn</th><th>Giá trị sổ</th></tr></thead><tbody>${report.stock.map((s) => `<tr><td>${esc(s.sku)} · ${esc(s.name)}</td><td>${esc(s.unit)}</td><td>${esc(s.quantity)}</td><td>${money(s.value)}</td></tr>`).join("")}</tbody></table></div></section><section class="card ac-panel"><div class="ac-line-head"><h2>Chứng từ</h2><div class="ac-actions">${b?.entityId ? '<button data-action="document">Nhập chứng từ / đầu kỳ</button><button data-action="import-document">Nhập file SKU / SL · 30.000 dòng</button>' : ""}${b?.openingDate ? '<button data-action="source">Đối chiếu đơn bán</button>' : ""}</div></div><div class="ac-table"><table><thead><tr><th>Số chứng từ</th><th>Ngày</th><th>Loại</th><th>Trước VAT</th><th>Trạng thái</th></tr></thead><tbody>${report.documents.map((d) => `<tr><td><button data-document="${esc(d.id)}">${esc(d.reference)}</button></td><td>${esc(d.date)}</td><td>${esc(kindName[d.kind] || d.kind)}</td><td>${money(d.total)}</td><td>${esc(stateName[d.state])}</td></tr>`).join("")}</tbody></table></div><p>Chọn một sổ để nhập chứng từ. Manager duyệt mới ảnh hưởng số dư kế toán. Chưa tích hợp ký số hoặc phát hành Viettel/VNPT.</p></section><p>${report.limitations.map(esc).join(" ")}</p>` : '<section class="card ac-panel"><p>Chọn pháp nhân đã cấu hình để xem báo cáo. Chưa có MST và số dư đầu kỳ thì hệ thống chưa tính giá trị tồn hay đánh giá tỷ lệ.</p></section>'}`;
    root.querySelectorAll('[data-report-prev],[data-report-next]').forEach(button=>{
      const key=button.dataset.reportPrev||button.dataset.reportNext,size=key==='stockOffset'?50:25;
      const current=Number(filters[key]||0),count=key==='stockOffset'?(report?.stockCount??0):(report?.alertCount??0);
      const forward=!!button.dataset.reportNext;
      button.disabled=forward?current+size>=count:current===0;
      button.onclick=async()=>{filters[key]=String(Math.max(0,current+(forward?size:-size)));await load();};
    });
    $(".ac-filters [name=entityId]").value = filters.entityId;
    $(".ac-filters [name=bookId]").value = filters.bookId;
    $(".ac-filters [name=entityId]").onchange = async (e) => {
      filters.entityId = e.target.value;
      filters.bookId = "";
      filters.stockOffset=filters.alertOffset="0";
      await load();
    };
    $(".ac-filters").onsubmit = async (e) => {
      e.preventDefault();
      filters = { ...Object.fromEntries(new FormData(e.target)) };
      await load();
    };
    root
      .querySelectorAll("[data-book]")
      .forEach(
        (el) =>
          (el.onclick = () =>
            bookForm(options.books.find((b) => b.id === el.dataset.book))),
      );
    root
      .querySelectorAll("[data-document]")
      .forEach(
        (el) =>
          (el.onclick = () =>
            detail(el.dataset.document).catch((e) => notice(e.message))),
      );
    root
      .querySelectorAll("[data-review]")
      .forEach(
        (el) => (el.onclick = () => review(report.alerts[el.dataset.review])),
      );
    root.querySelectorAll("[data-ai]").forEach(
      (el) =>
        (el.onclick = async () => {
          const owner = epoch,
            a = report.alerts[el.dataset.ai];
          el.disabled = true;
          try {
            const r = await request("/assistant", "POST", {
              ...filters,
              fingerprint: a.fingerprint,
            });
            if (valid(owner)) {
              const d = modal(
                "Gợi ý AI · cần kiểm tra",
                `<p>${esc(r.summary)}</p><ul>${r.checks.map((s) => "<li>" + esc(s) + "</li>").join("")}</ul>`,
                () => Promise.resolve(),
                "Đóng",
              );
            }
          } catch (e) {
            if (valid(owner)) notice(e.message);
          } finally {
            el.disabled = false;
          }
        }),
    );
    const actions = {
      refresh: load,
      entity: entityForm,
      book: () => bookForm(null),
      policy,
      period: confirmPeriod,
      document: documentForm,
      "import-document": async () => {
        const book=selectedBook(),owner=epoch;
        if(!book?.entityId)return notice("Chọn một sổ đã gán pháp nhân trước.");
        try {const {openAccountingImport}=await import("./accounting-import.js");
          if(valid(owner))await openAccountingImport({request,root,book,date:filters.to,valid:()=>valid(owner),refresh:load});
        }catch(e){if(valid(owner))notice(e.message);}
      },
      source: sourceForm,
    };
    root
      .querySelectorAll("[data-action]")
      .forEach((el) => (el.onclick = () => actions[el.dataset.action]?.()));
  }
  async function load() {
    const id = ++epoch;
    closeDialog();
    notice("Đang tải…");
    try {
      const o = await request("/options");
      if (!valid(id)) return;
      options = o;
      if (!o.entities.some((e) => e.id === filters.entityId)) {
        filters.entityId = o.entities[0]?.id || "";
        filters.bookId = "";
      }
      if (
        filters.bookId &&
        !o.books.some(
          (b) => b.id === filters.bookId && b.entityId === filters.entityId,
        )
      )
        filters.bookId = "";
      const r = filters.entityId
        ? await request("/report?" + new URLSearchParams({...filters,paged:"1"}))
        : null;
      if (!valid(id)) return;
      report = r;
      render();
    } catch (e) {
      if (valid(id)) {
        root.replaceChildren();
        const p = document.createElement("p");
        p.role = "alert";
        p.textContent = e.message;
        root.append(p);
      }
    }
  }
  return {
    show: async () => {
      active = true;
      await load();
    },
    close: () => {
      active = false;
      epoch++;
      closeDialog();
      options = null;
      report = null;
      filters = {
        entityId: "",
        bookId: "",
        from: dateNow().slice(0, 7) + "-01",
        to: dateNow(),
      };
      root.replaceChildren();
    },
  };
}
