// TỰ SINH bởi `npm run ui:build` từ src/modules/sales/domain/order-notes.ts – không sửa tay.
// src/modules/sales/domain/order-notes.ts
var text = (v) => typeof v === "string" ? v.trim() : "";
var fold = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase();
function terms(notes) {
  const parts = { time: [], address: [], payment: [], method: [] };
  let active = null;
  for (const raw of text(notes).split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-+–•]\s*/, ""), key = fold(line);
    let kind = /^thoi gian giao hang\s*[:：]/.test(key) ? "time" : /^dia (?:chi|diem) giao hang\s*[:：]/.test(key) ? "address" : /^phuong thuc thanh toan\s*[:：]/.test(key) ? "method" : /^(?:thanh toan|dieu khoan thanh toan|dieu kien thanh toan)\s*[:：]/.test(key) || /^(?:ben a thanh toan|ben mua se tien hanh tam ung|dat coc|tam ung|\d+(?:[.,]\d+)?%\s*(?:tri gia|gia tri)\s+con lai)/.test(key) ? "payment" : null;
    if (kind) {
      const value = /^(?:Thời gian giao hàng|Địa (?:chỉ|điểm) giao hàng|Phương thức thanh toán|Thanh toán|Điều (?:khoản|kiện) thanh toán)\s*[:：]\s*/i.test(line) ? line.replace(/^[^:：]+[:：]\s*/, "") : line;
      if (kind === "time" || kind === "address") parts[kind] = [];
      parts[kind].push(value);
      active = kind;
    } else if (!line || /^\s*[-+–•]/.test(raw) || /^(?:tran trong|hy vong|kinh chao|tong |bao gia|gia tren|don vi|ma so thue|so tai khoan|tai khoan|ngan hang)/.test(key) || /^[^:：]{1,70}[:：]/.test(line)) active = null;
    else if (active) parts[active].push(line);
  }
  return { time: parts.time.join(" ").trim(), address: parts.address.join(" ").trim(), payment: parts.payment.join(" ").trim(), method: parts.method.join(" ").trim() };
}
function day(date) {
  const s = text(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s + "T00:00:00Z")) || (/* @__PURE__ */ new Date(s + "T00:00:00Z")).toISOString().slice(0, 10) !== s) return "";
  return s.split("-").reverse().join("/");
}
function orderDeliveryAddress(source) {
  const address = terms(source.notes).address;
  return address && !/^theo thoa thuan[.]?$/.test(fold(address)) ? address : text(source.customerAddress) || address;
}
function render(t) {
  const payment = [t.payment, t.method ? "Ph\u01B0\u01A1ng th\u1EE9c: " + t.method : ""].filter(Boolean).join(" ");
  return ["- Th\u1EDDi gian giao h\xE0ng: " + t.time, "- \u0110\u1ECBa ch\u1EC9 giao h\xE0ng: " + t.address, "- Thanh to\xE1n: " + payment].join("\n");
}
function orderNotesFromQuote(source) {
  const t = terms(source.notes), date = day(source.deliveryDate);
  if (date) t.time = "Giao h\xE0ng ng\xE0y " + date + ".";
  t.address = orderDeliveryAddress(source);
  return render(t);
}
function syncOrderDeliveryNotes(notes, changes, source) {
  const t = terms(notes);
  if (changes.deliveryDate !== void 0) {
    const date = day(changes.deliveryDate);
    t.time = date ? "Giao h\xE0ng ng\xE0y " + date + "." : terms(source.notes).time;
  }
  if (changes.deliveryAddress !== void 0) t.address = changes.deliveryAddress.trim();
  return render(t);
}
export {
  orderDeliveryAddress,
  orderNotesFromQuote,
  syncOrderDeliveryNotes
};
