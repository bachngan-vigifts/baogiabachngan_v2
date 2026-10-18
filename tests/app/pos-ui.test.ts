import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-ignore browser module uses injected DOM only while rendering
import { buildPosPrint } from "../../trial-ui/pos-print.js";
// @ts-ignore
import { initPos } from "../../trial-ui/pos.js";
class Element {
  children: Element[] = [];
  text = "";
  value: any = "";
  hidden = false;
  disabled = false;
  type = "";
  src = "";
  className = "";
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  listeners = new Map<string, Function[]>();
  checked = false;
  open = false;
  classList = { toggle: () => {}, add: () => {}, remove: () => {} };
  constructor(public tag: string) {}
  set textContent(v: string) {
    this.text = String(v);
    this.children = [];
  }
  get textContent(): string {
    return this.text + this.children.map((x) => x.textContent).join("");
  }
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
    this.text = "";
  }
  setAttribute(k: string, v: string) {
    if (k.startsWith("data-")) this.dataset[k.slice(5)] = v;
  }
  addEventListener(k: string, f: Function) {
    this.listeners.set(k, [...(this.listeners.get(k) || []), f]);
  }
  async fire(k: string) {
    for (const f of this.listeners.get(k) || [])
      await f({ target: this, preventDefault() {} });
  }
  querySelectorAll(selector: string): Element[] {
    const all = this.children.flatMap((x) => [x, ...x.querySelectorAll("*")]);
    if (selector === "*") return all;
    return all.filter((x) => selector.split(",").includes(x.tag));
  }
  get lastChild() {
    return this.children.at(-1)!;
  }
  focus() {}
  select() {}
  remove() {}
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
}
const doc = {
  createElement: (tag: string) => new Element(tag),
  createTextNode: (s: string) => {
    const n = new Element("#text");
    n.text = s;
    return n;
  },
  body: new Element("body"),
};
const sample = {
  register: { name: "Cửa hàng" },
  customer: "<script>customer</script>",
  memberName: "Nhân viên",
  createdAt: "2026-10-18T01:00:00Z",
  orderNo: "POS_1",
  lines: [
    {
      name: "<img src=x onerror=alert(1)>",
      sku: "001",
      unit: "cái",
      qty: 2,
      listUnitPrice: 108000,
      listAmount: 216000,
      discountType: "percent",
      discountValue: 10,
      discountAmount: 21600,
      total: 194400,
    },
  ],
  subtotal: 180000,
  tax: 14400,
  discount: 21600,
  total: 194400,
  method: "cash",
  tendered: 200000,
  change: 5600,
};
test("POS chọn quầy mặc định từ server, ưu tiên ca đang mở và đặt lại khi đổi tài khoản", async () => {
  const prevDoc = globalThis.document,
    prevWin = globalThis.window;
  Object.assign(globalThis, {
    document: doc,
    window: { addEventListener() {} },
  });
  try {
    let userId = "emp",
      defaultRegisterId = "ml",
      current: any = null;
    const catalogs: string[] = [];
    const api = async (path: string) => {
      if (path === "/pos/options")
        return {
          registers: ["lock", "ml"].map((id) => ({
            id,
            name: id,
            pricePolicyId: "vat",
            secondPricePolicyId: "retail",
          })),
          defaultRegisterId,
          current,
          shifts: [],
          templates: [],
          policies: [],
        };
      if (path.startsWith("/pos/catalog")) {
        catalogs.push(path);
        return { products: [], nextOffset: null };
      }
      throw Error(path);
    };
    const ui = initPos({
      api,
      root: new Element("section"),
      toast() {},
      user: () => ({ id: userId, name: "NV" }),
      confirmBox: async () => true,
      go() {},
    });
    await ui.load();
    assert.match(catalogs.at(-1)!, /registerId=ml/);
    current = { id: "shift", registerId: "lock", memberId: "emp" };
    await ui.load();
    assert.match(catalogs.at(-1)!, /registerId=lock/);
    current = null;
    userId = "other";
    await ui.load();
    assert.match(catalogs.at(-1)!, /registerId=ml/);
  } finally {
    Object.assign(globalThis, { document: prevDoc, window: prevWin });
  }
});
test("K80: bill tạm không có số chính thức, nhãn rõ ràng và dữ liệu độc hại chỉ là chữ", () => {
  const p = buildPosPrint(doc, { ...sample, temporary: true });
  assert.match(p.textContent, /BILL TẠM TÍNH - CHƯA THANH TOÁN/);
  assert.ok(!p.textContent.includes("POS_1"));
  assert.match(p.textContent, /<script>customer<\/script>/);
  assert.equal(p.querySelectorAll("script,img").length, 0);
  const paid = buildPosPrint(doc, sample);
  assert.match(paid.textContent, /POS_1/);
  assert.match(paid.textContent, /Giảm 10%/);
  assert.match(paid.textContent, /ĐÃ THU TIỀN/);
  assert.match(paid.textContent, /5.600/);
  const text = readFileSync("trial-ui/pos-print.js", "utf8");
  assert.match(text, /size:80mm/);
});
test("POS: tìm/quét và giỏ hàng dùng server preview, mặc định giá VAT; không render bằng innerHTML", async () => {
  const prevDoc = globalThis.document,
    prevWin = globalThis.window;
  Object.assign(globalThis, {
    document: doc,
    window: { addEventListener() {} },
  });
  try {
    const root = new Element("section"),
      calls: any[] = [];
    const api = async (path: string, method = "GET", body?: any) => {
      calls.push({ path, method, body });
      if (path === "/pos/options")
        return {
          registers: [
            {
              id: "r",
              name: "Quầy 1",
              pricePolicyId: "vat",
              secondPricePolicyId: "retail",
            },
          ],
          current: { id: "s", registerId: "r", memberId: "emp" },
          shifts: [],
          templates: [],
          policies: [
            { id: "vat", name: "Giá bán lẻ (+ VAT)" },
            { id: "retail", name: "Giá bán lẻ" },
          ],
        };
      if (path.startsWith("/pos/catalog"))
        return {
          products: [
            {
              sku: "001",
              name: "Ly sứ",
              unit: "cái",
              price: 108000,
              available: 10,
            },
          ],
          nextOffset: null,
        };
      if (path === "/pos/preview")
        return {
          ...sample,
          lines: [{ ...sample.lines[0], sku: "001" }],
          temporary: true,
        };
      throw Error(path);
    };
    const ui = initPos({
      api,
      root,
      toast() {},
      user: () => ({ id: "emp", name: "NV", perms: ["pos.sell"] }),
      confirmBox: async () => true,
      go() {},
    });
    await ui.load();
    assert.match(root.textContent, /Bán hàng nhanh/);
    const product = root
      .querySelectorAll("button")
      .find((x) => x.className === "pos-product")!;
    assert.ok(product);
    await product.fire("click");
    await new Promise((r) => setTimeout(r, 230));
    const preview = calls.find((x) => x.path === "/pos/preview");
    assert.ok(preview);
    assert.equal(preview.body.pricePolicyId, "vat");
    assert.deepEqual(preview.body.rows, [
      { sku: "001", qty: 1, discountType: "percent", discountValue: 0 },
    ]);
    assert.equal(preview.body.total, undefined);
    assert.equal(ui.dirty(), true);
    const cash = root
      .querySelectorAll("button")
      .find((x) => x.textContent === "Đủ tiền")!;
    await cash.fire("click");
    const pay = root
      .querySelectorAll("button")
      .find((x) => x.textContent === "Thu tiền & in")!;
    assert.equal(pay.disabled, false);
  } finally {
    Object.assign(globalThis, { document: prevDoc, window: prevWin });
  }
  for (const p of ["trial-ui/pos.js", "trial-ui/pos-print.js"])
    assert.ok(
      !/\.innerHTML\s*=|insertAdjacentHTML/.test(readFileSync(p, "utf8")),
      p,
    );
});
