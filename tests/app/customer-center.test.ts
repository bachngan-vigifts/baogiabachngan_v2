import { contractTest as test, assert } from "../TEST_TEMPLATE.ts";
const { initCustomerCenter, centerRows, phoneHref }: any = await import(
  new URL("../../trial-ui/customer-center.js", import.meta.url).href
);
const today = "2026-11-06";
const rows = [
  {
    id: "old",
    customerName: "Công ty Điện lực",
    customerPhone: "0901000001",
    nextAt: "2026-11-05",
  },
  { id: "today", customerName: "Khách hôm nay", nextAt: today },
  { id: "future", customerName: "Khách sắp tới", nextAt: "2026-11-07" },
  {
    id: "done",
    customerName: "Đã hoàn tất",
    nextAt: today,
    nextDoneAt: "2026-11-06T01:00:00Z",
  },
];
test("reminder search and status distinguish overdue, today, future and completed without changing source rows", () => {
  const before = JSON.stringify(rows),
    ids = (q: string, s: string) =>
      centerRows(rows, q, s, today).map((a: any) => a.id);
  assert.deepEqual(ids("", "due"), ["old", "today"]);
  assert.deepEqual(ids("", "today"), ["today"]);
  assert.deepEqual(ids("", "upcoming"), ["future"]);
  assert.deepEqual(ids("", "overdue"), ["old"]);
  assert.deepEqual(ids("", "done"), ["done"]);
  assert.equal(ids("", "all").length, 4);
  assert.deepEqual(ids("dien luc", "all"), ["old"]);
  assert.deepEqual(ids("0901000001", "all"), ["old"]);
  assert.deepEqual(ids("không có", "all"), []);
  assert.equal(JSON.stringify(rows), before);
});
test("phone links accept only usable real numbers", () => {
  assert.equal(phoneHref("+84 (901) 000-001"), "tel:+84901000001");
  for (const value of [
    "",
    null,
    "javascript:alert(1)",
    "       ",
    "123",
    "0901000001;123",
  ])
    assert.equal(phoneHref(value), null);
});
function fixture(overrides: any = {}) {
  const events: Record<string, Function> = {},
    feedback = { textContent: "" },
    root = {
      innerHTML: "",
      addEventListener: (name: string, fn: Function) => (events[name] = fn),
      querySelector: () => feedback,
    };
  const requests: any[] = [],
    notices: any[] = [],
    source = {
      activities: [
        {
          ...rows[1],
          customerId: "real",
          contactName: "Chị A",
          ownerName: "NV A",
          canEdit: true,
          revision: 3,
        },
      ],
      total: 1,
      today,
      counts: { today: 1, overdue: 0 },
    };
  const api = async (path: string, method = "GET", body?: any) => {
    requests.push({ path, method, body });
    if (method === "POST")
      return {
        activity: {
          ...source.activities[0],
          nextDoneAt: "2026-11-06T02:00:00Z",
          revision: 4,
        },
      };
    return path.startsWith("/care?")
      ? source
      : path.includes("/counts?")
        ? { period: 7, dormant: 4, campaigns: 0 }
        : path.includes("/opportunities?")
          ? { total: 0, customers: [] }
          : { total: 0, reminders: [] };
  };
  let who: any = { id: "employee", name: "Tên người dùng <an toàn>" };
  const view = initCustomerCenter({
    root,
    api,
    canCare: () => true,
    user: () => who,
    openCare: () => {},
    toast: (...args: any[]) => notices.push(args),
    ...overrides,
  });
  const click = async (key: string, value = "") =>
    events.click!({
      target: {
        closest: () => ({
          disabled: false,
          dataset: { [key]: value },
          hasAttribute: (attr: string) =>
            attr ===
            "data-" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()),
        }),
      },
    });
  return {
    root,
    view,
    requests,
    notices,
    source,
    feedback,
    click,
    changeUser: () => (who = { id: "different", name: "Other" }),
  };
}
test("center loads real counts, escapes user text, and completes with revision while leaving cached data untouched", async () => {
  const f = fixture();
  await f.view.load();
  assert.equal(f.requests.length, 4);
  assert.ok(f.root.innerHTML.includes("Tên người dùng &lt;an toàn&gt;"));
  assert.ok(!f.root.innerHTML.includes("Tên người dùng <an toàn>"));
  assert.ok(!f.root.innerHTML.includes("minh họa"));
  assert.match(f.root.innerHTML, /<strong>7<\/strong>/);
  assert.match(f.root.innerHTML, /Chưa có giờ hẹn/);
  await f.click("centerDone", "today");
  assert.deepEqual(f.requests[4], {
    path: "/care/today/done",
    method: "POST",
    body: { revision: 3, nextAt: today },
  });
  assert.match(f.root.innerHTML, /Đã hoàn tất/);
  assert.equal(f.source.counts.today, 1);
  assert.equal(f.source.activities[0]!.revision, 3);
  assert.equal(f.notices.length, 1);
});
test("missing care permission skips care API; failed reads show errors without replacing them with sample records", async () => {
  const f = fixture({ canCare: () => false });
  await f.view.load();
  assert.ok(f.requests.every((r) => !r.path.startsWith("/care")));
  assert.match(f.root.innerHTML, /Chưa được cấp quyền/);
  const broken = fixture({
    api: async () => {
      throw new Error("Lỗi máy chủ");
    },
  });
  await broken.view.load();
  assert.match(broken.root.innerHTML, /Lỗi máy chủ/);
  assert.ok(!broken.root.innerHTML.includes("Khách hôm nay"));
  assert.equal(broken.notices.length, 0);
});
test("failed completion never marks real reminder done; stale loads cannot replace a new session", async () => {
  const f = fixture({
    api: async (path: string, method?: string) => {
      if (method === "POST") throw new Error("Lịch đã đổi");
      return path.startsWith("/care?")
        ? {
            activities: [
              { ...rows[1], customerId: "real", canEdit: true, revision: 3 },
            ],
            total: 1,
            today,
            counts: { today: 1 },
          }
        : { total: 0, reminders: [] };
    },
  });
  await f.view.load();
  await f.click("centerDone", "today");
  assert.deepEqual(f.notices, [["Lịch đã đổi", "err"]]);
  assert.ok(!f.root.innerHTML.includes("Đã hoàn tất</button>"));
  const pending: Array<(value: any) => void> = [],
    stale = fixture({
      api: () => new Promise((resolve) => pending.push(resolve)),
    });
  const load = stale.view.load();
  const loading = stale.root.innerHTML;
  stale.changeUser();
  pending[0]!({
    activities: [{ customerName: "SECRET" }],
    counts: { today: 1 },
  });
  pending[1]!({ total: 0, reminders: [] });
  pending[2]!({ period: 0, dormant: 0, campaigns: 0 });
  pending[3]!({ total: 0, customers: [] });
  await load;
  assert.equal(stale.root.innerHTML, loading);
  assert.ok(!stale.root.innerHTML.includes("SECRET"));
});
